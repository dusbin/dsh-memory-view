/**
 * dsh-memory-view — Node 半身。
 *
 * 职责：
 *   1. 把四层记忆的“只读快照服务”（见 host/service.mjs + host/collectors.mjs）挂到
 *      DSH webserver 的 `/memory-view` RPC 通道（协议与 dsh-multi-tenant 的 /mt
 *      通道一致：POST {type:'client-request', rpcId, method, payload} →
 *      {type:'server-response', rpcId, result:{ok,value|error}}）。
 *   2. 优先用内存中的 sessions / sessionProjections 实时行，磁盘缓存兜底。
 *   3. ctx.provide('memoryView', …) 供其它插件复用。
 *
 * 记忆四层为只读投影；AGENTS.md / CLAUDE.md 指令文件支持查看与编辑
 * （编辑仅限发现链内的候选文件名，原子写入 + 覆盖前备份）。
 */

export const name = 'dsh-memory-view'

export const inject = ['webServer']

import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { createMemoryService, NOTE } from './host/service.mjs'
import {
  createInstructionStore,
  DEFAULT_BASE_CANDIDATES,
  DEFAULT_LOCAL_CANDIDATES,
  DEFAULT_ROOT_MARKERS,
} from './host/instructions.mjs'

export const DEFAULTS = {
  /** 覆盖 DSH home（默认 process.env.DSH_HOME ?? ~/.dsh）。 */
  dshHomeDir: '',
  /** knowledge-base roots（文档清单用；空 = 不扫长期文档）。 */
  kbRoots: [],
  /** knowledge-base 插件 dump 出的语义索引 index.json 路径（可选）。 */
  kbIndexJson: '',
  /** 技能清单扫描根目录（*.skill.md / SKILL.md）。 */
  skillRoots: [],
  /** 短期记忆默认参数。 */
  shortTerm: { limitTurns: 8, maxChars: 400 },
  /** 会话日志尾部解码上限（大文件不全量解压）。 */
  sessionTail: { maxFrames: 400, maxEvents: 2500 },
  /**
   * AGENTS.md / CLAUDE.md 指令文件的查看与编辑。
   * 发现规则与 @deepseek-ai/dsh-agent-instructions 对齐：$DSH_HOME/AGENTS.md
   * 为全局；项目 scope 从项目根（含 projectRootMarkers）逐级到会话 cwd，
   * 每级先基础候选、再本地 overlay 候选。
   */
  instructions: {
    enabled: true,
    baseCandidates: DEFAULT_BASE_CANDIDATES,
    localCandidates: DEFAULT_LOCAL_CANDIDATES,
    projectRootMarkers: DEFAULT_ROOT_MARKERS,
    /** 额外允许查看/编辑的根目录（每个目录本身的候选文件）。 */
    extraRoots: [],
    /** 单文件读取上限（字节），超出部分截断显示。 */
    maxSourceBytes: 1048576,
    /** 单次写入上限（字节）。 */
    maxWriteBytes: 262144,
    /** 覆盖已有文件前是否备份（默认备份到 $DSH_HOME/memory-view-backups）。 */
    backup: true,
    /** 备份目录（空 = $DSH_HOME/memory-view-backups）。 */
    backupDir: '',
  },
}

function deepMerge(base, override) {
  if (override === null || override === undefined) return base
  if (Array.isArray(base) || Array.isArray(override)) return override
  if (typeof base === 'object' && typeof override === 'object') {
    const out = { ...base }
    for (const key of Object.keys(override)) out[key] = deepMerge(base[key], override[key])
    return out
  }
  return override
}

export function resolveConfig(config) {
  const cfg = deepMerge(DEFAULTS, config || {})
  cfg.dshHomeDir = cfg.dshHomeDir && cfg.dshHomeDir.trim()
    ? String(cfg.dshHomeDir).replace(/^~\//, homedir() + '/')
    : process.env.DSH_HOME || join(homedir(), '.dsh')
  if (cfg.kbIndexJson && typeof cfg.kbIndexJson === 'string' && cfg.kbIndexJson.startsWith('~')) {
    cfg.kbIndexJson = cfg.kbIndexJson.replace(/^~\//, homedir() + '/')
  }
  return cfg
}

// ---------------------------------------------------------------------------
// RPC 分发（纯函数，便于单测）
// ---------------------------------------------------------------------------

export function createDispatcher(service, instructions = null) {
  const methods = {
    health() {
      return { ok: true, value: { alive: true, plugin: 'dsh-memory-view', layers: ['shortTerm', 'working', 'longTerm', 'proceduralSemantic'] } }
    },
    overview(_payload) {
      return { ok: true, value: service.overview() }
    },
    shortTerm(payload) {
      const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId ? payload.sessionId : null
      if (!sessionId) return { ok: false, error: { code: 'invalid-input', message: 'sessionId required', details: {} } }
      const value = service.shortTerm(sessionId, {
        limitTurns: payload?.limitTurns ?? undefined,
        maxChars: payload?.maxChars ?? undefined,
      })
      return { ok: true, value }
    },
    working(payload) {
      const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId ? payload.sessionId : null
      if (!sessionId) return { ok: false, error: { code: 'invalid-input', message: 'sessionId required', details: {} } }
      return { ok: true, value: service.working(sessionId) }
    },
    longTerm() {
      return { ok: true, value: service.longTerm() }
    },
    proceduralSemantic() {
      return { ok: true, value: service.proceduralSemantic() }
    },
    snapshot(payload) {
      const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId ? payload.sessionId : null
      const out = {
        overview: service.overview(),
        session: sessionId ? service.sessionInfo(sessionId) : null,
        working: sessionId ? service.working(sessionId) : null,
        shortTerm: sessionId ? service.shortTerm(sessionId, { limitTurns: payload?.limitTurns, maxChars: payload?.maxChars }) : null,
        longTerm: service.longTerm(),
        proceduralSemantic: service.proceduralSemantic(),
      }
      return { ok: true, value: out }
    },
    refresh() {
      service.refresh()
      return { ok: true, value: { refreshed: true } }
    },
    // ---- AGENTS.md / CLAUDE.md 指令文件（查看 + 编辑）----
    instructionsList(payload) {
      if (!instructions) return { ok: false, error: { code: 'disabled', message: 'instructions view disabled by config', details: {} } }
      return { ok: true, value: instructions.list({ cwd: payload?.cwd }) }
    },
    instructionsRead(payload) {
      if (!instructions) return { ok: false, error: { code: 'disabled', message: 'instructions view disabled by config', details: {} } }
      if (!payload?.path) return { ok: false, error: { code: 'invalid-input', message: 'path required', details: {} } }
      const value = instructions.read({ path: payload.path, cwd: payload.cwd })
      return { ok: true, value }
    },
    instructionsWrite(payload) {
      if (!instructions) return { ok: false, error: { code: 'disabled', message: 'instructions view disabled by config', details: {} } }
      if (!payload?.path) return { ok: false, error: { code: 'invalid-input', message: 'path required', details: {} } }
      if (typeof payload?.content !== 'string') return { ok: false, error: { code: 'invalid-input', message: 'content (string) required', details: {} } }
      const value = instructions.write({
        path: payload.path,
        cwd: payload.cwd,
        content: payload.content,
        expectedMtimeMs: payload.expectedMtimeMs,
        create: payload.create,
      })
      return { ok: true, value }
    },
  }
  return methods
}

/** 安全调用 dispatcher：未知方法 / 异常都归一为 RpcResult 错误（保留业务错误码）。 */
export function safeDispatch(dispatcher, method, payload) {
  const fn = dispatcher && typeof method === 'string' ? dispatcher[method] : undefined
  if (typeof fn !== 'function') {
    return { ok: false, error: { code: 'unknown-method', message: `unknown method: ${method}`, details: {} } }
  }
  try {
    return fn(payload)
  } catch (e) {
    const code = e && typeof e.code === 'string' && e.code ? e.code : 'internal'
    // 业务错误码（forbidden / conflict / too-large / not-found / io…）连同附加上下文一起透出，
    // 例如 conflict 会带 currentMtimeMs 供客户端提示“磁盘已改动”。
    const details = {}
    if (e && typeof e === 'object') {
      for (const [k, v] of Object.entries(e)) {
        if (k === 'code' || k === 'message' || k === 'stack' || k === 'name') continue
        details[k] = v
      }
    }
    return { ok: false, error: { code, message: String(e?.message ?? e), details } }
  }
}

// ---------------------------------------------------------------------------
// HTTP 小工具（同 /mt 通道协议）
// ---------------------------------------------------------------------------

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

// ---------------------------------------------------------------------------
// 插件 apply
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const log = ctx.logger?.child ? ctx.logger.child('memory-view') : ctx.logger
  const cfg = resolveConfig(config)
  const logInfo = (...a) => (log?.info ? log.info(...a) : console.log('[dsh-memory-view]', ...a))
  const logWarn = (...a) => (log?.warn ? log.warn(...a) : console.warn('[dsh-memory-view]', ...a))

  // 实时行提供者：sessions / sessionProjections（web profile 具备）
  let liveProvider = null
  let sessionsService = null
  try {
    sessionsService = ctx.get('sessions')
  } catch {
    sessionsService = null
  }
  let projections = null
  try {
    projections = ctx.get('sessionProjections')
  } catch {
    projections = null
  }
  if (sessionsService && projections) {
    liveProvider = {
      findSession(id) {
        try {
          const list = typeof sessionsService.list === 'function' ? sessionsService.list() : []
          return list.find((s) => s?.id === id) ?? null
        } catch {
          return null
        }
      },
      rowsFor(session) {
        try {
          const snap = projections.snapshot(session)
          return snap?.values ?? null
        } catch {
          return null
        }
      },
    }
    logInfo('live rows provider ready (sessions + sessionProjections)')
  } else {
    logWarn('sessions/sessionProjections not composed — 使用磁盘投影缓存（会话行可能非实时）')
  }

  const service = createMemoryService({
    dshHomeDir: cfg.dshHomeDir,
    kbRoots: cfg.kbRoots,
    kbIndexJson: cfg.kbIndexJson || null,
    skillRoots: cfg.skillRoots,
    liveProvider,
    tailFrames: cfg.sessionTail?.maxFrames ?? 400,
    tailEvents: cfg.sessionTail?.maxEvents ?? 2500,
  })
  const instructions = cfg.instructions?.enabled === false
    ? null
    : createInstructionStore({
      dshHome: cfg.dshHomeDir,
      defaultCwd: process.cwd(),
      instructions: cfg.instructions,
    })
  const dispatcher = createDispatcher(service, instructions)

  // 每个方法执行前先刷新一次磁盘索引（TTL 由 service 内部控制）
  const dispatch = (method, payload) => safeDispatch(dispatcher, method, payload)

  // 挂 /memory-view 通道
  try {
    ctx.webServer.register({
      kind: 'prefix',
      path: '/memory-view',
      handler: async (req, res) => {
        try {
          if ((req.method ?? 'GET') !== 'POST') {
            // GET：健康说明（浏览器直连排查用）
            if ((req.method ?? 'GET') === 'GET' && req.url === '/memory-view') {
              return sendJson(res, 200, {
                ok: true,
                value: { plugin: 'dsh-memory-view', note: NOTE, methods: Object.keys(dispatcher), dshHome: cfg.dshHomeDir },
              })
            }
            return sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required', details: {} } })
          }
          const envelope = await readJsonBody(req)
          const rpcId = envelope.rpcId ?? null
          const method = typeof envelope.method === 'string' ? envelope.method : null
          if (!method) {
            return sendJson(res, 400, { type: 'server-response', rpcId, result: { ok: false, error: { code: 'invalid-request', message: 'method required', details: {} } } })
          }
          const result = dispatch(method, envelope.payload ?? {})
          return sendJson(res, 200, { type: 'server-response', rpcId, result })
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: { code: 'invalid-request', message: String(e?.message ?? e), details: {} } })
        }
      },
    })
    logInfo('/memory-view channel mounted')
  } catch (e) {
    logWarn('webserver mount failed: %s（浏览器端将退化为仅 ctx.sessions 视图）', String(e?.message ?? e))
  }

  // 供其它插件复用
  try {
    ctx.provide('memoryView', { service, instructions, dispatch, cfg, overview: () => service.overview() })
  } catch {
    /* 非必须 */
  }

  // 生命周期
  ctx.on('dispose', () => {
    logInfo('disposed')
  })

  return service
}

export { NOTE, createMemoryService }
