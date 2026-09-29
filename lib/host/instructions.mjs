/**
 * dsh-memory-view — AGENTS.md 指令文件：发现 / 读取 / 写入（纯 Node，框架无关）。
 *
 * 发现规则与 @deepseek-ai/dsh-agent-instructions 保持一致：
 *   1. 用户全局：`$DSH_HOME/AGENTS.md`（无 overlay）；
 *   2. 项目 scope：从项目根（含 projectRootMarkers，默认 `.git` 的最近祖先目录）
 *      逐级到会话 cwd，每级先读基础候选（AGENTS.md / CLAUDE.md）、
 *      再读本地 overlay 候选（AGENTS.local.md / CLAUDE.local.md）——由宽泛到具体。
 *
 * 编辑只允许写这些候选文件名，且目录必须在“发现链 + 配置的 extraRoots”内；
 * 写入为原子替换（同目录临时文件 + rename），可选自动备份到备份目录。
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  mkdirSync,
  statSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { join, resolve, basename, dirname, relative, sep } from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_BASE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
export const DEFAULT_LOCAL_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']
export const DEFAULT_ROOT_MARKERS = ['.git']
export const RESERVED_SEGMENTS = new Set(['', '.', '..'])

const TMP_SUFFIX = '.dsh-mv-tmp-'

/** 过滤非法候选名（忽略空项 / . / .. / 含路径分隔符的项），与上游一致。 */
export function normalizeCandidates(list, fallback) {
  const src = Array.isArray(list) && list.length ? list : fallback
  return src
    .filter((c) => typeof c === 'string' && c.length > 0 && !RESERVED_SEGMENTS.has(c) && !/[\\/]/.test(c))
}

/** 展开 `~`、`~/...`、`~\...` 前缀。 */
export function expandHome(p) {
  if (typeof p !== 'string' || !p) return p
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/** 从 cwd 向上找最近的“项目根”（含任一 marker 的目录）；找不到返回 null。 */
export function findProjectRoot(cwd, markers = DEFAULT_ROOT_MARKERS) {
  let dir = resolve(cwd)
  for (;;) {
    for (const marker of markers) {
      if (existsSync(join(dir, marker))) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * 构造发现链（由宽泛到具体）。
 * @returns { globalDir, projectRoot, entries: [{ dir, scope, display, files: [{name, path, scope}] }] }
 */
export function buildInstructionChain(opts = {}) {
  const dshHome = resolve(expandHome(opts.dshHome) || join(homedir(), '.dsh'))
  const cwd = resolve(expandHome(opts.cwd) || process.cwd())
  const markers = opts.projectRootMarkers?.length ? opts.projectRootMarkers : DEFAULT_ROOT_MARKERS
  const base = normalizeCandidates(opts.baseCandidates, DEFAULT_BASE_CANDIDATES)
  const local = normalizeCandidates(opts.localCandidates, DEFAULT_LOCAL_CANDIDATES)
  const extraRoots = (opts.extraRoots ?? []).map((r) => resolve(expandHome(r))).filter(Boolean)

  const entries = []
  // 1) 用户全局
  entries.push({
    dir: dshHome,
    scope: 'global',
    display: '~/.dsh',
    files: [{ name: 'AGENTS.md', path: join(dshHome, 'AGENTS.md'), scope: 'global', kind: 'base' }],
  })
  // 2) 项目链（项目根 → cwd）
  const projectRoot = findProjectRoot(cwd, markers)
  const dirs = []
  if (projectRoot) {
    let dir = cwd
    const chain = []
    for (;;) {
      chain.push(dir)
      if (dir === projectRoot) break
      const parent = dirname(dir)
      if (parent === dir || parent.length < projectRoot.length) break
      dir = parent
    }
    chain.reverse() // 宽泛 → 具体
    dirs.push(...chain)
  } else {
    dirs.push(cwd)
  }
  for (const dir of dirs) {
    const rel = relative(cwd, dir)
    const display = dir === cwd ? '.' : `./${rel.split(sep).join('/')}`
    entries.push({
      dir,
      scope: 'project',
      display,
      files: [
        ...base.map((name) => ({ name, path: join(dir, name), scope: 'project', kind: 'base' })),
        ...local.map((name) => ({ name, path: join(dir, name), scope: 'project', kind: 'local' })),
      ],
    })
  }
  // 3) 额外 root（配置项；每个 root 目录本身的候选文件）
  for (const root of extraRoots) {
    if (entries.some((e) => e.dir === root)) continue
    entries.push({
      dir: root,
      scope: 'extra',
      display: root,
      files: [
        ...base.map((name) => ({ name, path: join(root, name), scope: 'extra', kind: 'base' })),
        ...local.map((name) => ({ name, path: join(root, name), scope: 'extra', kind: 'local' })),
      ],
    })
  }
  return { dshHome, cwd, projectRoot, markers, base, local, extraRoots, entries }
}

function statFile(path) {
  try {
    const st = statSync(path)
    if (!st.isFile()) return null
    return { exists: true, size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return { exists: false, size: 0, mtimeMs: 0 }
  }
}

/** 允许写入的绝对路径集合（发现链内所有候选文件）。 */
export function allowedPathsOf(chain) {
  const set = new Set()
  for (const entry of chain.entries) for (const f of entry.files) set.add(resolve(f.path))
  return set
}

/** 列出发现链上的候选文件（含不存在项；便于客户端展示“可新建”）。 */
export function listInstructionFiles(opts = {}) {
  const chain = buildInstructionChain(opts)
  const allowed = allowedPathsOf(chain)
  const groups = chain.entries.map((entry) => ({
    dir: entry.dir,
    display: entry.display,
    scope: entry.scope,
    files: entry.files.map((f) => {
      const st = statFile(f.path)
      return {
        name: f.name,
        path: f.path,
        scope: f.scope,
        kind: f.kind,
        exists: st.exists,
        size: st.size,
        mtimeMs: st.mtimeMs,
      }
    }),
  }))
  return {
    dshHome: chain.dshHome,
    cwd: chain.cwd,
    projectRoot: chain.projectRoot,
    projectRootMarkers: chain.markers,
    baseCandidates: chain.base,
    localCandidates: chain.local,
    allowedDirCount: chain.entries.length,
    groups,
    allowedPaths: [...allowed],
  }
}

const err = (code, message, extra) => Object.assign(new Error(message), { code, ...(extra ?? {}) })

/** 读取指令文件（读取前校验路径在允许集合内；按 maxSourceBytes 截断）。 */
export function readInstruction(path, opts = {}) {
  const target = resolve(expandHome(path))
  if (opts.chain) {
    const allowed = allowedPathsOf(opts.chain)
    if (!allowed.has(target)) throw err('forbidden', `not an instruction candidate: ${target}`)
  }
  let st
  try {
    st = statSync(target)
  } catch (e) {
    throw err('not-found', `cannot read: ${e.message}`)
  }
  if (!st.isFile()) throw err('not-found', `not a regular file: ${target}`)
  const maxSourceBytes = opts.maxSourceBytes ?? 1048576
  const raw = readFileSync(target)
  const truncated = raw.length > maxSourceBytes
  const content = (truncated ? raw.subarray(0, maxSourceBytes) : raw).toString('utf8')
  return {
    path: target,
    name: basename(target),
    content,
    size: st.size,
    mtimeMs: st.mtimeMs,
    truncated,
    bytes: Buffer.byteLength(content, 'utf8'),
  }
}

/**
 * 原子写入指令文件。
 * @param opts {chain?, dshHome?, content, expectedMtimeMs?, create?, backup?, backupDir?, maxWriteBytes?}
 */
export function writeInstruction(path, opts = {}) {
  const target = resolve(expandHome(path))
  const chain = opts.chain
  if (chain) {
    const allowed = allowedPathsOf(chain)
    if (!allowed.has(target)) throw err('forbidden', `not an instruction candidate: ${target}`)
  }
  const content = typeof opts.content === 'string' ? opts.content : String(opts.content ?? '')
  const bytes = Buffer.byteLength(content, 'utf8')
  const maxWriteBytes = opts.maxWriteBytes ?? 262144
  if (bytes > maxWriteBytes) throw err('too-large', `content ${bytes}B exceeds limit ${maxWriteBytes}B`)

  const st = statFile(target)
  if (!st.exists && opts.create === false) {
    throw err('not-found', 'file does not exist and create is disabled')
  }
  if (st.exists && Number.isFinite(opts.expectedMtimeMs) && opts.expectedMtimeMs > 0) {
    if (Math.abs(st.mtimeMs - opts.expectedMtimeMs) > 1) {
      throw err('conflict', 'file changed on disk since it was loaded', { currentMtimeMs: st.mtimeMs, currentSize: st.size })
    }
  }

  // 备份（默认放在 DSH home 下的备份目录，避免污染仓库）
  let backupPath = null
  if (st.exists && opts.backup !== false) {
    try {
      const dir = opts.backupDir
        ? resolve(expandHome(opts.backupDir))
        : join(resolve(expandHome(opts.dshHome) || join(homedir(), '.dsh')), 'memory-view-backups')
      mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = join(dir, `${basename(target)}.${stamp}.bak`)
      copyFileSync(target, backupPath)
    } catch {
      backupPath = null // 备份失败不阻断写入（原文件仍会被原子替换）
    }
  }

  const dir = dirname(target)
  const tmp = join(dir, `${basename(target)}${TMP_SUFFIX}${process.pid}-${Date.now()}`)
  try {
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, target)
  } catch (e) {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw err('io', `write failed: ${e.message}`)
  }
  const after = statFile(target)
  return {
    path: target,
    name: basename(target),
    created: !st.exists,
    size: after.size,
    mtimeMs: after.mtimeMs,
    backupPath,
  }
}

/** 指令存储门面（供 RPC 分发使用）。 */
export function createInstructionStore(opts = {}) {
  const cfg = opts.instructions ?? {}
  const chainOptsFor = (cwd) => ({
    dshHome: opts.dshHome,
    cwd: cwd || opts.defaultCwd || process.cwd(),
    projectRootMarkers: cfg.projectRootMarkers,
    baseCandidates: cfg.baseCandidates,
    localCandidates: cfg.localCandidates,
    extraRoots: cfg.extraRoots,
  })
  return {
    config: cfg,
    chainFor: (cwd) => buildInstructionChain(chainOptsFor(cwd)),
    list(payload = {}) {
      const listed = listInstructionFiles(chainOptsFor(payload.cwd))
      return {
        ...listed,
        maxSourceBytes: cfg.maxSourceBytes ?? 1048576,
        maxWriteBytes: cfg.maxWriteBytes ?? 262144,
        backup: cfg.backup !== false,
      }
    },
    read(payload = {}) {
      const chain = buildInstructionChain(chainOptsFor(payload.cwd))
      return readInstruction(payload.path, { chain, maxSourceBytes: cfg.maxSourceBytes })
    },
    write(payload = {}) {
      const chain = buildInstructionChain(chainOptsFor(payload.cwd))
      return writeInstruction(payload.path, {
        chain,
        content: payload.content,
        expectedMtimeMs: payload.expectedMtimeMs,
        create: payload.create,
        backup: cfg.backup,
        backupDir: cfg.backupDir,
        dshHome: opts.dshHome,
        maxWriteBytes: cfg.maxWriteBytes,
      })
    },
  }
}
