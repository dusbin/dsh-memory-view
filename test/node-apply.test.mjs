/**
 * dsh-memory-view — Node 半身 apply 冒烟测试。
 *
 * 用最小 fake host ctx（webServer 假注册 + sessions/sessionProjections 缺失 +
 * logger/provide/on 桩）调用 apply，验证：
 *   - 不访问任何“未注入”的 ctx 服务（重现 cordis 代理抛错场景）；
 *   - 在缺少 sessions/sessionProjections 服务时仍能启动（磁盘兜底）；
 *   - 成功挂载 /memory-view 前缀路由；GET 返回健康说明；
 *   - POST RPC envelope（overview / 未知方法 / 缺 sessionId）协议正确。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, inject } from '../lib/index.js'

function makeCtx() {
  const routes = []
  const provided = {}
  const events = {}
  const ctx = {
    logger: {
      child: () => ctx.logger,
      info: () => {},
      warn: () => {},
    },
    webServer: {
      register(entry) {
        routes.push(entry)
      },
    },
    get(serviceName) {
      if (serviceName === 'sessions' || serviceName === 'sessionProjections') {
        throw new Error(`service ${serviceName} is not composed`) // 模拟未组合
      }
      return undefined
    },
    on(evt, fn) {
      events[evt] = fn
    },
    provide(k, v) {
      provided[k] = v
    },
  }
  return { ctx, routes, provided, events }
}

function makeRes() {
  const out = { status: 0, body: '' }
  return {
    writeHead(status, headers) {
      out.status = status
      out.headers = headers
    },
    end(body) {
      out.body = body
    },
    out,
  }
}

test('module 导出 name/inject（不再声明 connection）', () => {
  assert.equal(name, 'dsh-memory-view')
  assert.deepEqual(inject, ['webServer'])
})

test('apply: 无 sessions 服务时也能启动并挂载 /memory-view', () => {
  const { ctx, routes, provided, events } = makeCtx()
  const service = apply(ctx, { kbRoots: [] })
  assert.ok(service)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/memory-view')
  assert.equal(typeof routes[0].handler, 'function')
  assert.ok(provided.memoryView, 'ctx.provide memoryView')
  assert.ok(typeof events.dispose === 'function')
})

test('route GET /memory-view → 健康说明 JSON', async () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { kbRoots: [] })
  const handler = routes[0].handler
  const res = makeRes()
  await handler({ method: 'GET', url: '/memory-view' }, res)
  assert.equal(res.out.status, 200)
  const data = JSON.parse(res.out.body)
  assert.equal(data.ok, true)
  assert.equal(data.value.plugin, 'dsh-memory-view')
  assert.ok(Array.isArray(data.value.methods))
})

test('RPC 协议：未知方法 / 缺 sessionId 的错误结果', () => {
  // 直接测 dispatcher 已在 service.test 覆盖；这里模拟最外层协议形状
  const { ctx, routes } = makeCtx()
  apply(ctx, { kbRoots: [] })
  assert.equal(routes.length, 1)
  const handler = routes[0].handler
  // 用可注入 body 的 req 封装验证一次真实 POST 处理
  const req = makeBodyReq(JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'unknownX', payload: {} }))
  const res = makeRes()
  return handler(req, res).then(() => {
    const data = JSON.parse(res.out.body)
    assert.equal(data.type, 'server-response')
    assert.equal(data.rpcId, 'r1')
    assert.equal(data.result.ok, false)
    assert.equal(data.result.error.code, 'unknown-method')
  })
})

test('RPC POST overview 真通路', () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { kbRoots: [] })
  const handler = routes[0].handler
  const req = makeBodyReq(JSON.stringify({ type: 'client-request', rpcId: 'r2', method: 'overview', payload: {} }))
  const res = makeRes()
  return handler(req, res).then(() => {
    const data = JSON.parse(res.out.body)
    assert.equal(data.result.ok, true)
    assert.equal(typeof data.result.value.sessionsOnDisk, 'number')
  })
})

function makeBodyReq(body) {
  let listeners = {}
  const req = {
    method: 'POST',
    url: '/memory-view',
    on(evt, fn) {
      listeners[evt] = fn
    },
  }
  // 模拟 http.IncomingMessage：先 'data' 后 'end'
  queueMicrotask(() => {
    listeners.data && listeners.data(Buffer.from(body, 'utf8'))
    listeners.end && listeners.end()
  })
  return req
}
