/**
 * dsh-memory-view — 浏览器端 bundle（记忆查看面板）。
 *
 * 位置：
 *   - 会话标题栏右上角（conversation.session.header.actions）：🧠 记忆按钮；
 *   - 全应用浮层（shell.overlay，list 槽位，additive）：四层记忆查看面板。
 *
 * 数据：
 *   - 首选通过 ctx.connection.rpc.call('/memory-view', method, payload) 向 Node
 *     半身取完整快照（短期=会话日志解码 / 工作=投影行 / 长期=档案 / 过程语义）；
 *   - ctx.connection 不可用时退化为 ctx.sessions.list 的会话投影摘要。
 *
 * 加载方式：手写 client bundle（无需构建），格式与 tsdown 产出一致 ——
 * window.__ModuleLoader__.load({ id, factory })，依赖 react / react-dom。
 * 纯函数经 exports 暴露，可在 Node 中单测。
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-view',
  factory: (require) => {
    'use strict';
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var React = require('react');
    var ReactDOM = require('react-dom');

    // ---------------------------------------------------------------------
    // 配置与 i18n
    // ---------------------------------------------------------------------
    var DEFAULTS = {
      rpcPath: '/memory-view',
      defaultTab: 'shortTerm', // shortTerm | working | longTerm | proceduralSemantic
      autoRefreshMs: 6000, // 面板打开时自动刷新间隔；0 = 关闭
      shortTermTurns: 8, // 短期记忆展示最近 N 轮
      shortTermChars: 400, // 单条文本截断
      drawerWidth: 860,
      debug: false,
    };

    var dict = {
      zh: {
        btn: '🧠 记忆',
        title: '记忆查看',
        subtitle: 'DSH 四层记忆投影（只读）',
        close: '关闭',
        refresh: '刷新',
        refreshing: '刷新中…',
        auto: '自动刷新',
        layerShort: '短期记忆',
        layerWorking: '工作记忆',
        layerLong: '长期记忆',
        layerProcSem: '过程/语义记忆',
        noSession: '未选择会话',
        liveFallbackTitle: '服务端通道不可用',
        liveFallbackBody: '仅能展示 ctx.sessions 投影的会话摘要；Node 半身接入后可查看会话原文/档案/知识库。',
        errLoad: '加载失败',
        srcLive: '实时投影 + 磁盘档案',
        srcDisk: '磁盘档案',
        srcFallback: '仅浏览器投影',
        metaChrome: '记忆查看面板 · dsh-memory-view',
        goTool: '[工具]',
        goReason: '[思考]',
        goResult: '[结果]',
        turnPrefix: '第',
        turnSuffix: '轮',
        truncatedMore: '（更早轮次已折叠）',
        updatedAt: '更新于',
        statusRunning: '运行中',
        statusIdle: '空闲',
        workingGoal: '目标',
        workingPlan: '计划',
        workingTodos: '待办',
        workingStats: '运行统计',
        workingSubagents: '子代理',
        workingPressure: '上下文占用',
        workingTokens: 'Token 用量',
        workingPerm: '权限',
        noGoal: '无进行中目标',
        planInactive: '未激活（不在 plan 模式）',
        noTodos: '暂无待办',
        noSubagents: '无',
        source: '来源',
        longEnv: 'DSH 环境',
        longWorkspaces: '工作区',
        longSessions: '最近会话',
        longKb: '长期文档（知识库 roots）',
        longSettings: '设置',
        longSources: '档案文件',
        psSkills: '技能（过程记忆）',
        psIndex: '语义索引（knowledge-base）',
        psNote: '说明',
        bytes: '文档',
        docs: '文档',
        turn: '轮',
        empty: '（空）',
        none: '无',
        sessionsOnDisk: '磁盘会话',
        projSessions: '投影会话',
        skills: '技能',
        kbDocs: '知识文档',
        noData: '暂无数据，点「刷新」加载。',
      },
      en: {
        btn: '🧠 Memory',
        title: 'Memory view',
        subtitle: 'DSH four-layer memory projection (read-only)',
        close: 'Close',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        auto: 'Auto refresh',
        layerShort: 'Short-term',
        layerWorking: 'Working',
        layerLong: 'Long-term',
        layerProcSem: 'Procedural/Semantic',
        noSession: 'No session selected',
        liveFallbackTitle: 'Server channel unavailable',
        liveFallbackBody: 'Showing only ctx.sessions projections; connect the Node half for transcripts/archives/knowledge.',
        errLoad: 'Load failed',
        srcLive: 'live projection + disk archives',
        srcDisk: 'disk archives',
        srcFallback: 'browser projections only',
        metaChrome: 'Memory view panel · dsh-memory-view',
        goTool: '[tool]',
        goReason: '[reasoning]',
        goResult: '[result]',
        turnPrefix: 'Turn',
        turnSuffix: '',
        truncatedMore: '(earlier turns collapsed)',
        updatedAt: 'updated',
        statusRunning: 'running',
        statusIdle: 'idle',
        workingGoal: 'Goal',
        workingPlan: 'Plan',
        workingTodos: 'Todos',
        workingStats: 'Run stats',
        workingSubagents: 'Subagents',
        workingPressure: 'Context pressure',
        workingTokens: 'Token usage',
        workingPerm: 'Permissions',
        noGoal: 'no active goal',
        planInactive: 'inactive (not in plan mode)',
        noTodos: 'no todos',
        noSubagents: 'none',
        source: 'source',
        longEnv: 'DSH home',
        longWorkspaces: 'Workspaces',
        longSessions: 'Recent sessions',
        longKb: 'Long-term docs (KB roots)',
        longSettings: 'Settings',
        longSources: 'Archive files',
        psSkills: 'Skills (procedural)',
        psIndex: 'Semantic index (knowledge-base)',
        psNote: 'Notes',
        bytes: 'docs',
        docs: 'docs',
        turn: 'turn',
        empty: '(empty)',
        none: 'none',
        sessionsOnDisk: 'disk sessions',
        projSessions: 'projected',
        skills: 'skills',
        kbDocs: 'kb docs',
        noData: 'No data yet — press Refresh.',
      },
    };

    function uiLang() {
      try {
        return String(navigator.language || 'zh-CN').toLowerCase().startsWith('zh') ? 'zh' : 'en';
      } catch (_e) {
        return 'zh';
      }
    }
    var _ui = uiLang();
    function tt(key) {
      var table = dict[_ui] || dict.en;
      return table[key] !== undefined ? table[key] : key;
    }

    function deepMerge(base, override) {
      if (override === null || override === undefined) return base;
      if (Array.isArray(base) || Array.isArray(override)) return override;
      if (typeof base === 'object' && typeof override === 'object') {
        var out = {};
        for (var k in base) out[k] = deepMerge(base[k], override[k]);
        for (var k2 in override) if (!(k2 in base)) out[k2] = override[k2];
        return out;
      }
      return override;
    }

    // ---------------------------------------------------------------------
    // 纯工具（exports 暴露，Node 可测）
    // ---------------------------------------------------------------------
    function fmtTime(ms) {
      if (ms === null || ms === undefined || ms === 0) return '—';
      try {
        return new Date(Number(ms)).toLocaleString(_ui === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
      } catch (_e) {
        return String(ms);
      }
    }

    function fmtAgo(ms) {
      if (!ms) return '—';
      var d = Date.now() - Number(ms);
      if (d < 0) d = 0;
      var s = Math.floor(d / 1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60);
      if (m < 60) return m + 'm';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h';
      return Math.floor(h / 24) + 'd';
    }

    function fmtBytes(n) {
      if (!Number.isFinite(n)) return '—';
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1048576).toFixed(1) + ' MB';
    }

    function pct(part, total) {
      if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return '—';
      return Math.round((part / total) * 100) + '%';
    }

    function clampText(s, n) {
      if (typeof s !== 'string') return '';
      return s.length > n ? s.slice(0, n) + '…' : s;
    }

    /** 从 ctx.sessions.list 快照选当前会话 id（无则取第一个）。 */
    function pickSessionId(listState) {
      if (!listState) return null;
      if (listState.current) return listState.current;
      var ids = Array.isArray(listState.ids) ? listState.ids : [];
      return ids.length ? ids[0] : null;
    }

    /** 把 ctx.sessions.list 快照折叠为最小会话摘要数组（降级视图用）。 */
    function summarizeSessionList(listState) {
      if (!listState || !listState.byId) return [];
      var out = [];
      var ids = Array.isArray(listState.ids) ? listState.ids : [];
      for (var i = 0; i < ids.length; i++) {
        var row = listState.byId[ids[i]];
        if (!row) continue;
        out.push({
          id: row.id,
          title: row.displayTitle || row.title || row.id,
          running: !!row.running,
          pendingInteraction: row.pendingInteraction || null,
          updatedAt: row.updatedAt || null,
          projectionValues: row.projectionValues || null,
        });
      }
      return out;
    }

    // ---------------------------------------------------------------------
    // 模块级 store：面板开关 / 标签 / 目标会话 / 数据 / 刷新 tick
    // 注意：状态必须“整体替换”而不是原地修改 —— useSyncExternalStore 依赖
    // getSnapshot() 返回新引用才重渲染（attention / chat-fold 同款约定）。
    // ---------------------------------------------------------------------
    var state = {
      open: false,
      tab: DEFAULTS.defaultTab,
      targetSessionId: null,
      data: null, // { overview, working, shortTerm, longTerm, proceduralSemantic, source }
      loading: false,
      error: null,
      loadedAt: 0,
      loadedSessionId: null,
      fallback: null, // 降级：ctx.sessions 摘要
      autoRefresh: true,
    };
    var listeners = [];
    function publish() {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](); } catch (_e) { /* ignore */ }
      }
    }
    function subscribe(fn) {
      listeners.push(fn);
      return function () {
        var at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
    function getState() { return state; }
    function patchState(next) {
      var merged = {};
      for (var k in state) if (Object.hasOwn(state, k)) merged[k] = state[k];
      for (var k2 in next) if (Object.hasOwn(next, k2)) merged[k2] = next[k2];
      state = merged; // 新引用 → useSyncExternalStore 检测到变化
      publish();
    }

    var opts = DEFAULTS;
    var ctx = null;
    var timer = null;

    function debugLog() {
      if (!opts.debug) return;
      var a = [].slice.call(arguments);
      a.unshift('[dsh-memory-view]');
      try { console.log.apply(console, a); } catch (_e) { /* ignore */ }
    }

    // ---------------------------------------------------------------------
    // 数据加载
    // ---------------------------------------------------------------------
    function currentSessionId() {
      var id = state.targetSessionId;
      if (id) return id;
      try {
        var snap = ctx && ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot() : null;
        if (snap && snap.current) return snap.current;
      } catch (_e) { /* ignore */ }
      return null;
    }

    var rpcSeq = 0;
    /**
     * 同源 HTTP RPC：POST {type:'client-request', rpcId, method, payload} →
     * {type:'server-response', rpcId, result:{ok, value|error}}。
     * 用 fetch 直连（与 host 的 /memory-view 前缀路由一致），带超时中断，
     * 不依赖 ctx.connection 内部通道，保证请求一定会 settle。
     */
    function rpc(method, payload) {
      return new Promise(function (resolve, reject) {
        var rpcId = 'mv-' + (++rpcSeq) + '-' + Date.now();
        var settled = false;
        var timer = null;
        function finish(fn, value) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          fn(value);
        }
        try {
          var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          timer = setTimeout(function () {
            if (ctrl) { try { ctrl.abort(); } catch (_e) { /* ignore */ } }
            finish(reject, new Error('rpc timeout after 15s'));
          }, 15000);
          fetch(opts.rpcPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ type: 'client-request', rpcId: rpcId, method: method, payload: payload || {} }),
            signal: ctrl ? ctrl.signal : undefined,
          })
            .then(function (res) {
              return res.json().catch(function () { throw new Error('non-json response (http ' + res.status + ')') })
            })
            .then(function (envelope) {
              var result = envelope && envelope.result;
              if (result && result.ok === true) {
                finish(resolve, result.value);
              } else {
                var msg = (result && result.error && result.error.message) || 'rpc error';
                var code = (result && result.error && result.error.code) || 'rpc-error';
                var err = new Error(String(msg));
                err.code = code;
                finish(reject, err);
              }
            })
            .catch(function (e) {
              finish(reject, e);
            });
        } catch (e) {
          finish(reject, e);
        }
      });
    }

    var reqSeq = 0;
    function loadData(forceSpinner) {
      if (!state.open) return Promise.resolve();
      // 不设 loading 互斥早退：每次都真正发起请求，旧响应由 seq 丢弃，
      // 保证 loading 一定会被某次成功/失败/超时清掉（不会卡“正在加载”）。
      var sessionId = currentSessionId();
      var seq = ++reqSeq;
      patchState({ loading: true, error: null });
      if (forceSpinner) publish();
      return rpc('snapshot', {
        sessionId: sessionId || undefined,
        limitTurns: opts.shortTermTurns,
        maxChars: opts.shortTermChars,
      }).then(function (value) {
        if (seq !== reqSeq) return value; // 过期请求：不写状态
        patchState({ data: value, loading: false, loadedAt: Date.now(), error: null, source: 'live', loadedSessionId: sessionId });
        return value;
      }).catch(function (err) {
        if (seq !== reqSeq) return null;
        debugLog('snapshot rpc failed:', err && err.message);
        // 降级：ctx.sessions 摘要
        var fb = null;
        try {
          var snap = ctx.sessions.list.getSnapshot();
          fb = summarizeSessionList(snap);
        } catch (_e) { /* ignore */ }
        patchState({ loading: false, error: String((err && err.message) || err), fallback: fb, source: 'fallback', loadedSessionId: null });
        return null;
      });
    }

    function refreshNow() {
      if (!state.open) return;
      loadData(true);
    }

    // ---------------------------------------------------------------------
    // 渲染小工具
    // ---------------------------------------------------------------------
    var e = React.createElement;
    function el(type, props, children) {
      return e.apply(null, [type, props].concat(children || []));
    }
    function div(props, children) { return el('div', props, children || []); }
    function span(props, text) { return el('span', props, text); }
    function kv(label, value, extra) {
      return div({ className: 'dsh-mv-kv' + (extra ? ' ' + extra : '') }, [
        span({ className: 'dsh-mv-kv-label' }, label),
        span({ className: 'dsh-mv-kv-value' }, value === null || value === undefined || value === '' ? tt('none') : String(value)),
      ]);
    }
    function chip(text, cls) {
      return span({ className: 'dsh-mv-chip' + (cls ? ' ' + cls : '') }, text);
    }
    function section(title, children, extra) {
      return div({ className: 'dsh-mv-section' + (extra ? ' ' + extra : '') }, [
        div({ className: 'dsh-mv-section-title' }, title),
        div({ className: 'dsh-mv-section-body' }, children),
      ]);
    }
    function card(title, children, extra) {
      return div({ className: 'dsh-mv-card' + (extra ? ' ' + extra : '') }, [
        div({ className: 'dsh-mv-card-title' }, title || ''),
        div({ className: 'dsh-mv-card-body' }, children),
      ]);
    }
    function jsonish(value, max) {
      try {
        return clampText(JSON.stringify(value, null, 1), max || 500);
      } catch (_e2) {
        return String(value);
      }
    }

    // ---------------------------------------------------------------------
    // Tab：短期记忆
    // ---------------------------------------------------------------------
    function renderShortTerm(st) {
      if (!st || !st.recentTurns) {
        return div({ className: 'dsh-mv-empty' }, tt('noData'));
      }
      var rows = [];
      // 顶部：上下文占用
      var cp = st.contextPressure || null;
      var cb = st.contextBreakdown || null;
      if (cp || cb) {
        var parts = [];
        if (cb) {
          parts.push(div({ className: 'dsh-mv-note-line' }, [
            span(null, 'system '),
            chip(String(cb.systemTokens ?? 0), 'dsh-mv-chip-t'),
            span(null, ' · tools '),
            chip(String(cb.toolsTokens ?? 0), 'dsh-mv-chip-t'),
            span(null, ' · messages '),
            chip(String(cb.messageTokens ?? 0), 'dsh-mv-chip-t'),
          ]));
        }
        if (cp) {
          parts.push(div({ className: 'dsh-mv-meter' }, [
            div({ className: 'dsh-mv-meter-track' }, [
              div({
                className: 'dsh-mv-meter-fill',
                style: { width: pct(cp.surfaceTokens || 0, cp.contextWindow || 1) },
              }),
            ]),
            span({ className: 'dsh-mv-meter-label' },
              'surface ' + (cp.surfaceTokens ?? '?') + ' / window ' + (cp.contextWindow ?? '?') + ' · pressure ' +
              (cp.pressureTokens ?? '?') + ' (' + pct(cp.pressureTokens || 0, cp.contextWindow || 1) + ')'),
          ]));
        }
        rows.push(section(tt('workingPressure'), parts, 'dsh-mv-pad'));
      }
      // 事件类型统计
      var stats = st.stats || {};
      var keys = Object.keys(stats).sort(function (a, b) { return stats[b] - stats[a]; });
      if (keys.length) {
        rows.push(div({ className: 'dsh-mv-chip-row' }, keys.slice(0, 10).map(function (k) {
          return chip(k + ' ×' + stats[k], 'dsh-mv-chip-muted');
        })));
      }
      // 最近轮次
      if (st.eventTypes === 0 && (!st.recentTurns || !st.recentTurns.length)) {
        rows.push(div({ className: 'dsh-mv-empty' }, tt('empty')));
      }
      (st.recentTurns || []).forEach(function (turn, ti) {
        var items = (turn.items || []).map(function (it, ii) {
          var kind = it.kind || '';
          var label = '';
          var cls = 'dsh-mv-it dsh-mv-it-' + kind;
          if (kind === 'user') label = '你';
          else if (kind === 'assistant') label = 'AI';
          else if (kind === 'tool') label = tt('goTool');
          else if (kind === 'tool-result') label = tt('goResult');
          else label = '◆';
          var text = (it.text || '').replace(/\[reasoning\]/g, tt('goReason'));
          return div({ className: cls, key: 'i' + ti + '-' + ii }, [
            span({ className: 'dsh-mv-it-kind' }, label),
            span({ className: 'dsh-mv-it-text' }, text || '…'),
          ]);
        });
        var head = div({ className: 'dsh-mv-turn-head' }, [
          chip(tt('turnPrefix') + ' ' + turn.turn + ' ' + tt('turnSuffix'), 'dsh-mv-chip-turn'),
          span({ className: 'dsh-mv-turn-time' }, fmtTime(turn.at)),
        ]);
        rows.push(div({ className: 'dsh-mv-turn', key: 't' + ti }, [head].concat(items)));
      });
      if (st.truncated) rows.push(div({ className: 'dsh-mv-note' }, tt('truncatedMore')));
      if (st.tailTruncated) rows.push(div({ className: 'dsh-mv-note' }, '(log tail)'));
      if (st.found === false) rows.push(div({ className: 'dsh-mv-note dsh-mv-note-warn' }, 'session log: ' + (st.error || 'not found')));
      return div(null, rows);
    }

    // ---------------------------------------------------------------------
    // Tab：工作记忆
    // ---------------------------------------------------------------------
    function renderWorking(w) {
      if (!w || !w.rows) return div({ className: 'dsh-mv-empty' }, tt('noData'));
      var r = w.rows;
      var out = [];
      // 目标
      var goal = r.goal;
      var goalCard = card(tt('workingGoal'), [
        goal && goal.goal
          ? [kv('objective', clampText(goal.goal.objective, 220)),
             kv('phase', goal.goal.phase),
             kv('id', goal.goal.id),
             kv('rounds', (goal.roundsStarted ?? 0) + ' / ' + (goal.goal.maxGoalRounds ?? '—'))]
          : span({ className: 'dsh-mv-empty' }, tt('noGoal')),
      ], 'dsh-mv-card-accent');
      // 计划
      var plan = r.plan;
      var planCard = card(tt('workingPlan'), [
        plan && plan.active
          ? [kv('active', 'true'), kv('wanted', plan.wanted ? String(plan.wanted) : '—'), kv('running', plan.running ? String(plan.running) : '—')]
          : span({ className: 'dsh-mv-empty' }, tt('planInactive')),
      ]);
      // 运行统计
      var ss = r.sessionStats || {};
      var statsCard = card(tt('workingStats'), [
        kv('turns / steps', (ss.turns ?? '—') + ' / ' + (ss.steps ?? '—')),
        kv('openStep', ss.openStep === null || ss.openStep === undefined ? '—' : String(ss.openStep)),
        kv('pendingCalls', ss.pendingCalls && Object.keys(ss.pendingCalls).length ? jsonish(ss.pendingCalls, 300) : tt('none')),
        kv('llm / tool ms', ((ss.llmMs ?? 0) / 1000).toFixed(1) + 's / ' + ((ss.toolMs ?? 0) / 1000).toFixed(1) + 's'),
      ]);
      out.push(div({ className: 'dsh-mv-grid2' }, [goalCard, planCard]));
      out.push(div({ className: 'dsh-mv-grid2' }, [statsCard, renderTodosCard(r)]));
      out.push(renderSubagentCard(r));
      out.push(renderPressureCard(r));
      out.push(renderTokensCard(r));
      if (r.permissions) out.push(div({ className: 'dsh-mv-grid2' }, [
        card(tt('workingPerm'), [
          kv('preset', r.permissions.preset),
          kv('sandbox', r.permissions.sandbox),
          kv('approval', r.permissions.approval),
        ]),
        div(null, []),
      ]));
      out.push(div({ className: 'dsh-mv-note' }, tt('source') + ': ' + (w.source === 'live+disk' ? tt('srcLive') : w.source === 'disk' ? tt('srcDisk') : String(w.source || '—'))));
      return div(null, out);
    }

    function renderTodosCard(r) {
      var todos = Array.isArray(r.todos) ? r.todos : null;
      var items = todos && todos.length
        ? todos.map(function (t, i) {
            return div({ className: 'dsh-mv-todo dsh-mv-todo-' + (t.status || ''), key: i }, [
              chip(t.status || '?', 'dsh-mv-chip-status'),
              span(null, t.content || ''),
            ]);
          })
        : [span({ className: 'dsh-mv-empty' }, tt('noTodos'))];
      return card(tt('workingTodos'), items, 'dsh-mv-card-accent');
    }

    function renderSubagentCard(r) {
      var sub = r.subagent;
      var rows = [];
      if (sub && typeof sub === 'object') {
        var entries = Object.keys(sub);
        if (entries.length) {
          entries.forEach(function (k) {
            var v = sub[k];
            rows.push(kv(k, typeof v === 'string' ? v : jsonish(v, 200)));
          });
        }
      }
      var timing = r.subagentTiming;
      if (timing) rows.push(kv('timing.settledMs', timing.settledMs ?? '—'));
      if (!rows.length) rows.push(span({ className: 'dsh-mv-empty' }, tt('noSubagents')));
      return div({ className: 'dsh-mv-grid2' }, [card(tt('workingSubagents'), rows), div(null, [])]);
    }

    function renderPressureCard(r) {
      var cp = r.contextPressure;
      var cb = r.contextBreakdown;
      var body = [];
      if (cp) {
        body.push(kv('surfaceTokens', cp.surfaceTokens ?? '—'));
        body.push(kv('contextWindow', cp.contextWindow ?? '—'));
        body.push(kv('pressureTokens', cp.pressureTokens ?? '—'));
        body.push(div({ className: 'dsh-mv-meter' }, [
          div({ className: 'dsh-mv-meter-track' }, [
            div({ className: 'dsh-mv-meter-fill dsh-mv-meter-fill-warn', style: { width: pct(cp.surfaceTokens || 0, cp.contextWindow || 1) } }),
          ]),
        ]));
      }
      if (cb) {
        body.push(div({ className: 'dsh-mv-note-line' }, [
          chip('system ' + (cb.systemTokens ?? '?'), 'dsh-mv-chip-t'),
          chip('tools ' + (cb.toolsTokens ?? '?'), 'dsh-mv-chip-t'),
          chip('messages ' + (cb.messageTokens ?? '?'), 'dsh-mv-chip-t'),
        ]));
      }
      if (!body.length) body.push(span({ className: 'dsh-mv-empty' }, tt('none')));
      return div({ className: 'dsh-mv-grid2' }, [card(tt('workingPressure'), body), div(null, [])]);
    }

    function renderTokensCard(r) {
      var tu = r.tokenUsage;
      if (!tu) return null;
      var body = [];
      if (tu.totals) {
        body.push(kv('outputTokens', tu.totals.outputTokens ?? '—'));
        body.push(kv('cacheReadTokens', tu.totals.cacheReadTokens ?? '—'));
        body.push(kv('uncachedInputTokens', tu.totals.uncachedInputTokens ?? '—'));
      }
      return div({ className: 'dsh-mv-grid2' }, [card(tt('workingTokens'), body), div(null, [])]);
    }

    // ---------------------------------------------------------------------
    // Tab：长期记忆
    // ---------------------------------------------------------------------
    function renderLongTerm(lt) {
      if (!lt) return div({ className: 'dsh-mv-empty' }, tt('noData'));
      var out = [];
      out.push(section(tt('longEnv'), [
        kv('dshHome', lt.dshHome),
        kv('sessionsRoot', lt.sessionsRoot),
        kv('projection cache sessions', lt.projCacheSessions ?? '—'),
        kv('archive files', lt.archivedSessionFiles ?? '—'),
      ]));
      var workspaces = Array.isArray(lt.workspaces) ? lt.workspaces : [];
      if (workspaces.length) {
        out.push(section(tt('longWorkspaces'), workspaces.map(function (w, i) {
          return div({ className: 'dsh-mv-row', key: i }, [
            chip(String(w.sessionCount), 'dsh-mv-chip'),
            span({ className: 'dsh-mv-row-main' }, w.title || w.path),
            span({ className: 'dsh-mv-row-sub' }, (w.path || '') + ' · ' + fmtAgo(w.updatedAt)),
          ]);
        })));
      }
      var recent = Array.isArray(lt.recentSessions) ? lt.recentSessions : [];
      if (recent.length) {
        out.push(section(tt('longSessions'), recent.map(function (s, i) {
          return div({ className: 'dsh-mv-row', key: i }, [
            span({ className: 'dsh-mv-row-main' }, s.title || s.sessionId),
            span({ className: 'dsh-mv-row-sub' }, [
              span(null, s.sessionId + ' · '),
              span(null, fmtBytes(s.size) + ' · '),
              span(null, fmtAgo(s.mtimeMs) + ' · '),
              span({ className: 'dsh-mv-mono' }, s.slug),
            ]),
          ]);
        })));
      }
      out.push(renderKbDocs(lt.kbDocs));
      if (lt.settings && Object.keys(lt.settings).length) {
        out.push(section(tt('longSettings'), Object.keys(lt.settings).map(function (k) {
          return kv(k, clampText(lt.settings[k], 160), 'dsh-mv-kv-mono');
        })));
      }
      var sources = Array.isArray(lt.longTermSources) ? lt.longTermSources : [];
      if (sources.length) {
        out.push(section(tt('longSources'), sources.map(function (s, i) {
          return kv(s.key, s.path, 'dsh-mv-kv-mono');
        })));
      }
      return div(null, out);
    }

    function renderKbDocs(kb) {
      if (!kb || !kb.documentCount) return section(tt('longKb'), [span({ className: 'dsh-mv-empty' }, tt('none'))]);
      var out = [
        kv('docs', kb.documentCount + ' (' + fmtBytes(kb.bytes) + ')'),
        div({ className: 'dsh-mv-chip-row' }, Object.keys(kb.byExt || {}).map(function (ext) {
          return chip(ext + ' ×' + kb.byExt[ext], 'dsh-mv-chip-muted');
        })),
      ];
      (kb.roots || []).forEach(function (r, i) { out.push(kv('root ' + (i + 1), r, 'dsh-mv-kv-mono')); });
      return section(tt('longKb'), out);
    }

    // ---------------------------------------------------------------------
    // Tab：过程/语义记忆
    // ---------------------------------------------------------------------
    function renderProcSem(ps) {
      if (!ps) return div({ className: 'dsh-mv-empty' }, tt('noData'));
      var out = [];
      // 技能
      var skills = Array.isArray(ps.skills) ? ps.skills : [];
      out.push(section(tt('psSkills') + ' (' + skills.length + ')', skills.length
        ? skills.map(function (s, i) {
            return div({ className: 'dsh-mv-skill', key: i }, [
              span({ className: 'dsh-mv-skill-name' }, s.name || s.file),
              div({ className: 'dsh-mv-skill-desc' }, s.description || ''),
              div({ className: 'dsh-mv-row-sub' }, s.path || s.dir || ''),
            ]);
          })
        : [span({ className: 'dsh-mv-empty' }, tt('none') + '（' + ((ps.skillRoots || []).length ? 'scan roots configured' : '未配置 skillRoots') + '）')]));
      // 语义索引
      var idx = ps.kbIndex;
      if (idx) {
        out.push(section(tt('psIndex'), [
          kv('documents', idx.documentCount ?? '—'),
          kv('body terms / title terms', (idx.bodyTerms ?? '—') + ' / ' + (idx.titleTerms ?? '—')),
          kv('embedding', (idx.embeddingDimensions ?? '—') + 'd ' + (idx.embeddingEnabled ? 'enabled' : 'off')),
          kv('generatedAt', fmtTime(Date.parse(idx.generatedAt) || null)),
          kv('avgLen', idx.avgLen ?? '—'),
          div({ className: 'dsh-mv-chip-row' }, (idx.roots || []).map(function (r, i) {
            return chip(r, 'dsh-mv-chip-muted');
          })),
          div({ className: 'dsh-mv-note' }, 'index file: ' + idx.path),
        ]));
      }
      out.push(renderKbDocs(ps.kbDocs));
      if (ps.notes) out.push(section(tt('psNote'), [div({ className: 'dsh-mv-note' }, ps.notes)]));
      return div(null, out);
    }

    // ---------------------------------------------------------------------
    // 降级视图（无 Node 半身）
    // ---------------------------------------------------------------------
    function renderFallback(fb) {
      if (!fb || !fb.length) return div({ className: 'dsh-mv-empty' }, tt('liveFallbackBody'));
      return section(tt('longSessions'), fb.map(function (s, i) {
        var pv = s.projectionValues || {};
        var badge = s.running ? chip(tt('statusRunning'), 'dsh-mv-chip-run') : null;
        return div({ className: 'dsh-mv-row', key: i }, [
          badge || chip(tt('statusIdle'), 'dsh-mv-chip-muted'),
          span({ className: 'dsh-mv-row-main' }, s.title),
          span({ className: 'dsh-mv-row-sub' }, [
            span(null, s.id + ' · '),
            span(null, fmtAgo(s.updatedAt)),
            pv.goal ? span({ className: 'dsh-mv-row-goal' }, ' · ' + clampText(pv.goal.goal && pv.goal.goal.objective || jsonish(pv.goal, 60), 90)) : null,
          ]),
        ]);
      }));
    }

    // ---------------------------------------------------------------------
    // 顶部概览 chips
    // ---------------------------------------------------------------------
    function overviewChips(snapshot) {
      if (!snapshot) return [];
      var o = snapshot.overview || {};
      var out = [];
      if (o.sessionsOnDisk !== undefined) out.push(chip('🗂 ' + o.sessionsOnDisk + ' ' + tt('sessionsOnDisk'), 'dsh-mv-chip-run'));
      if (o.projCacheSessions !== undefined) out.push(chip(o.projCacheSessions + ' ' + tt('projSessions'), 'dsh-mv-chip-muted'));
      if (o.kbDocs !== undefined) out.push(chip('📚 ' + o.kbDocs + ' ' + tt('kbDocs'), 'dsh-mv-chip-muted'));
      if (o.skillCount !== undefined) out.push(chip('🧩 ' + o.skillCount + ' ' + tt('skills'), 'dsh-mv-chip-muted'));
      return out;
    }

    // ---------------------------------------------------------------------
    // 面板主组件
    // ---------------------------------------------------------------------
    function onToggleOpen() {
      var next = !state.open;
      if (next) {
        var sid = null;
        try {
          var snap = ctx.sessions.list.getSnapshot();
          sid = snap && snap.current;
        } catch (_e) { /* ignore */ }
        // 注意：不要在这里把 loading 置 true —— loadData 内部会置位并发起请求；
        // 若先置 loading 再调 loadData，会被旧的互斥早退跳过，导致永远 loading。
        patchState({ open: true, targetSessionId: sid || state.targetSessionId, error: null });
        loadData(true);
        ensureTimer();
      } else {
        patchState({ open: false });
      }
    }

    // 面板由“按钮所在组件”直接渲染（portal），不依赖 shell.overlay 等外部槽位：
    // 按钮可见 ⇔ 组件已挂载 ⇔ 点击后必然立即出现面板。
    function MemoryButton() {
      var st = React.useSyncExternalStore(subscribe, getState);
      var btn = e(
        'button',
        {
          type: 'button',
          className: st.open ? 'dsh-mv-open-btn on' : 'dsh-mv-open-btn',
          onClick: function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            onToggleOpen();
          },
          title: tt('title'),
          'aria-label': tt('title'),
        },
        tt('btn'),
      );
      if (!st.open) return btn;
      return el(React.Fragment, null, [btn, buildDrawer(st)]);
    }

    function safeTabContent(st, d, sessionId) {
      try {
        if (st.tab === 'shortTerm') return renderShortTerm(d.shortTerm);
        if (st.tab === 'working') return renderWorking(d.working || { sessionId: sessionId, rows: {}, source: '—' });
        if (st.tab === 'longTerm') return renderLongTerm(d.longTerm);
        return renderProcSem(d.proceduralSemantic);
      } catch (err) {
        return div({ className: 'dsh-mv-error' }, tt('errLoad') + ': ' + clampText(String((err && err.message) || err), 300));
      }
    }

    function buildDrawer(st) {
      var header = div({ className: 'dsh-mv-drawer-header' }, [
        div({ className: 'dsh-mv-drawer-title' }, [
          div(null, tt('title')),
          div({ className: 'dsh-mv-drawer-sub' }, tt('subtitle')),
        ]),
        div({ className: 'dsh-mv-drawer-actions' }, [
          e('label', { className: 'dsh-mv-auto' }, [
            e('input', {
              type: 'checkbox',
              checked: !!st.autoRefresh,
              onChange: function (ev) {
                patchState({ autoRefresh: !!ev.target.checked });
                ensureTimer();
              },
            }),
            span(null, tt('auto')),
          ]),
          e('button', { type: 'button', className: 'dsh-mv-btn', onClick: refreshNow, disabled: !!st.loading },
            st.loading ? tt('refreshing') : '⟳ ' + tt('refresh')),
          e('button', { type: 'button', className: 'dsh-mv-btn dsh-mv-btn-close', onClick: function () { patchState({ open: false }); } }, '✕'),
        ]),
      ]);

      var tabs = [
        { key: 'shortTerm', label: tt('layerShort') },
        { key: 'working', label: tt('layerWorking') },
        { key: 'longTerm', label: tt('layerLong') },
        { key: 'proceduralSemantic', label: tt('layerProcSem') },
      ];
      var nav = div({ className: 'dsh-mv-tabs' }, tabs.map(function (t) {
        return e('button', {
          type: 'button',
          key: t.key,
          className: 'dsh-mv-tab' + (st.tab === t.key ? ' on' : ''),
          onClick: function () { patchState({ tab: t.key }); },
        }, t.label);
      }));

      // 会话上下文行
      var sessionId = currentSessionId();
      var sessionLine = div({ className: 'dsh-mv-session-line' }, [
        span({ className: 'dsh-mv-session-ico' }, '💬'),
        span({ className: 'dsh-mv-session-id' }, sessionId || tt('noSession')),
      ]);

      var meta = div({ className: 'dsh-mv-meta' }, [
        metaChips(st),
        div({ className: 'dsh-mv-meta-right' }, st.loadedAt ? tt('updatedAt') + ' ' + fmtTime(st.loadedAt) : ''),
      ]);

      var needSid = currentSessionId();
      var showLoading = st.loading && (!st.data || st.loadedSessionId !== needSid);
      var body;
      if (showLoading) {
        body = div({ className: 'dsh-mv-empty dsh-mv-loading' }, '⏳ ' + tt('refreshing') + (needSid ? ' · ' + needSid : ''));
      } else if (!st.data) {
        if (st.error) {
          body = div({ className: 'dsh-mv-error' }, [
            div(null, tt('errLoad') + ': ' + clampText(st.error, 300)),
            div(null, [e('button', { type: 'button', className: 'dsh-mv-btn', onClick: refreshNow }, tt('refresh'))]),
            st.fallback ? renderFallback(st.fallback) : null,
          ]);
        } else {
          body = div({ className: 'dsh-mv-empty' }, tt('noData'));
        }
      } else {
        body = div({ className: 'dsh-mv-body' }, safeTabContent(st, st.data, needSid));
      }

      return ReactDOM.createPortal(
        el('div', { className: 'dsh-mv-portal' }, [
          div({ className: 'dsh-mv-backdrop', onClick: function () { patchState({ open: false }); } }),
          div({ className: 'dsh-mv-drawer', 'data-plugin': 'dsh-memory-view', role: 'dialog', 'aria-label': tt('title') }, [
            header,
            sessionLine,
            meta,
            nav,
            body,
            div({ className: 'dsh-mv-footer' }, tt('metaChrome')),
          ]),
        ]),
        document.body,
      );
    }

    function metaChips(st) {
      var out = overviewChips(st.data);
      if (st.source === 'fallback') {
        out.unshift(chip(tt('srcFallback'), 'dsh-mv-chip-warn'));
      } else if (st.source === 'live') {
        out.unshift(chip(tt('srcLive'), 'dsh-mv-chip-run'));
      }
      return div({ className: 'dsh-mv-chip-row' }, out);
    }

    // ---------------------------------------------------------------------
    // 定时器
    // ---------------------------------------------------------------------
    function ensureTimer() {
      if (timer) { clearInterval(timer); timer = null; }
      if (!state.open || !state.autoRefresh || !opts.autoRefreshMs) return;
      timer = setInterval(function () {
        if (!state.open) return;
        if (state.loading) return;
        loadData(false);
      }, opts.autoRefreshMs);
      if (timer && timer.unref) try { timer.unref(); } catch (_e) { /* ignore */ }
    }

    // ---------------------------------------------------------------------
    // 插件体
    // ---------------------------------------------------------------------
    exports.name = 'dsh-memory-view';
    exports.inject = ['slots', 'sessions'];

    exports.apply = function apply(pluginCtx, config) {
      ctx = pluginCtx;
      opts = deepMerge(DEFAULTS, config || {});
      state.tab = opts.defaultTab || 'shortTerm';

      // 样式
      var style = document.createElement('style');
      style.dataset.plugin = 'dsh-memory-view';
      style.dataset.pluginCss = 'dsh-memory-view/css';
      style.textContent = CSS;
      document.head.appendChild(style);

      // 标题栏按钮（面板由 MemoryButton 组件直接以 portal 渲染，见组件实现，
      // 无需占用 shell.overlay 等其他槽位）
      ctx.slots.inject('conversation.session.header.actions', function () {
        var dispose = ctx.slots.register(
          { name: 'conversation.session.header.actions', id: 'dsh-memory-view-open', order: 40 },
          MemoryButton,
        );
        return function () { try { dispose(); } catch (_e) { /* ignore */ } };
      });

      // 会话切换时若面板打开则重新拉取
      var unsubList = null;
      try {
        if (ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.subscribe === 'function') {
          var lastCurrent = null;
          unsubList = ctx.sessions.list.subscribe(function () {
            try {
              var snap = ctx.sessions.list.getSnapshot();
              var cur = snap && snap.current;
              if (cur && cur !== lastCurrent) {
                lastCurrent = cur;
                if (state.open) {
                  patchState({ targetSessionId: cur });
                  loadData(true);
                }
              }
            } catch (_e) { /* ignore */ }
          });
        }
      } catch (_e) { /* ignore */ }

      ctx.effect(function () {
        return function () {
          // 卸载 / HMR：清理定时器与监听
          if (timer) { clearInterval(timer); timer = null; }
          if (unsubList) { try { unsubList(); } catch (_e) { /* ignore */ } }
          listeners = [];
          state.open = false;
          if (style && style.parentNode) style.parentNode.removeChild(style);
        };
      }, 'dsh-memory-view: teardown');

      debugLog('activated', { rpc: opts.rpcPath, sessions: typeof ctx.sessions, slots: typeof ctx.slots, connection: typeof ctx.connection });
      return module.exports;
    };

    // 供 Node 单测引用的纯函数
    exports.DEFAULTS = DEFAULTS;
    exports.pure = {
      fmtTime: fmtTime,
      fmtAgo: fmtAgo,
      fmtBytes: fmtBytes,
      pct: pct,
      clampText: clampText,
      pickSessionId: pickSessionId,
      summarizeSessionList: summarizeSessionList,
      tt: tt,
    };

    // ---------------------------------------------------------------------
    // 样式
    // ---------------------------------------------------------------------
    var CSS = '' +
      '.dsh-mv-open-btn{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;border-radius:8px;' +
      'border:1px solid color-mix(in srgb,var(--dsw-alias-fg,#555) 25%,transparent);background:transparent;cursor:pointer;}' +
      '.dsh-mv-open-btn.on{background:color-mix(in srgb,var(--dsw-alias-accent,#4a6cf7) 18%,transparent);}' +
      '.dsh-mv-portal{position:fixed;inset:0;z-index:2147483000;}' +
      '.dsh-mv-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.16);cursor:default;}' +
      '.dsh-mv-loading{display:flex;align-items:center;justify-content:center;min-height:160px;font-size:14px;}' +
      '.dsh-mv-drawer{position:fixed;top:0;right:0;bottom:0;width:min(var(--dsh-mv-w,860px),100vw);z-index:2147483000;' +
      'display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-fg,#222);' +
      'box-shadow:-8px 0 32px rgba(0,0,0,.22);font-size:13px;line-height:1.5;}' +
      '.dsh-mv-drawer-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:14px 16px 8px;}' +
      '.dsh-mv-drawer-title{font-size:16px;font-weight:700;}' +
      '.dsh-mv-drawer-sub{font-size:11px;opacity:.6;margin-top:2px;}' +
      '.dsh-mv-drawer-actions{display:flex;align-items:center;gap:6px;}' +
      '.dsh-mv-btn{border:1px solid color-mix(in srgb,var(--dsw-alias-fg,#555) 30%,transparent);background:transparent;' +
      'border-radius:8px;padding:3px 9px;font-size:12px;cursor:pointer;color:inherit;}' +
      '.dsh-mv-btn-close{font-weight:700;}' +
      '.dsh-mv-auto{display:inline-flex;align-items:center;gap:4px;font-size:11px;opacity:.8;cursor:pointer;}' +
      '.dsh-mv-session-line{display:flex;align-items:center;gap:6px;padding:2px 16px 6px;opacity:.75;font-family:ui-monospace,Menlo,monospace;font-size:11px;}' +
      '.dsh-mv-meta{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 16px 6px;flex-wrap:wrap;}' +
      '.dsh-mv-meta-right{font-size:11px;opacity:.55;}' +
      '.dsh-mv-tabs{display:flex;gap:4px;padding:4px 16px 8px;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);}' +
      '.dsh-mv-tab{border:0;background:transparent;padding:5px 12px;border-radius:10px;cursor:pointer;font-size:13px;color:inherit;opacity:.65;}' +
      '.dsh-mv-tab.on{background:color-mix(in srgb,var(--dsw-alias-accent,#4a6cf7) 16%,transparent);opacity:1;font-weight:600;}' +
      '.dsh-mv-body{flex:1;overflow:auto;padding:10px 16px 20px;}' +
      '.dsh-mv-footer{font-size:10px;opacity:.45;text-align:center;padding:6px;border-top:1px solid color-mix(in srgb,currentColor 8%,transparent);}' +
      '.dsh-mv-section{margin:10px 0;}' +
      '.dsh-mv-section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;opacity:.6;margin:12px 0 4px;}' +
      '.dsh-mv-card{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;padding:10px 12px;min-width:0;}' +
      '.dsh-mv-card-accent{border-color:color-mix(in srgb,var(--dsw-alias-accent,#4a6cf7) 35%,transparent);}' +
      '.dsh-mv-card-title{font-weight:700;font-size:12px;margin-bottom:6px;opacity:.8;}' +
      '.dsh-mv-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin:8px 0;}' +
      '.dsh-mv-kv{display:flex;gap:8px;margin:3px 0;}' +
      '.dsh-mv-kv-label{opacity:.55;min-width:130px;flex:0 0 auto;}' +
      '.dsh-mv-kv-value{word-break:break-all;}' +
      '.dsh-mv-kv-mono .dsh-mv-kv-value{font-family:ui-monospace,Menlo,monospace;font-size:11px;}' +
      '.dsh-mv-chip-row{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;}' +
      '.dsh-mv-chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;background:color-mix(in srgb,currentColor 10%,transparent);}' +
      '.dsh-mv-chip-muted{opacity:.55;}' +
      '.dsh-mv-chip-run{background:color-mix(in srgb,#34c759 16%,transparent);color:#1e7b34;}' +
      '.dsh-mv-chip-warn{background:color-mix(in srgb,#ff9f0a 20%,transparent);color:#9a6100;}' +
      '.dsh-mv-chip-t{margin-right:2px;}' +
      '.dsh-mv-chip-turn{background:color-mix(in srgb,var(--dsw-alias-accent,#4a6cf7) 20%,transparent);}' +
      '.dsh-mv-chip-status{min-width:74px;text-align:center;font-weight:600;}' +
      '.dsh-mv-turn{margin:8px 0;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:10px;padding:6px 10px;}' +
      '.dsh-mv-turn-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}' +
      '.dsh-mv-turn-time{font-size:11px;opacity:.5;}' +
      '.dsh-mv-it{display:flex;gap:8px;padding:3px 2px;border-radius:6px;}' +
      '.dsh-mv-it-kind{flex:0 0 34px;font-size:11px;font-weight:700;opacity:.7;text-align:right;}' +
      '.dsh-mv-it-text{white-space:pre-wrap;word-break:break-word;font-size:12px;}' +
      '.dsh-mv-it-user .dsh-mv-it-kind{color:#2563eb;}' +
      '.dsh-mv-it-assistant .dsh-mv-it-kind{color:#059669;}' +
      '.dsh-mv-it-tool .dsh-mv-it-kind{color:#7c3aed;}' +
      '.dsh-mv-it-tool-result .dsh-mv-it-kind{color:#64748b;}' +
      '.dsh-mv-it-meta .dsh-mv-it-kind{color:#b45309;}' +
      '.dsh-mv-todo{display:flex;gap:8px;align-items:baseline;padding:2px 0;}' +
      '.dsh-mv-row{display:flex;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px dashed color-mix(in srgb,currentColor 8%,transparent);}' +
      '.dsh-mv-row-main{font-weight:600;flex:0 1 auto;min-width:120px;max-width:40%;word-break:break-all;}' +
      '.dsh-mv-row-sub{flex:1;opacity:.6;font-size:11px;font-family:ui-monospace,Menlo,monospace;word-break:break-all;}' +
      '.dsh-mv-row-goal{opacity:1;}' +
      '.dsh-mv-skill{margin:4px 0;padding:6px 8px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:10px;}' +
      '.dsh-mv-skill-name{font-weight:700;}' +
      '.dsh-mv-skill-desc{opacity:.75;font-size:12px;margin-top:2px;}' +
      '.dsh-mv-meter{display:flex;align-items:center;gap:8px;margin:4px 0;}' +
      '.dsh-mv-meter-track{flex:1;height:6px;border-radius:3px;background:color-mix(in srgb,currentColor 12%,transparent);overflow:hidden;}' +
      '.dsh-mv-meter-fill{height:100%;background:var(--dsw-alias-accent,#4a6cf7);border-radius:3px;}' +
      '.dsh-mv-meter-fill-warn{background:#ff9f0a;}' +
      '.dsh-mv-meter-label{font-size:10px;opacity:.6;white-space:nowrap;}' +
      '.dsh-mv-note{font-size:11px;opacity:.55;margin:6px 0;}' +
      '.dsh-mv-note-warn{opacity:.9;color:#b45309;}' +
      '.dsh-mv-note-line{font-size:11px;margin:4px 0;}' +
      '.dsh-mv-pad{margin-top:4px;}' +
      '.dsh-mv-empty{opacity:.55;padding:8px 2px;font-style:italic;}' +
      '.dsh-mv-error{padding:10px;border:1px solid #ef4444aa;border-radius:10px;background:#ef444410;margin:6px 0;}' +
      '.dsh-mv-mono{font-family:ui-monospace,Menlo,monospace;}';

    return module.exports;
  },
});
