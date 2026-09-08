/**
 * dsh-memory-view — 记忆快照服务核心（框架无关，可在单测中用假依赖驱动）。
 *
 * 数据源（全部只读）：
 *   - 会话日志文件（~/.dsh/sessions/<slug>/<sid>/session.jsonl.zstd）→ 短期记忆
 *   - 会话投影缓存（~/.dsh/storages/session_projcache.json，含全部会话的行）→ 工作记忆
 *   - 工作区索引（~/.dsh/storages/workspace.json）→ 长期档案
 *   - 知识库 roots / 语义索引 dump（knowledge-base 插件产物）→ 长期事实 + 语义容量
 *   - skills 清单（SKILL.md / *.skill.md）→ 过程记忆
 *
 * 可选注入 `liveProvider`（真实 ctx 的 sessionProjections / sessions），优先取
 * 内存中的最新行，磁盘 projcache 兜底。
 */
import {
  decodeSessionLogFile,
  summarizeRecentExchanges,
  collectSessionsInventory,
  readJsonIfExists,
  collectKnowledgeDocs,
  collectSkillManifests,
  skillSummary,
  findSessionFile,
} from './collectors.mjs'
import { join, basename, extname } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const KB_INCLUDE = ['.md', '.markdown', '.mdx', '.txt', '.json', '.ts', '.js']
const KB_EXCLUDE = ['node_modules', '.git', 'target', 'dist', 'build', 'out', '.venv', '__pycache__', '.idea', '.vscode']

export function createMemoryService(opts = {}) {
  const home = opts.dshHomeDir ?? join(homedir(), '.dsh')
  const sessionsRoot = opts.sessionsRoot ?? join(home, 'sessions')
  const storagesDir = opts.storagesDir ?? join(home, 'storages')
  const kbRoots = Array.isArray(opts.kbRoots) ? opts.kbRoots : []
  const kbIndexJson = opts.kbIndexJson ?? null
  const skillRoots = Array.isArray(opts.skillRoots) ? opts.skillRoots : []
  const liveProvider = opts.liveProvider ?? null // { findSession(id), rowsFor(id) } | null
  const shortTermDefaults = { limitTurns: 8, maxChars: 400 }

  let cached = null // { at, inventory, proj, ws }
  const cacheTtlMs = opts.cacheTtlMs ?? 1500
  // 重扫描类数据单独缓存（更长时间）
  const slowCache = new Map() // key -> { at, value }
  const slowTtlMs = opts.slowTtlMs ?? 5000

  function cachedSlow(key, fn) {
    const now = Date.now()
    const hit = slowCache.get(key)
    if (hit && now - hit.at < slowTtlMs) return hit.value
    const value = fn()
    slowCache.set(key, { at: now, value })
    return value
  }

  function fresh() {
    const inventory = collectSessionsInventory(sessionsRoot)
    const proj = readJsonIfExists(join(storagesDir, 'session_projcache.json')) ?? { tables: { sessions: {} } }
    const ws = readJsonIfExists(join(storagesDir, 'workspace.json')) ?? { tables: { workspaces: {} } }
    return { inventory, proj, ws }
  }

  function data(force) {
    const now = Date.now()
    if (force || !cached || now - cached.at > cacheTtlMs) cached = { at: now, ...fresh() }
    return cached
  }

  function projRowsOf(sessionId) {
    return data().proj?.tables?.sessions?.[sessionId]?.rows ?? null
  }

  function sessionMetaFromProj(sessionId) {
    const rows = projRowsOf(sessionId)
    if (!rows) return null
    const val = (name) => rows[name]?.val
    return {
      id: sessionId,
      title: val('title') ?? null,
      sessionStats: val('sessionStats') ?? null,
      goal: val('goal') ?? null,
      plan: val('plan') ?? null,
      todos: val('todos') ?? null,
      subagent: val('subagent') ?? null,
      contextPressure: val('contextPressure') ?? null,
      contextBreakdown: val('contextBreakdown') ?? null,
      tokenUsage: val('tokenUsage') ?? null,
      permissions: val('permissions') ?? null,
      sessionListMetadata: val('sessionListMetadata') ?? null,
      imageLimits: val('imageLimits') ?? null,
      subagentTiming: val('subagentTiming') ?? null,
    }
  }

  function cwdOf(sessionId) {
    return data().proj?.tables?.sessions?.[sessionId]?.identity?.cwd ?? null
  }

  // ---- 短期记忆 ----------------------------------------------------------

  function shortTerm(sessionId, overrides = {}) {
    const opts = { ...shortTermDefaults, ...overrides }
    const inventory = data().inventory
    const meta = sessionMetaFromProj(sessionId)
    const record = inventory.find((r) => r.sessionId === sessionId) ?? null
    let decoded = null
    if (record) {
      const p = record.file ? join(record.dir, record.file) : findSessionFile(sessionsRoot, sessionId)
      if (p) decoded = decodeSessionLogFile(p)
    }
    const summary = decoded && !decoded.error
      ? summarizeRecentExchanges(decoded.events, { limitTurns: opts.limitTurns, maxChars: opts.maxChars })
      : { turns: [], stats: {}, truncated: false }
    return {
      sessionId,
      cwd: cwdOf(sessionId),
      title: meta?.title ?? null,
      found: Boolean(decoded),
      error: decoded?.error ?? null,
      eventTypes: decoded && !decoded.error ? decoded.events.length : 0,
      recentTurns: summary.turns,
      stats: summary.stats,
      truncated: summary.truncated,
      contextPressure: meta?.contextPressure ?? null,
      contextBreakdown: meta?.contextBreakdown ?? null,
    }
  }

  // ---- 工作记忆 ----------------------------------------------------------

  function working(sessionId) {
    // 实时行优先（内存投影），磁盘缓存兜底 / 补充
    let live = null
    if (liveProvider && sessionId) {
      try {
        const session = liveProvider.findSession(sessionId)
        if (session) live = liveProvider.rowsFor(session)
      } catch {
        live = null
      }
    }
    const disk = projRowsOf(sessionId)
    const merged = {}
    if (disk) for (const [k, v] of Object.entries(disk)) merged[k] = v.val
    if (live) for (const [k, v] of Object.entries(live)) if (v !== undefined) merged[k] = v
    return { sessionId, source: live ? 'live+disk' : disk ? 'disk' : null, rows: merged }
  }

  // ---- 长期记忆 ----------------------------------------------------------

  function longTerm() {
    const d = data()
    const workspaces = Object.values(d.ws?.tables?.workspaces ?? {}).map((w) => ({
      path: w?.path ?? null,
      title: w?.title ?? null,
      sessionCount: Array.isArray(w?.sessionIds) ? w.sessionIds.length : 0,
      updatedAt: w?.updatedAt ?? null,
    }))
    const sessionCount = d.proj?.tables?.sessions ? Object.keys(d.proj.tables.sessions).length : 0
    const settings = readSettings(join(home, 'settings.yaml'))
    return {
      dshHome: home,
      sessionsRoot,
      storagesDir,
      workspaces,
      projCacheSessions: sessionCount,
      archivedSessionFiles: d.inventory.length,
      recentSessions: d.inventory.slice(0, 12).map((r) => ({
        sessionId: r.sessionId,
        slug: r.slug,
        file: r.file,
        size: r.size,
        mtimeMs: r.mtimeMs,
        title: sessionMetaFromProj(r.sessionId)?.title ?? null,
      })),
      settings,
      kbDocs: kbStats(),
      longTermSources: [
        { key: 'workspaceIndex', path: join(storagesDir, 'workspace.json') },
        { key: 'projectionCache', path: join(storagesDir, 'session_projcache.json') },
        { key: 'settings', path: join(home, 'settings.yaml') },
        { key: 'sessionsRoot', path: sessionsRoot },
      ],
    }
  }

  // ---- 过程 / 语义记忆 ----------------------------------------------------

  function skillsList() {
    return cachedSlow('skills', () =>
      collectSkillManifests(skillRoots).map((s) => {
        const sum = skillSummary(s.path)
        return { dir: s.dir, path: s.path, file: basename(s.path), ...(sum ?? {}) }
      }),
    )
  }

  function proceduralSemantic() {
    const skills = skillsList()
    // 语义索引 dump（knowledge-base 插件落盘）
    let kbIndex = null
    if (kbIndexJson) {
      const j = readJsonIfExists(kbIndexJson)
      if (j) {
        kbIndex = {
          path: kbIndexJson,
          generatedAt: j.meta?.generatedAt ?? null,
          roots: j.meta?.roots ?? [],
          documentCount: j.meta?.documentCount ?? (Array.isArray(j.documents) ? j.documents.length : 0),
          bodyTerms: typeof j.bodyIndex === 'object' && j.bodyIndex ? Object.keys(j.bodyIndex).length : 0,
          titleTerms: typeof j.titleIndex === 'object' && j.titleIndex ? Object.keys(j.titleIndex).length : 0,
          avgLen: j.meta?.avgLen ?? null,
          maxChunkChars: j.meta?.maxChunkChars ?? null,
          semanticWeight: j.meta?.semanticWeight ?? null,
          embeddingDimensions: j.meta?.embeddingDimensions ?? null,
          embeddingEnabled: j.meta?.embeddingEnabled ?? null,
        }
      }
    }
    return { skills, skillRoots, kbIndex, kbDocs: kbStats(), notes: NOTE }
  }

  function kbStats() {
    if (!kbRoots.length) return { roots: [], documentCount: 0, bytes: 0, byExt: {}, sample: [] }
    return cachedSlow('kb', () => {
      const docs = collectKnowledgeDocs(kbRoots, { include: KB_INCLUDE, excludeDirs: KB_EXCLUDE })
      const byExt = {}
      let bytes = 0
      for (const doc of docs) {
        bytes += doc.size
        const e = doc.ext
        byExt[e] = (byExt[e] || 0) + 1
      }
      return {
        roots: kbRoots,
        documentCount: docs.length,
        bytes,
        byExt,
        sample: docs.slice(0, 10).map((d) => ({ path: d.rel, ext: d.ext, size: d.size, mtimeMs: d.mtimeMs })),
      }
    })
  }

  // ---- 总览 ---------------------------------------------------------------

  function overview() {
    const d = data()
    const top = d.inventory.slice(0, 5).map((r) => ({
      sessionId: r.sessionId,
      slug: r.slug,
      size: r.size,
      mtimeMs: r.mtimeMs,
      title: sessionMetaFromProj(r.sessionId)?.title ?? null,
    }))
    return {
      now: Date.now(),
      version: 1,
      dshHome: home,
      sessionsOnDisk: d.inventory.length,
      projCacheSessions: d.proj?.tables?.sessions ? Object.keys(d.proj.tables.sessions).length : 0,
      recentSessions: top,
      kbRoots,
      kbDocs: kbStats().documentCount,
      skillCount: skillsList().length,
      layers: ['shortTerm', 'working', 'longTerm', 'proceduralSemantic'],
    }
  }

  return { overview, shortTerm, working, longTerm, proceduralSemantic, sessionMetaFromProj, refresh: () => { data(true); return true } }
}

/** 简单读取 settings.yaml（顶层/二级 键: 值），不存在或不可解析返回 null。 */
function readSettings(path) {
  try {
    const text = readFileSync(path, 'utf8')
    const out = {}
    let scope = null
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '')
      const indent = line.match(/^\s*/)[0].length
      const m = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/)
      if (!m) continue
      const [, ws, key, rest] = m
      const val = rest.replace(/^['"]|['"]$/g, '').trim()
      if (indent === 0 && val === '') {
        scope = key
      } else if (indent === 0) {
        out[key] = val || 'true'
        scope = null
      } else if (scope) {
        out[`${scope}.${key}`] = val || 'true'
      }
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

export const NOTE = '过程记忆 = 可复用技能/流程目录；语义记忆 = 知识库词项-向量索引容量（只读统计）。'
export { KB_INCLUDE, KB_EXCLUDE }
