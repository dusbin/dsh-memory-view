/**
 * dsh-memory-view — 服务核心 + RPC 分发单元测试。
 * 用临时目录伪造一个 ~/.dsh（storages/workspace.json、projection 缓存、
 * sessions/<slug>/<sid>/session.jsonl.zstd、知识库 roots、skills），
 * 校验四层快照的数据组装与 dispatcher 协议。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { constants } from 'node:zlib'
import { createMemoryService } from '../lib/host/service.mjs'
import { createDispatcher, resolveConfig, safeDispatch, DEFAULTS } from '../lib/index.js'

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const frame = (lines) => zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), CHECKSUM)

function makeFakeHome(root) {
  const sessions = join(root, 'sessions', '--Users-u--')
  const storages = join(root, 'storages')
  mkdirSync(join(sessions, 'session-abc'), { recursive: true })
  mkdirSync(join(sessions, 'session-def'), { recursive: true })
  mkdirSync(storages, { recursive: true })
  mkdirSync(join(root, 'kb', 'notes', 'sub'), { recursive: true })
  mkdirSync(join(root, 'skills', 'book-reader'), { recursive: true })

  const log = Buffer.concat([
    frame(['{"type":"session","id":"session-abc","cwd":"/u"}']),
    frame([
      '{"type":"turn/start","seq":1,"time":"1","data":{"turn":1}}',
      '{"type":"user/message","seq":2,"time":"2","data":{"turn":1,"content":[{"type":"text","text":"你好"}]}}',
      '{"type":"assistant/message","seq":3,"time":"3","data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"我在"}]}}}',
      '{"type":"tool/call","seq":4,"time":"4","data":{"turn":1,"step":2,"name":"bash","arguments":"{\\"command\\":\\"echo hi\\"}"}}',
      '{"type":"goal/change","seq":5,"time":"5","data":{"operation":"create","goal":{"objective":"做个插件","id":"g1"}}}',
    ]),
  ])
  writeFileSync(join(sessions, 'session-abc', 'session.jsonl.zstd'), log)
  writeFileSync(join(sessions, 'session-def', 'session.jsonl.zstd'), frame(['{"type":"session","id":"session-def"}']))

  writeFileSync(join(storages, 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['w1'], archivedSessionIds: [] },
    tables: { workspaces: { w1: { path: '/u', title: 'u', sessionIds: ['session-abc', 'session-def'], createdAt: '2026-01-01', updatedAt: '2026-01-02' } } },
  }))
  const mkRow = (val) => ({ ver: 1, seq: 1, val })
  writeFileSync(join(storages, 'session_projcache.json'), JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    tables: {
      sessions: {
        'session-abc': {
          identity: { createdAt: 1, cwd: '/u' },
          rows: {
            title: mkRow('测试会话'),
            sessionStats: mkRow({ turns: 1, steps: 5, pendingCalls: {}, openStep: null }),
            goal: mkRow({ goal: { id: 'g1', phase: 'active', objective: '做个插件' }, roundsStarted: 1 }),
            plan: mkRow({ active: false, wanted: null, running: null }),
            todos: mkRow([{ content: '第一步', status: 'in_progress' }, { content: '第二步', status: 'pending' }]),
            contextPressure: mkRow({ surfaceTokens: 100, contextWindow: 1000, pressureTokens: 200 }),
            contextBreakdown: mkRow({ systemTokens: 1, toolsTokens: 2, messageTokens: 100 }),
            tokenUsage: mkRow({ totals: { outputTokens: 9 } }),
            subagent: mkRow({}),
            permissions: mkRow({ preset: 'workspace-write' }),
            sessionListMetadata: mkRow({ lastPromptAt: 123 }),
            imageLimits: mkRow(null),
            subagentTiming: mkRow({ descriptorSeen: false, settledMs: 0 }),
          },
        },
        'session-def': { identity: { createdAt: 2, cwd: '/u' }, rows: { title: mkRow('旧会话') } },
      },
    },
  }))
  writeFileSync(join(root, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 1\nagent-default-model:\n  provider: deepseek-official\n')
  writeFileSync(join(root, 'kb', 'notes', 'a.md'), '# A 知识')
  writeFileSync(join(root, 'kb', 'notes', 'sub', 'b.md'), '# B')
  writeFileSync(join(root, 'skills', 'book-reader', 'SKILL.md'), '---\nname: book-reader\ndescription: 精读电子书\n---\n当用户要求精读时使用。')
  writeFileSync(join(root, 'index.json'), JSON.stringify({
    meta: { documentCount: 2, generatedAt: '2026-01-01', roots: [join(root, 'kb')], semanticWeight: 0.5, embeddingDimensions: 512, embeddingEnabled: false },
    documents: [{ path: 'a.md' }, { path: 'b.md' }],
    bodyIndex: { x: 1 },
  }))
  return { sessions, storages }
}

test('resolveConfig: 默认 dshHome & 覆盖', () => {
  const cfg = resolveConfig(undefined)
  assert.ok(cfg.dshHomeDir.length > 0)
  const cfg2 = resolveConfig({ dshHomeDir: '/tmp/x', kbRoots: ['/a'] })
  assert.equal(cfg2.dshHomeDir, '/tmp/x')
  assert.deepEqual(cfg2.kbRoots, ['/a'])
  assert.equal(cfg2.shortTerm.limitTurns, DEFAULTS.shortTerm.limitTurns)
})

test('service.overview: 会话/知识库/技能统计', () => {
  const root = makeTmp()
  const kb = join(root, 'kb')
  const svc = createMemoryService({
    dshHomeDir: root,
    kbRoots: [kb],
    kbIndexJson: join(root, 'index.json'),
    skillRoots: [join(root, 'skills')],
  })
  const o = svc.overview()
  assert.equal(o.sessionsOnDisk, 2)
  assert.equal(o.projCacheSessions, 2)
  assert.equal(o.kbDocs, 2)
  assert.ok(o.skillCount >= 1)
  rmSync(root, { recursive: true, force: true })
})

test('service.working: 磁盘行 + 实时行覆盖', () => {
  const root = makeTmp()
  const kb = join(root, 'kb')
  const liveRows = { title: '实时标题', liveOnly: { a: 1 } }
  const svc = createMemoryService({
    dshHomeDir: root,
    kbRoots: [kb],
    liveProvider: { findSession: () => ({ id: 'session-abc' }), rowsFor: () => liveRows },
  })
  const w = svc.working('session-abc')
  assert.equal(w.rows.title, '实时标题') // live 覆盖 disk
  assert.ok(w.rows.goal.goal.phase === 'active') // disk 仍在
  assert.deepEqual(w.rows.liveOnly, { a: 1 })
  rmSync(root, { recursive: true, force: true })
})

test('service.shortTerm: 解码最近交换并按 turn 折叠', () => {
  const root = makeTmp()
  const svc = createMemoryService({ dshHomeDir: root, kbRoots: [] })
  const st = svc.shortTerm('session-abc', { limitTurns: 5, maxChars: 300 })
  assert.equal(st.title, '测试会话')
  assert.equal(st.found, true)
  assert.ok(st.recentTurns.length >= 1)
  const turn = st.recentTurns.find((t) => t.turn === 1)
  assert.ok(turn)
  const kinds = turn.items.map((i) => i.kind)
  assert.ok(kinds.includes('user'))
  assert.ok(kinds.includes('assistant'))
  assert.ok(kinds.includes('tool'))
  assert.ok(turn.items.find((i) => i.text.includes('你好')))
  assert.equal(st.contextPressure.pressureTokens, 200)
  rmSync(root, { recursive: true, force: true })
})

test('service.longTerm: workspace 与 KB 文档统计', () => {
  const root = makeTmp()
  const kb = join(root, 'kb')
  const svc = createMemoryService({ dshHomeDir: root, kbRoots: [kb] })
  const lt = svc.longTerm()
  assert.equal(lt.workspaces.length, 1)
  assert.equal(lt.workspaces[0].sessionCount, 2)
  assert.equal(lt.kbDocs.documentCount, 2)
  assert.ok(lt.recentSessions.length >= 2)
  assert.ok(lt.settings && Object.keys(lt.settings).length > 0)
  rmSync(root, { recursive: true, force: true })
})

test('service.proceduralSemantic: 技能 + 语义索引 dump', () => {
  const root = makeTmp()
  const kb = join(root, 'kb')
  const svc = createMemoryService({
    dshHomeDir: root,
    kbRoots: [kb],
    kbIndexJson: join(root, 'index.json'),
    skillRoots: [join(root, 'skills')],
  })
  const ps = svc.proceduralSemantic()
  assert.ok(ps.skills.length >= 1)
  assert.equal(ps.skills[0].name, 'book-reader')
  assert.equal(ps.kbIndex.documentCount, 2)
  assert.equal(ps.kbIndex.bodyTerms, 1)
  rmSync(root, { recursive: true, force: true })
})

test('dispatcher: 协议与错误处理', () => {
  const root = makeTmp()
  const svc = createMemoryService({ dshHomeDir: root, kbRoots: [] })
  const d = createDispatcher(svc)
  const health = d.health()
  assert.equal(health.ok, true)
  const bad = safeDispatch(d, 'unknownMethod', {})
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'unknown-method')
  const st = d.shortTerm({})
  assert.equal(st.ok, false) // 缺 sessionId
  const ok = d.working({ sessionId: 'session-abc' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.sessionId, 'session-abc')
  // 方法抛异常 → internal
  const boom = { snapshot() { throw new Error('boom') } }
  const b2 = safeDispatch(boom, 'snapshot', {})
  assert.equal(b2.ok, false)
  assert.equal(b2.error.code, 'internal')
  rmSync(root, { recursive: true, force: true })
})

function makeTmp() {
  const root = join(import.meta.dirname, '.tmp-home-' + Math.random().toString(36).slice(2, 8))
  mkdirSync(root, { recursive: true })
  makeFakeHome(root)
  return root
}
