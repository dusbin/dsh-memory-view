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

/**
 * react 桩：bundle 在加载时 require('react') 拿到的是这个对象的引用，
 * 组件在渲染时才访问 React.useState 等属性 —— 因此测试里可以把“迷你 React”
 * 的方法合并进来（Object.assign），让同一份组件代码在 Node 里真的跑一遍。
 */
/**
 * 渲染树节点构造函数：bundle 加载时会执行 `var e = React.createElement` 把函数缓存下来，
 * 所以这里必须在**加载前**就提供「真正会构造树」的实现，之后注入 hook 才有意义。
 */
function miniCreateElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }
}

const reactStub = {
  createElement: miniCreateElement,
  useSyncExternalStore: () => ({}),
  Component: class { constructor(props) { this.props = props } },
  Fragment: 'Fragment',
}

function fakeRequire(id) {
  if (id === 'react') return reactStub
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
  assert.deepEqual(result.inject, ['slots', 'sessions'])
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

// ---------------------------------------------------------------------------
// 迷你 React：在 Node 里真正“渲染”一次函数组件（支持 useState/useEffect），
// 用来验证 AGENTS.md 页签的加载链路（列表 → 读取 → 编辑器），而不需要浏览器。
// ---------------------------------------------------------------------------
function createMiniReact() {
  let hooks = []   // 组件实例的 hook 单元格，按调用顺序排列
  let idx = 0      // 本次渲染中下一个 hook 的下标
  let pending = false
  let effects = []
  const React = {
    Fragment: 'Fragment',
    Component: class { constructor(props) { this.props = props } },
    createElement: miniCreateElement,
    useState(initial) {
      const i = idx++
      if (hooks.length <= i) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
      const cell = hooks[i]
      const set = (v) => { cell.value = typeof v === 'function' ? v(cell.value) : v; pending = true }
      return [cell.value, set]
    },
    useEffect(fn, deps) {
      const i = idx++
      const prev = hooks[i]
      const changed = !prev || !deps || !prev.deps || deps.some((d, k) => d !== prev.deps[k])
      if (changed) { hooks[i] = { deps }; effects.push(fn) }
    },
    useSyncExternalStore(_sub, get) { idx++; return get() },
  }
  return {
    React,
    begin: () => { idx = 0; pending = false; effects = [] },
    runEffects: () => { const list = effects; effects = []; list.forEach((f) => f()) },
    hasPending: () => pending,
  }
}

/** 递归收集渲染树里所有节点（用于断言）。 */
function flatten(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out }
  if (typeof node === 'object' && node.type !== undefined) {
    out.push(node)
    flatten(node.children, out)
  } else out.push(node)
  return out
}

/** 用迷你 React 渲染一个函数组件，直到不再有 setState 待处理（最多 6 轮）。 */
async function renderComponent(component, props, mini) {
  let tree = null
  for (let round = 0; round < 6; round++) {
    mini.begin()
    tree = component(props)
    mini.runEffects()
    await new Promise((resolve) => setImmediate(resolve)) // 让 fetch/ Promise 微任务跑完
    if (!mini.hasPending()) return tree
  }
  return tree
}

/** 桩 fetch：按 method 返回 canned envelope。 */
function stubFetch(canned) {
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body)
    const envelope = canned[body.method] || { result: { ok: false, error: { code: 'unknown-method', message: 'unknown method: ' + body.method, details: {} } } }
    return { json: async () => envelope }
  }
}

test('AGENTS.md 页签：list → read → 渲染出文件列表与编辑器', async () => {
  const mini = createMiniReact()
  const canned = {
    instructionsList: {
      result: {
        ok: true,
        value: {
          cwd: '/u/proj',
          projectRoot: '/u/proj',
          groups: [
            { dir: '/u/home', display: '~/.dsh', scope: 'global', files: [{ name: 'AGENTS.md', path: '/u/home/AGENTS.md', scope: 'global', kind: 'base', exists: true, size: 12, mtimeMs: 1 }] },
            { dir: '/u/proj', display: '.', scope: 'project', files: [{ name: 'AGENTS.md', path: '/u/proj/AGENTS.md', scope: 'project', kind: 'base', exists: false, size: 0, mtimeMs: 0 }] },
          ],
          maxSourceBytes: 1024,
          maxWriteBytes: 1024,
          backup: true,
        },
      },
    },
    instructionsRead: { result: { ok: true, value: { path: '/u/home/AGENTS.md', name: 'AGENTS.md', content: '# global rules\n', size: 15, mtimeMs: 1, truncated: false, bytes: 15 } } },
  }
  stubFetch(canned)
  Object.assign(reactStub, mini.React) // 让 bundle 里的 React 具备真实 useState/useEffect

  const tree = await renderComponent(modExports.components.InstructionsTab, { cwd: '/u/proj' }, mini)
  const nodes = flatten(tree)
  const textarea = nodes.find((n) => n && n.type === 'textarea')
  assert.ok(textarea, '应有编辑器 textarea')
  assert.equal(textarea.props.value, '# global rules\n')
  assert.equal(textarea.props.spellCheck, false)
  // 两个候选文件都出现在列表里（用 title 属性定位）
  const items = nodes.filter((n) => n && n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dsh-mv-instr-item'))
  assert.equal(items.length, 2)
  assert.ok(items.some((i) => i.props.title === '/u/proj/AGENTS.md'))
})

test('AGENTS.md 页签：宿主 Node 半身过旧（unknown-method）→ 提示重启而非空编辑器', async () => {
  const mini = createMiniReact()
  stubFetch({}) // 所有方法都返回 unknown-method
  Object.assign(reactStub, mini.React)
  const tree = await renderComponent(modExports.components.InstructionsTab, { cwd: '/u/proj' }, mini)
  const nodes = flatten(tree)
  assert.ok(!nodes.some((n) => n && n.type === 'textarea'), '不应出现编辑器（会让人误以为文件为空）')
  const text = JSON.stringify(nodes.filter((n) => typeof n === 'string'))
  assert.ok(/dsh web/.test(text), '错误提示里应包含“重启 dsh web”，实际：' + text.slice(0, 200))
})
