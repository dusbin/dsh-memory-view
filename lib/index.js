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
 * 只读插件：不改写任何 DSH 状态。
 */

export const name = 'dsh-memory-view'

export const inject = ['webServer']

import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { createMemoryService, NOTE } from './host/service.mjs'

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

export function createDispatcher(service) {
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
  }
  return methods
}

/** 安全调用 dispatcher：未知方法 / 异常都归一为 RpcResult 错误。 */
export function safeDispatch(dispatcher, method, payload) {
  const fn = dispatcher && typeof method === 'string' ? dispatcher[method] : undefined
  if (typeof fn !== 'function') {
    return { ok: false, error: { code: 'unknown-method', message: `unknown method: ${method}`, details: {} } }
  }
  try {
    return fn(payload)
  } catch (e) {
    return { ok: false, error: { code: 'internal', message: String(e?.message ?? e), details: {} } }
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
  })
  const dispatcher = createDispatcher(service)

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
    ctx.provide('memoryView', { service, dispatch, cfg, overview: () => service.overview() })
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
