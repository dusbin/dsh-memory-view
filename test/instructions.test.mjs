/**
 * dsh-memory-view — AGENTS.md 指令文件（发现 / 读取 / 写入）单元测试。
 * 伪造一棵项目树：$DSH_HOME/AGENTS.md + 带 .git 的项目根 + 子目录，
 * 校验发现链顺序、读取截断、原子写入、mtime 冲突、越权路径拒绝、备份。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildInstructionChain,
  listInstructionFiles,
  readInstruction,
  writeInstruction,
  createInstructionStore,
  findProjectRoot,
  normalizeCandidates,
} from '../lib/host/instructions.mjs'

function tmpRoot(tag) {
  const root = join(import.meta.dirname, '.tmp-instr-' + tag + '-' + Math.random().toString(36).slice(2, 7))
  mkdirSync(root, { recursive: true })
  return root
}

/** 构造：<root>/home (DSH_HOME) 与 <root>/proj/.git + <root>/proj/app */
function makeTree(tag) {
  const root = tmpRoot(tag)
  const home = join(root, 'home')
  const proj = join(root, 'proj')
  const app = join(proj, 'app')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(proj, '.git'), { recursive: true })
  mkdirSync(app, { recursive: true })
  writeFileSync(join(home, 'AGENTS.md'), '# global rules\n')
  writeFileSync(join(proj, 'AGENTS.md'), '# project rules\n')
  writeFileSync(join(app, 'AGENTS.local.md'), '# app local\n')
  return { root, home, proj, app }
}

const optsOf = (t) => ({ dshHome: t.home, cwd: t.app })

test('normalizeCandidates: 过滤非法候选名', () => {
  assert.deepEqual(normalizeCandidates(['a.md', '', '.', '..', 'x/y.md', 'b\\c.md'], ['d.md']), ['a.md'])
  assert.deepEqual(normalizeCandidates(undefined, ['AGENTS.md']), ['AGENTS.md'])
})

test('findProjectRoot: 向上找到含 .git 的目录', () => {
  const t = makeTree('root')
  assert.equal(findProjectRoot(t.app), t.proj)
  assert.equal(findProjectRoot(t.home) === t.proj, false) // home 不在项目内
  rmSync(t.root, { recursive: true, force: true })
})

test('buildInstructionChain: 全局 → 项目根 → cwd（宽泛到具体）', () => {
  const t = makeTree('chain')
  const chain = buildInstructionChain(optsOf(t))
  assert.equal(chain.entries[0].scope, 'global')
  assert.equal(chain.entries[0].dir, t.home)
  const projectDirs = chain.entries.filter((e) => e.scope === 'project').map((e) => e.dir)
  assert.deepEqual(projectDirs, [t.proj, t.app])
  // 每目录：基础候选在前，本地 overlay 在后
  const appEntry = chain.entries.find((e) => e.dir === t.app)
  assert.deepEqual(appEntry.files.map((f) => f.name), ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'])
  assert.equal(chain.projectRoot, t.proj)
  rmSync(t.root, { recursive: true, force: true })
})

test('listInstructionFiles: 标注存在与否 + 元信息', () => {
  const t = makeTree('list')
  const listed = listInstructionFiles(optsOf(t))
  const flat = listed.groups.flatMap((g) => g.files)
  const global = flat.find((f) => f.path === join(t.home, 'AGENTS.md'))
  const proj = flat.find((f) => f.path === join(t.proj, 'AGENTS.md'))
  const missing = flat.find((f) => f.path === join(t.proj, 'CLAUDE.md'))
  assert.equal(global.exists, true)
  assert.ok(global.size > 0 && global.mtimeMs > 0)
  assert.equal(proj.exists, true)
  assert.equal(missing.exists, false)
  assert.ok(listed.allowedPaths.includes(join(t.app, 'AGENTS.local.md')) || listed.allowedPaths.includes(join(t.app, 'AGENTS.md')))
  rmSync(t.root, { recursive: true, force: true })
})

test('readInstruction: 读取内容 + 按 maxSourceBytes 截断', () => {
  const t = makeTree('read')
  const chain = buildInstructionChain(optsOf(t))
  const r = readInstruction(join(t.proj, 'AGENTS.md'), { chain })
  assert.equal(r.content, '# project rules\n')
  assert.equal(r.truncated, false)
  const truncated = readInstruction(join(t.proj, 'AGENTS.md'), { chain, maxSourceBytes: 4 })
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.content, '# pr')
  // 越权路径（不在发现链内）
  writeFileSync(join(t.root, 'OTHER.md'), 'x')
  assert.throws(() => readInstruction(join(t.root, 'OTHER.md'), { chain }), /not an instruction candidate/)
  rmSync(t.root, { recursive: true, force: true })
})

test('writeInstruction: 原子写入 / 新建 / 备份 / 冲突 / 越权 / 超限', () => {
  const t = makeTree('write')
  const chain = buildInstructionChain(optsOf(t))
  const projAgents = join(t.proj, 'AGENTS.md')
  const before = statSync(projAgents).mtimeMs

  // 1) 覆盖写入（带正确 mtime）+ 备份
  const w1 = writeInstruction(projAgents, {
    chain,
    content: '# project rules v2\n',
    expectedMtimeMs: before,
    backupDir: join(t.root, 'backups'),
  })
  assert.equal(w1.created, false)
  assert.equal(readFileSync(projAgents, 'utf8'), '# project rules v2\n')
  assert.ok(w1.backupPath && existsSync(w1.backupPath))
  assert.equal(readFileSync(w1.backupPath, 'utf8'), '# project rules\n')
  assert.ok(readdirSync(join(t.root, 'backups')).length >= 1)

  // 2) mtime 冲突 → conflict（磁盘上文件已变）
  assert.throws(
    () => writeInstruction(projAgents, { chain, content: 'stale', expectedMtimeMs: before }),
    (e) => e.code === 'conflict' && Number.isFinite(e.currentMtimeMs),
  )

  // 3) 新建不存在的候选文件（create 默认允许）
  const newFile = join(t.app, 'AGENTS.md')
  const w2 = writeInstruction(newFile, { chain, content: '# app rules\n', backupDir: join(t.root, 'backups') })
  assert.equal(w2.created, true)
  assert.equal(readFileSync(newFile, 'utf8'), '# app rules\n')

  // 4) create:false 且文件不存在 → not-found
  assert.throws(() => writeInstruction(join(t.app, 'CLAUDE.md'), { chain, content: 'x', create: false }), (e) => e.code === 'not-found')

  // 5) 越权路径
  assert.throws(() => writeInstruction(join(t.root, 'ESCAPE.md'), { chain, content: 'x' }), (e) => e.code === 'forbidden')

  // 6) 超出写入上限
  assert.throws(
    () => writeInstruction(projAgents, { chain, content: 'a'.repeat(64), maxWriteBytes: 10 }),
    (e) => e.code === 'too-large',
  )
  rmSync(t.root, { recursive: true, force: true })
})

test('createInstructionStore: RPC 门面（list/read/write）', () => {  const t = makeTree('store')
  const store = createInstructionStore({
    dshHome: t.home,
    defaultCwd: t.app,
    instructions: { maxSourceBytes: 1000, maxWriteBytes: 1000, backup: true, backupDir: join(t.root, 'bk') },
  })
  const listed = store.list({ cwd: t.app })
  assert.equal(listed.cwd, t.app)
  assert.equal(listed.projectRoot, t.proj)
  assert.ok(listed.groups.length >= 3)
  assert.equal(listed.backup, true)
  assert.equal(listed.maxWriteBytes, 1000)

  const target = join(t.app, 'AGENTS.local.md')
  const read = store.read({ path: target, cwd: t.app })
  assert.equal(read.content, '# app local\n')

  const written = store.write({ path: target, cwd: t.app, content: '# app local v2\n', expectedMtimeMs: read.mtimeMs })
  assert.equal(written.created, false)
  assert.equal(store.read({ path: target, cwd: t.app }).content, '# app local v2\n')

  // 默认 cwd 回退
  const listed2 = store.list({})
  assert.equal(listed2.cwd, t.app)
  rmSync(t.root, { recursive: true, force: true })
})

test('RPC 层：instructionsList / Read / Write（含错误码透传）', async () => {
  const { createDispatcher, safeDispatch } = await import('../lib/index.js')
  const t = makeTree('rpc')
  const instructions = createInstructionStore({
    dshHome: t.home,
    defaultCwd: t.app,
    instructions: { backup: false, maxWriteBytes: 500 },
  })
  const fakeService = { overview: () => ({}), working: () => ({}), shortTerm: () => ({}), longTerm: () => ({}), proceduralSemantic: () => ({}), refresh: () => true, sessionInfo: () => null }
  const d = createDispatcher(fakeService, instructions)

  const listed = safeDispatch(d, 'instructionsList', { cwd: t.app })
  assert.equal(listed.ok, true)
  assert.equal(listed.value.projectRoot, t.proj)

  const target = join(t.proj, 'AGENTS.md')
  const read = safeDispatch(d, 'instructionsRead', { path: target, cwd: t.app })
  assert.equal(read.ok, true)
  assert.equal(read.value.content, '# project rules\n')

  const written = safeDispatch(d, 'instructionsWrite', { path: target, cwd: t.app, content: '# v2\n', expectedMtimeMs: read.value.mtimeMs })
  assert.equal(written.ok, true)
  assert.equal(written.value.created, false)

  // 越权路径 → forbidden 错误码（经 RpcResult 透出）
  const forbidden = safeDispatch(d, 'instructionsWrite', { path: join(t.root, 'X.md'), cwd: t.app, content: 'x' })
  assert.equal(forbidden.ok, false)
  assert.equal(forbidden.error.code, 'forbidden')

  // 缺参数 → invalid-input
  const bad = safeDispatch(d, 'instructionsWrite', { cwd: t.app, content: 'x' })
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'invalid-input')

  // 未启用 instructions 时 → disabled
  const d2 = createDispatcher(fakeService, null)
  const disabled = safeDispatch(d2, 'instructionsList', {})
  assert.equal(disabled.ok, false)
  assert.equal(disabled.error.code, 'disabled')
  rmSync(t.root, { recursive: true, force: true })
})
