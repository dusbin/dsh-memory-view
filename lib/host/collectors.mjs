/**
 * dsh-memory-view — 记忆数据收集器（纯 Node，无框架依赖）。
 *
 * 只读地收集四层“记忆”对应的 DSH 真实数据：
 *   - 会话记录（.jsonl.zstd 解码）→ 短期记忆内容
 *   - ~/.dsh/storages 投影/工作区索引 → 长期记忆档案
 *   - knowledge-base roots 文档清单 & 语义索引 dump → 长期事实 + 语义容量
 *   - skills 清单 → 过程记忆
 *
 * 全部函数为纯函数/纯工具，便于在 test/ 中直接单测；不 import 任何
 * @deepseek-ai/* 包（zstd 用 node:zlib，Node ≥ 23/24 内置）。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename, extname, dirname } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

// ---------------------------------------------------------------------------
// zstd 会话日志解码（会话文件 = 多个独立 zstd frame 首尾相连，每批一次压缩，
// 带 checksum；node:zlib 的 zstdDecompressSync 只解第一个 frame，需自行分帧）
// ---------------------------------------------------------------------------

// 文件里的 4 字节魔数为 28 b5 2f fd（大端序）；readUInt32LE 读出 0xfd2fb528。
const ZSTD_MAGIC = 0xfd2fb528 // = 4247762216（LE）

/** 扫描 zstd frame 边界（只解析 frame 头与 block 头，不解压）。 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt zstd session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error('corrupt zstd session log: reserved frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('corrupt zstd session log: reserved block type')
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** 解码整个会话日志文件 → 事件数组（原始 JSON 行）。文件缺失/损坏返回 { error }。 */
export function decodeSessionLogFile(filePath) {
  let raw
  try {
    raw = readFileSync(filePath)
  } catch (e) {
    return { events: [], error: `read: ${e.message}` }
  }
  let frames
  try {
    frames = scanZstdFrames(raw)
  } catch (e) {
    return { events: [], error: `scan: ${e.message}` }
  }
  if (!frames.length) return { events: [], error: 'no zstd frames found' }
  let text = ''
  try {
    for (const f of frames) text += zstdDecompressSync(raw.subarray(f.start, f.end)).toString('utf8')
  } catch (e) {
    return { events: [], error: `decode: ${e.message}` }
  }
  const events = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      events.push(JSON.parse(t))
    } catch {
      /* 跳过坏行 */
    }
  }
  return { events, error: null }
}

/** 归一化一条会话事件：{ seq, time, type, data }。 */
export function normalizeEvent(e) {
  if (!e || typeof e !== 'object') return null
  let data = e.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      data = { raw: e.data }
    }
  }
  return { seq: e.seq ?? null, time: e.time ?? null, type: e.type ?? 'unknown', data: data ?? {} }
}

/** 会话事件按类型计数。 */
export function countEventTypes(events) {
  const out = {}
  for (const e of events) {
    const n = normalizeEvent(e)
    if (n) out[n.type] = (out[n.type] || 0) + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// 短期记忆：把事件流折叠成“人类可读的最近交换摘要”
// ---------------------------------------------------------------------------

/** 从一条消息事件里提取纯文本（content 数组或字符串；含 reason/tool 标记）。 */
export function messageText(data, maxChars) {
  const grab = (s) => {
    if (!s) return ''
    const out = String(s).replace(/\s+/g, ' ').trim()
    return out.length > maxChars ? out.slice(0, maxChars) + '…' : out
  }
  const content = data?.content ?? data?.message?.content
  if (typeof content === 'string') return grab(content)
  if (!Array.isArray(content)) {
    // 退化：直接找 data 里的 text / 字符串化
    if (typeof data?.text === 'string') return grab(data.text)
    return grab(JSON.stringify(data ?? {}))
  }
  const parts = []
  for (const c of content) {
    if (!c || typeof c !== 'object') continue
    const tag = c.type === 'reasoning' ? '[reasoning] ' : c.type === 'tool-call' ? '[tool-call] ' : ''
    if (typeof c.text === 'string') parts.push(tag + c.text)
    else if (typeof c.content === 'string') parts.push(tag + c.content)
  }
  return grab(parts.join(' '))
}

/**
 * 折叠事件流 → 按 turn 分组的最近交换。
 * 返回 { turns: [{ turn, at, items: [{ kind, tag, text }] }], stats, truncated }
 */
export function summarizeRecentExchanges(events, { limitTurns = 8, maxChars = 400 } = {}) {
  const turns = new Map()
  for (const e of events) {
    const n = normalizeEvent(e)
    if (!n) continue
    const d = n.data ?? {}
    const turn = typeof d.turn === 'number' ? d.turn : null
    let kind = null
    let text = ''
    if (n.type === 'user/message') {
      kind = 'user'
      text = messageText(d, maxChars)
    } else if (n.type === 'assistant/message') {
      kind = 'assistant'
      text = messageText(d, maxChars)
    } else if (n.type === 'tool/call') {
      kind = 'tool'
      text = `${d.name ?? '?'} ${messageText({ content: d.arguments }, Math.min(maxChars, 200))}`
    } else if (n.type === 'tool/result') {
      kind = 'tool-result'
      text = messageText({ content: d.output ?? d.content ?? d.value }, Math.min(maxChars, 200))
    } else if (n.type === 'goal/change') {
      kind = 'meta'
      text = `goal ${d.operation ?? 'change'}: ${(d.goal?.objective ?? '').slice(0, Math.min(maxChars, 160))}`
    } else if (n.type === 'todo/write') {
      kind = 'meta'
      text = 'todos updated: ' + (Array.isArray(d.todos) ? d.todos.map((t) => `${t.status}:${t.content ?? ''}`).join(' | ') : '')
        .slice(0, Math.min(maxChars, 200))
    } else if (n.type === 'turn/start') {
      kind = 'turn-start'
    } else if (n.type === 'session/title') {
      kind = 'meta'
      text = `title → ${typeof d.title === 'string' ? d.title : ''}`
    }
    if (kind === null) continue
    const key = turn === null ? 'untimed' : `t${turn}`
    let bucket = turns.get(key)
    if (!bucket) {
      bucket = { turn, at: n.time, items: [] }
      turns.set(key, bucket)
    }
    if (kind !== 'turn-start') bucket.items.push({ kind, at: n.time, text: text.slice(0, maxChars) })
  }
  let list = [...turns.values()].filter((b) => b.turn !== null).sort((a, b) => b.turn - a.turn)
  const truncated = list.length > limitTurns
  if (truncated) list = list.slice(0, limitTurns)
  return { turns: list.map((b) => ({ turn: b.turn, at: b.at, items: b.items })), stats: countEventTypes(events), truncated }
}

// ---------------------------------------------------------------------------
// 磁盘/长期记忆收集
// ---------------------------------------------------------------------------

/** DSH home：env.DSH_HOME 优先，否则 ~/.dsh。 */
export function dshHome(env = process.env) {
  return env.DSH_HOME ? String(env.DSH_HOME) : join(homedir(), '.dsh')
}

/** 读取并解析 JSON（存在且合法时返回对象，否则 null）。 */
export function readJsonIfExists(filePath) {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 枚举 ~/.dsh/sessions/<cwd-slug>/<session-id>/ 下的会话档案。
 * 返回 [{ slug, sessionId, dir, file, size, mtimeMs }]（按 mtime 降序）。
 */
export function collectSessionsInventory(sessionsRoot) {
  const out = []
  let slugs = []
  try {
    slugs = readdirSync(sessionsRoot)
  } catch {
    return out
  }
  for (const slug of slugs) {
    const slugDir = join(sessionsRoot, slug)
    let ids = []
    try {
      if (!statSync(slugDir).isDirectory()) continue
      ids = readdirSync(slugDir)
    } catch {
      continue
    }
    for (const sessionId of ids) {
      const dir = join(slugDir, sessionId)
      try {
        const st = statSync(dir)
        if (!st.isDirectory()) continue
        let file = null
        let size = 0
        let mtimeMs = st.mtimeMs
        for (const f of readdirSync(dir)) {
          if (/^session\.jsonl(\.zstd)?$/.test(f)) {
            const fs2 = statSync(join(dir, f))
            file = f
            size = fs2.size
            mtimeMs = Math.max(mtimeMs, fs2.mtimeMs)
          }
        }
        out.push({ slug, sessionId, dir, file, size, mtimeMs })
      } catch {
        /* skip */
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/**
 * 扫描若干 roots 下的文档文件（长期事实记忆“可回源”清单）。
 * 返回 [{ rel, path, title, ext, size, mtimeMs }]；目录过深或文件过多时截断。
 */
export function collectKnowledgeDocs(roots, { include, excludeDirs, maxFiles = 2000, maxDepth = 12 } = {}) {
  const inc = new Set(include?.length ? include : ['.md', '.markdown', '.mdx', '.txt', '.json', '.ts', '.js'])
  const excl = new Set(excludeDirs?.length ? excludeDirs : ['node_modules', '.git', 'dist', 'build', 'out', 'target', '.venv', '__pycache__'])
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= maxFiles) return
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const en of entries) {
      if (out.length >= maxFiles) return
      if (excl.has(en.name)) continue
      const p = join(dir, en.name)
      if (en.isDirectory()) walk(p, depth + 1)
      else if (en.isFile() && inc.has(extname(en.name).toLowerCase())) {
        try {
          const st = statSync(p)
          out.push({
            rel: relative(roots[0] ?? dirname(dir), p) || p,
            path: p,
            title: basename(en.name).replace(/\.[^.]+$/, ''),
            ext: extname(en.name),
            size: st.size,
            mtimeMs: st.mtimeMs,
          })
        } catch {
          /* skip */
        }
      }
    }
  }
  for (const r of roots) {
    try {
      if (statSync(r).isDirectory()) walk(r, 0)
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out.slice(0, maxFiles)
}

/**
 * 解析 knowledge-base 插件 dump 出的语义索引（index.json）。
 * 返回 { meta, documents }（部分字段缺失时用空对象兜底）。
 */
export function parseKbIndexDump(indexJsonPath) {
  const j = readJsonIfExists(indexJsonPath)
  if (!j) return null
  return {
    meta: j.meta ?? {},
    documents: Array.isArray(j.documents) ? j.documents : [],
    bodyTerms: typeof j.bodyIndex === 'object' && j.bodyIndex ? Object.keys(j.bodyIndex).length : 0,
    titleTerms: typeof j.titleIndex === 'object' && j.titleIndex ? Object.keys(j.titleIndex).length : 0,
  }
}

/** 递归找 “*.skill.md / SKILL.md” 类技能清单文件（过程记忆目录）。 */
export function collectSkillManifests(roots, { maxFiles = 500, maxDepth = 10 } = {}) {
  const out = []
  const isManifest = (name) => /\.skill\.md$/i.test(name) || /^SKILL\.md$/i.test(name)
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= maxFiles) return
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const en of entries) {
      if (out.length >= maxFiles) return
      if (en.name === 'node_modules' || en.name === '.git') continue
      const p = join(dir, en.name)
      if (en.isDirectory()) walk(p, depth + 1)
      else if (en.isFile() && isManifest(en.name)) out.push({ dir, path: p, name: basename(dir) })
    }
  }
  for (const r of roots) {
    try {
      if (statSync(r).isDirectory()) walk(r, 0)
    } catch {
      /* skip */
    }
  }
  return out.slice(0, maxFiles)
}

/** 读取 skill 清单前若干行作为描述（name / description 启发式提取）。 */
export function skillSummary(filePath, { maxBytes = 4000 } = {}) {
  try {
    const text = readFileSync(filePath, 'utf8').slice(0, maxBytes)
    const firstHeading = text.match(/^#\s+(.+)$/m)?.[1] ?? basename(dirname(filePath))
    const afterFirst = text.slice(text.indexOf('\n') + 1).replace(/^#+\s*.*$/gm, '').trim().slice(0, 300)
    return { name: firstHeading, description: afterFirst }
  } catch {
    return null
  }
}

/** 会话文件路径（按 id 在 sessionsRoot 下查找；找不到返回 null）。 */
export function findSessionFile(sessionsRoot, sessionId, { slug } = {}) {
  if (!sessionId) return null
  const maybe = slug ? [join(sessionsRoot, slug, sessionId)] : []
  try {
    if (maybe.length && existsSync(maybe[0])) {
      for (const f of ['session.jsonl.zstd', 'session.jsonl']) {
        const p = join(maybe[0], f)
        if (existsSync(p)) return p
      }
      return null
    }
  } catch {
    /* fallthrough */
  }
  for (const s of readdirSyncSafe(sessionsRoot)) {
    const p = join(join(sessionsRoot, s), sessionId)
    if (!existsSync(p)) continue
    for (const f of ['session.jsonl.zstd', 'session.jsonl']) {
      const fp = join(p, f)
      if (existsSync(fp)) return fp
    }
  }
  return null
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
