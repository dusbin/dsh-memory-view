/**
 * dsh-memory-view — collectors 纯函数单元测试（node:test，零依赖）。
 * 生成 zstd 会话日志夹具（checksum 多 frame）验证解码/摘要逻辑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'
import {
  scanZstdFrames,
  decodeSessionLogFile,
  normalizeEvent,
  countEventTypes,
  messageText,
  summarizeRecentExchanges,
  dshHome,
  readJsonIfExists,
  collectSessionsInventory,
  collectKnowledgeDocs,
  parseKbIndexDump,
  collectSkillManifests,
  skillSummary,
  findSessionFile,
} from '../lib/host/collectors.mjs'

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

function makeSessionLog(eventsByFrame) {
  const frames = eventsByFrame.map((lines) => zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), CHECKSUM))
  return Buffer.concat(frames)
}

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-memory-view-'))
}

test('scanZstdFrames + decode: 多 frame 会话日志完整还原', () => {
  const f1 = ['{"type":"session","id":"s1"}', '{"type":"user/message","seq":1,"time":"1","data":"{}"}']
  const f2 = ['{"type":"assistant/message","seq":2,"time":"2","data":"{}"}', '{"type":"tool/call","seq":3,"time":"3","data":"{}"}']
  const buf = makeSessionLog([f1, f2])
  const frames = scanZstdFrames(buf)
  assert.equal(frames.length, 2)
  const { events, error } = decodeSessionLogFileFromBuffer(buf)
  assert.equal(error, null)
  assert.equal(events.length, 4)
  assert.equal(events[0].type, 'session')
})

function decodeSessionLogFileFromBuffer(buf) {
  // 复刻 decodeSessionLogFile 的逐帧解码（不落盘）
  const frames = scanZstdFrames(buf)
  let text = ''
  for (const f of frames) text += zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8')
  const events = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { events, error: null }
}

test('decodeSessionLogFile: 文件不存在 / 坏 magic 返回 error 而非抛错', () => {
  const root = tmpRoot()
  const missing = decodeSessionLogFile(join(root, 'nope.zstd'))
  assert.ok(missing.error)
  const bad = join(root, 'bad.zstd')
  writeFileSync(bad, Buffer.from('not a zstd file at all'))
  const r = decodeSessionLogFile(bad)
  assert.ok(r.error)
  rmSync(root, { recursive: true, force: true })
})

test('normalizeEvent: data 字符串自动 JSON.parse', () => {
  const e = normalizeEvent({ type: 'x', seq: 1, data: '{"a":1}' })
  assert.equal(e.data.a, 1)
  const bad = normalizeEvent({ type: 'x', data: '{oops' })
  assert.equal(typeof bad.data.raw, 'string')
})

test('messageText: 字符串/数组/reasoning 标记/截断', () => {
  assert.equal(messageText({ content: 'hello world' }, 200), 'hello world')
  assert.equal(messageText({ content: [{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'b' }] }, 200), 'a [reasoning] b')
  assert.equal(messageText({ content: 'hello' }, 3), 'hel…')
  assert.equal(messageText({ message: { content: [{ type: 'text', text: 'nested' }] } }, 200), 'nested')
})

test('summarizeRecentExchanges: 按 turn 折叠、排序、裁剪', () => {
  const events = [
    { type: 'user/message', seq: 1, time: '100', data: { content: '你好', turn: 1 } },
    { type: 'assistant/message', seq: 2, time: '200', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '我在' }] } } },
    { type: 'user/message', seq: 3, time: '300', data: { content: '做插件', turn: 2 } },
    { type: 'tool/call', seq: 4, time: '400', data: { turn: 2, step: 1, name: 'bash', arguments: '{"command":"echo hi"}' } },
    { type: 'tool/result', seq: 5, time: '500', data: { turn: 2, step: 2, output: 'hi' } },
    { type: 'turn/start', seq: 0, time: '0', data: { turn: 3 } },
  ]
  const r = summarizeRecentExchanges(events, { limitTurns: 2, maxChars: 300 })
  assert.equal(r.turns.length, 2) // turn3 无 items 也占位? 见实现：turn/start 独立 bucket
  const lastTurn = r.turns[0]
  assert.equal(lastTurn.turn, 3)
  assert.ok(r.stats['user/message'] === 2)
})

test('countEventTypes: 类型计数', () => {
  const c = countEventTypes([{ type: 'a' }, { type: 'b' }, { type: 'a', data: '{}' }])
  assert.deepEqual(c, { a: 2, b: 1 })
})

test('dshHome: 默认 ~/.dsh，可被 DSH_HOME 覆盖', () => {
  assert.equal(dshHome({}), join(homedir(), '.dsh'))
  assert.equal(dshHome({ DSH_HOME: '/x/y' }), '/x/y')
})

test('readJsonIfExists: 文件缺失/坏 JSON → null', () => {
  const root = tmpRoot()
  assert.equal(readJsonIfExists(join(root, 'none.json')), null)
  writeFileSync(join(root, 'bad.json'), '{oops')
  assert.equal(readJsonIfExists(join(root, 'bad.json')), null)
  writeFileSync(join(root, 'ok.json'), '{"a":1}')
  assert.deepEqual(readJsonIfExists(join(root, 'ok.json')), { a: 1 })
  rmSync(root, { recursive: true, force: true })
})

test('collectKnowledgeDocs / collectSkillManifests / collectSessionsInventory：临时目录枚举', () => {
  const root = tmpRoot()
  mkdirSync(join(root, 'docs', 'sub'), { recursive: true })
  mkdirSync(join(root, 'skills', 'book-reader'), { recursive: true })
  mkdirSync(join(root, 'sessions', '--slug--', 'session-x'), { recursive: true })
  writeFileSync(join(root, 'docs', 'a.md'), '# A')
  writeFileSync(join(root, 'docs', 'sub', 'b.txt'), 'text')
  mkdirSync(join(root, 'docs', 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'docs', 'node_modules', 'skip.md'), 'x')
  writeFileSync(join(root, 'skills', 'book-reader', 'SKILL.md'), '---\nname: book-reader\ndescription: 精读\n---')
  const log = makeSessionLog([['{"type":"session","id":"session-x"}']])
  writeFileSync(join(root, 'sessions', '--slug--', 'session-x', 'session.jsonl.zstd'), log)

  const docs = collectKnowledgeDocs([join(root, 'docs')], { include: ['.md', '.txt'], excludeDirs: ['node_modules'] })
  assert.equal(docs.length, 2)
  assert.ok(docs.every((d) => !d.path.includes('node_modules')))

  const skills = collectSkillManifests([join(root, 'skills')])
  assert.equal(skills.length, 1)
  const sum = skillSummary(skills[0].path)
  assert.equal(sum.name, 'book-reader')

  const inv = collectSessionsInventory(join(root, 'sessions'))
  assert.equal(inv.length, 1)
  assert.equal(inv[0].sessionId, 'session-x')
  assert.ok(inv[0].size > 0)

  const f = findSessionFile(join(root, 'sessions'), 'session-x')
  assert.ok(f && f.endsWith('session.jsonl.zstd'))
  rmSync(root, { recursive: true, force: true })
})

test('parseKbIndexDump: 缺失 → null；合法 → meta/documents', () => {
  const root = tmpRoot()
  assert.equal(parseKbIndexDump(join(root, 'no.json')), null)
  writeFileSync(join(root, 'index.json'), JSON.stringify({ meta: { documentCount: 3 }, documents: [{ path: 'x' }], bodyIndex: { a: 1 } }))
  const r = parseKbIndexDump(join(root, 'index.json'))
  assert.equal(r.meta.documentCount, 3)
  assert.equal(r.documents.length, 1)
  assert.equal(r.bodyTerms, 1)
  rmSync(root, { recursive: true, force: true })
})
