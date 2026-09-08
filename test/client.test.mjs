/**
 * dsh-memory-view — 浏览器 bundle 冒烟测试。
 * 用桩 window.__ModuleLoader__ / require('react'|'react-dom') 在 Node 里加载
 * lib/client.js，并对 exports.pure 暴露的纯函数做断言（不渲染 React 组件）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}
try {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
} catch {
  /* Node 自带只读 navigator 时忽略 */
}

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
vm.runInThisContext(code, { filename: 'client.js' })

assert.ok(captured, 'module loader entry captured')
assert.equal(captured.id, 'dsh-memory-view')

function fakeRequire(id) {
  if (id === 'react') return { createElement: (...a) => a, useSyncExternalStore: () => ({}) }
  if (id === 'react-dom') return { createPortal: (node) => node }
  return {}
}

let modExports = null
test('factory 可加载并导出插件体', () => {
  const module = { exports: {} }
  const exportsObj = module.exports
  const result = captured.factory((id) => fakeRequire(id))
  assert.ok(result)
  assert.equal(result.name, 'dsh-memory-view')
  assert.deepEqual(result.inject, ['slots', 'sessions', 'connection'])
  assert.equal(typeof result.apply, 'function')
  assert.ok(result.pure)
  assert.ok(result.DEFAULTS)
  modExports = result
})

test('pure.fmtBytes / fmtTime / pct / clampText', () => {
  const P = modExports.pure
  assert.equal(P.fmtBytes(512), '512 B')
  assert.equal(P.fmtBytes(2048), '2.0 KB')
  assert.equal(P.fmtBytes(5 * 1048576), '5.0 MB')
  assert.equal(P.pct(50, 200), '25%')
  assert.equal(P.pct(10, 0), '—')
  assert.equal(P.clampText('hello', 3), 'hel…')
  assert.equal(P.clampText('hi', 10), 'hi')
  assert.equal(typeof P.fmtTime(Date.now()), 'string')
  assert.equal(P.fmtTime(null), '—')
})

test('pure.pickSessionId 与 summarizeSessionList', () => {
  const P = modExports.pure
  const list = {
    ids: ['a', 'b'],
    current: 'b',
    byId: {
      a: { id: 'a', displayTitle: 'A', running: false },
      b: { id: 'b', title: 'B', running: true, pendingInteraction: { kind: 'question' }, updatedAt: 1000, projectionValues: { goal: { goal: { objective: 'x' } } } },
    },
  }
  assert.equal(P.pickSessionId(list), 'b')
  assert.equal(P.pickSessionId({ ids: ['a'] }), 'a')
  assert.equal(P.pickSessionId(null), null)
  const sum = P.summarizeSessionList(list)
  assert.equal(sum.length, 2)
  assert.equal(sum[1].running, true)
  assert.ok(sum[1].projectionValues.goal)
})
