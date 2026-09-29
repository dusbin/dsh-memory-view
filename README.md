# dsh-memory-view — DeepSeek Harness 记忆查看插件

把 DeepSeek Harness（DSH）的**真实运行状态**投影为**四层记忆**的只读查看器：

| 层 | 认知隐喻 | 看到的是 DSH 里的什么 |
| --- | --- | --- |
| 🕐 **短期记忆** | 眼前的交换 | 会话的最近 N 轮（用户/AI 文本、工具调用与结果、goal/todo 变化），来自会话事件日志（`session.jsonl.zstd` 解码，`node:zlib` 内置 zstd，零第三方依赖） |
| ⚙️ **工作记忆** | 正在推进的任务 | `goal` / `plan` / `todos` / `sessionStats` / `subagent` / `contextPressure` / `contextBreakdown` / `tokenUsage` / `permissions` 等**会话投影行**（优先取内存中 `sessionProjections.snapshot`，磁盘投影缓存兜底） |
| 🗄 **长期记忆** | 跨会话的沉淀 | DSH home、工作区索引（workspace.json → 会话档案）、最近会话清单（标题/体量/时间）、设置、知识库 roots 长期文档统计 |
| 🧩 **过程 / 语义记忆** | 会做什么 & 理解的相似性 | 技能清单（`SKILL.md` / `*.skill.md`，= 过程记忆）+ knowledge-base 语义索引 dump 统计（文档/词项/向量维度，= 语义记忆容量） |

> DSH 没有名为 “memory” 的独立存储——agent 的状态都落在真实会话记录、投影行与磁盘文件中。
> 本插件的「记忆分层」是**展示性认知隐喻**（详情见 [docs/MODEL.md](docs/MODEL.md)），每一处都标注了
> 「来自哪个真实字段 / 文件」。只读，不改写任何 DSH 状态。

**当前版本：v0.2.0**（变更记录见 [CHANGELOG.md](CHANGELOG.md)）

## 效果

- 会话标题栏右上角出现 **「🧠 记忆」** 按钮；
- 点击打开右侧全高抽屉面板，五个页签：**短期 / 工作 / 长期 / 过程语义 / AGENTS.md 指令**；
- 打开后自动跟随当前会话；切换会话自动重载；可手动 ⟳ 刷新或勾选自动刷新
  （默认 10s，且**当前会话运行中自动跳过**，不给 agent 回合添负载）；
- 顶部 chips 显示来源（实时投影 + 磁盘档案）与全局统计（磁盘会话数 / 投影会话数 / 知识文档 / 技能数）。

## AGENTS.md 指令查看与编辑（第五个页签）

发现规则与 DSH 自身（`@deepseek-ai/dsh-agent-instructions`）完全一致，所以**看到的就是 agent
实际加载的那些文件**：

1. `$DSH_HOME/AGENTS.md`（用户全局，无 overlay）；
2. 项目 scope：从项目根（含 `projectRootMarkers`，默认 `.git` 的最近祖先目录）逐级到会话 cwd，
   每级先基础候选 `AGENTS.md` / `CLAUDE.md`，再本地 overlay `AGENTS.local.md` / `CLAUDE.local.md`
   —— 顺序即“由宽泛到具体”的优先级。

界面：左侧按 scope 分组列出候选文件（存在/缺失、大小、`local` 标记），点选即读；缺失文件以
**新建**模式打开，保存即创建。右侧编辑器为等宽文本框，带字节数、未保存标记、`Cmd/Ctrl+S` 保存、
⟲ 重新加载；保存成功显示大小与备份路径。

**写入安全约束**（重要）：

- 只允许写**发现链内**的候选文件名，其他路径一律 `forbidden`；
- 写入是**原子**的（同目录临时文件 + rename）；
- 覆盖已有文件前默认**自动备份**到 `$DSH_HOME/memory-view-backups/<name>.<时间戳>.bak`；
- 单文件读写上限 `maxSourceBytes` / `maxWriteBytes`；
- 带 `expectedMtimeMs` 的**乐观并发校验**：磁盘上文件被别人改过时返回 `conflict`，
  界面提示先「重新加载」再保存。

## 目录结构

```
dsh-memory-view/                # ← git 仓库根
├── package.json                # dsh.client 声明（platform: web → 浏览器端 bundle）
├── lib/
│   ├── index.js                # Node 半身：/memory-view RPC 通道 + ctx.provide('memoryView')
│   ├── client.js               # 浏览器 bundle：标题栏按钮 + 记忆面板（手写、零构建）
│   └── host/
│       ├── collectors.mjs      # zstd 会话日志解码 / 磁盘枚举 / KB / 技能收集（纯 Node）
│       ├── instructions.mjs    # AGENTS.md 发现 / 读取 / 原子写入（含安全约束）
│       └── service.mjs         # 四层快照服务核心（框架无关，可单测）
├── docs/
│   ├── MODEL.md                # 记忆模型映射说明
│   └── research/               # DSH 客户端插件框架调研报告
├── test/                       # node --test：collectors / service / instructions / client（34 项断言）
├── README.md
└── CHANGELOG.md
```

## 安装（接线）

以本机 `web` profile 为例：

```bash
# 1. 软链到 profile 的 node_modules（client-modules 与 Node loader 按包名解析）
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn /Users/robinddu/Desktop/workspace/robinddu/dsh-memory-view \
  ~/.dsh/profiles/web/node_modules/dsh-memory-view

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 追加：
- insert:
    - id: memory-view
      name: 'dsh-memory-view'
      config:
        # ---- Node 半身 ----
        kbRoots:                # 长期记忆里的“文档”来源（不配 = 不扫）
          - '/Users/robinddu/Desktop/workspace/output'
        skillRoots:             # 过程记忆：技能清单扫描根（*.skill.md / SKILL.md）
          - '/Users/robinddu/Desktop/workspace/robinddu/ebook-reader'
          - '/Users/robinddu/Desktop/workspace/robinddu/poetry-skill'
        # kbIndexJson: ''       # knowledge-base 语义索引 dump（index.json，可选项）

        # ---- AGENTS.md 指令（第五个页签）----
        instructions:
          enabled: true
          baseCandidates: ['AGENTS.md', 'CLAUDE.md']             # 项目 scope 基础候选
          localCandidates: ['AGENTS.local.md', 'CLAUDE.local.md'] # 本地 overlay 候选
          projectRootMarkers: ['.git']                            # 项目根标记
          extraRoots: []                                          # 额外允许查看/编辑的根目录
          maxSourceBytes: 1048576                                 # 单文件读取上限
          maxWriteBytes: 262144                                   # 单次写入上限
          backup: true                                            # 覆盖前备份到 $DSH_HOME/memory-view-backups

        # ---- 浏览器面板 ----
        defaultTab: 'shortTerm' # shortTerm | working | longTerm | proceduralSemantic | instructions
        autoRefreshMs: 10000    # 面板打开时自动刷新间隔；0 = 关闭（会话运行中自动暂停）
        drawerWidth: 860        # 抽屉宽度 px
        debug: false
```

3. **重启 `dsh web`**（新插件需重启以重新扫描 client 插件清单），浏览器硬刷新
   （`Cmd+Shift+R`）。此后代码改动只需硬刷新页面即可生效。

> 接线原理与 dsh-chat-fold / dsh-attention 相同：软链一次、`name` 用包名，
> client-modules 扫描 `dsh.client` 声明并服务 `/plugins/dsh-memory-view/client.js`，
> Node loader 从 profile 目录解析包入口。

## 使用

1. 打开任意会话，点右上角 **「🧠 记忆」**，右侧出现记忆面板；
2. **短期**：当前会话最近 8 轮（含 AI 思考标记、工具调用/结果），上方显示上下文占用
   （surface/window/pressure 与 system/tools/messages token 分布）与事件类型统计；
   切换会话自动跟随；
3. **工作**：目标 / 计划 / 待办 / 运行统计（turn·step、pendingCalls）/ 子代理 /
   上下文占用 / Token 用量 / 权限，实时投影 + 磁盘缓存合并（标注来源）；
4. **长期**：DSH home、工作区 → 会话档案、最近会话（标题、体量、时间）、设置、
   知识库 roots 文档统计（数量 / 字节 / 扩展名分布）；
5. **过程语义**：技能目录（SKILL.md 名称/描述/路径）+ 语义索引统计
   （文档数 / 词项数 / 向量维度，来自 knowledge-base dump）。

## 工作原理

- **Node 半身**（`lib/index.js`）：
  - 若 `web profile` 组合了 `sessions` + `sessionProjections`，构造**实时行提供者**
    （`ctx.get('sessions').list()` + `sessionProjections.snapshot(session).values`）；
  - 用 `ctx.webServer.register({ kind: 'prefix', path: '/memory-view', handler })` 挂
    RPC 通道，协议与 dsh-multi-tenant `/mt` 一致：
    `POST {type:'client-request', rpcId, method, payload}` →
    `{type:'server-response', rpcId, result:{ok, value|error}}`；
    方法：`health / overview / snapshot / shortTerm / working / longTerm /
    proceduralSemantic / refresh`；
  - `ctx.provide('memoryView', …)` 供其他插件复用。
- **会话日志解码**（`lib/host/collectors.mjs`）：会话文件是**多个 zstd frame 首尾相连**
  的 JSONL（每批一帧、带 checksum）。`zstdDecompressSync`（`node:zlib`，Node ≥ 24 本机
  已验证）只解第一帧，故先按 frame 头/block 头结构扫描边界再逐帧解码——该算法与
  `@deepseek-ai/dsh-session-persistence-jsonl` 内置解码器一致，纯 Node 实现、可单测。
- **浏览器端**（`lib/client.js`）：`ctx.slots.inject('conversation.session.header.actions')`
  注册按钮；面板组件挂在 `shell.overlay`（list 槽，additive）并经 React portal 渲染到
  `document.body`；`ctx.connection.rpc.call('/memory-view', 'snapshot', …)` 取数；
  `ctx.sessions.list.subscribe` 监听会话切换自动重载；通道不可用时降级为
  `ctx.sessions` 投影摘要。
- 面板样式为插件自有 `<style>`（`dataset.plugin` 标记，卸载/HMR 自动清理），
  变量跟随 DSH 主题（`--dsw-alias-*`，缺省回退值兜底）。

## 开发 / 测试

```sh
npm test              # node --test（20 项断言：解码/摘要/快照/分发/客户端纯函数）
node --check lib/client.js
```

## 已知边界

- **浏览器端只看当前会话的“已渲染窗口”内容**：历史会话的完整原文一律走 Node 半身
  解码（需要 `ctx.connection` 通道可用）；纯浏览器降级视图只展示会话投影摘要。
- **短期记忆“轮次”来自事件折叠**：跨帧/合并事件的 `data` 是字符串化 JSON，解码时
  已归一；被 compaction 汇总的历史用 `sourceEventSeqs` 折叠后的消息展示。
- **工作记忆行优先取内存实时投影**，磁盘投影缓存（`session_projcache.json`）兜底；
  未打开过的旧会话以磁盘行为准。
- **技能清单默认扫描配置的 roots**（过程记忆是“文件目录”视角）；会话内运行时注册的
  技能（经 `ctx.skills.register`）不属于文件清单，不在本视图范围。
- 若上游改变会话日志压缩格式 / 槽位 id / 投影行名，改动集中在 `collectors.mjs`、
  `service.mjs` 与 `client.js` 顶部常量，影响面小。

## 卸载

1. 从 `~/.dsh/profiles/web/cordis.patch.yml` 删除对应 `insert` 段；
2. 删除软链 `~/.dsh/profiles/web/node_modules/dsh-memory-view`；
3. 重启 `dsh web`。无 localStorage 残留（面板状态仅内存）。

## License

MIT
