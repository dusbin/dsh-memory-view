# dsh-memory-view 记忆模型说明

DeepSeek Harness（DSH）本身**没有**名为 “memory” 的独立存储：agent 的一切状态都落在
真实的会话记录、投影行与磁盘文件中。因此本插件采用「**认知记忆分层**」的视角，把 DSH
的真实运行状态**投影**成四层记忆视图，而不是凭空造一个并行存储。每一层都标注了数据
来源与语义边界，方便使用者理解「看到的记忆 = DSH 里的哪份真实状态」。

## 四层记忆模型

### 1. 短期记忆（Short-term / 情景缓冲）

- 含义：agent「眼前正在处理/最近刚发生」的原始交换 —— 相当于对话工作缓冲区里的
  最近几轮消息与工具调用。
- 数据来源：
  - 浏览器侧：`ctx.sessions` 投影行（`sessionStats`、`contextPressure`、
    `contextBreakdown`、`title`、`sessionListMetadata` 等）给出每个会话的
    规模与上下文占用；
  - 内容层：会话的原始事件流（`user` / `assistant` / `tool-call` /
    `assistant/message` 等）是真正的“话”本身，由 Node 半身读取会话持久化文件
    （`~/.dsh/sessions/<cwd>/<session-id>/session.jsonl.zstd`，zstd 压缩 JSONL，
    用 `node:zlib` 的 `zstdDecompressSync` 解码，无需额外依赖）得到；
- 视图：选择某个会话，展示其**最近 N 条交换**（截断文本），以及上下文占用
  统计（surface/pressure 相对 contextWindow 的百分比）。

### 2. 工作记忆（Working / 任务控制状态）

- 含义：agent 当前任务正在「执行什么、剩什么、卡在哪」—— 控制流状态。
- 数据来源（全部是 `ctx.sessions` 里按会话投影的行）：
  - `goal`：进行中的目标、回合数、自动续跑标记；
  - `plan`：plan-mode 是否激活、当前计划；
  - `todos`：待办列表（含进行中/已完成）；
  - `sessionStats`：turn/step、`openStep`、`pendingCalls`（正在等待的调用）；
  - `subagent` / `subagentTiming`：后台子代理及其耗时；
  - `contextBreakdown`：system / tools / messages 的 token 分布。
- 视图：实时订阅当前会话的行更新，卡片式展示上述每一项；后台会话可切换查看。

### 3. 长期记忆（Long-term / 跨会话持久）

- 含义：跨会话仍然存在、可被再次检索/引用的知识沉淀。
- 数据来源（Node 半身读取 + 浏览器投影行）：
  - 工作区与全部会话的档案（`~/.dsh/storages/workspace.json`：cwd → 会话 id 列表）；
  - 会话归档库本身（`~/.dsh/sessions/` 下每个 cwd 的会话记录 = 情景式长期记忆）；
  - 知识库 roots 下的文档集合（当前环境配置为 `/Users/robinddu/Desktop/workspace/output`，
    由 knowledge-base 插件维护的 md/md/json 等 = 事实型长期记忆）；
  - 用户级设置/persona（`~/.dsh/settings.yaml` 等）。
- 视图：按工作区列出所有会话（标题、规模、时间）；列出长期文档及其体量；
  显示这些「可回源文件」清单。

### 4. 过程 / 语义记忆（Procedural & Semantic）

- 含义：agent「会怎么做」（过程）与「理解到的相似性/含义」（语义）。
- 数据来源（Node 半身）：
  - **过程记忆**：技能清单（skill 目录/文件：名称、描述、用途）—— 可调用的
    “做事的流程”目录；
  - **语义记忆**：knowledge-base 插件的语义索引（若已 dump：`index.json` /
    `summary.md` 里的文档数、词项数、向量维度、文档向量化情况、同义词组），
    说明这套语义检索通道本身的能力与容量。
- 视图：技能目录表格；语义索引统计卡 + 按 df 高频词/文档样例；知识库检索演示入口
  （直接调用 `kb_search` 在面板里试检索）。

## 插件两个半身

- `lib/index.js`（Node 半身）：读取磁盘上的长期/语义/过程记忆 + 解码会话历史，
  产出结构化快照；
- `lib/client.js`（浏览器 bundle）：会话标题栏「🧠 记忆」按钮 → 全屏记忆面板；
  工作记忆部分直接从 `ctx.sessions` 实时投影，其余部分向 Node 半身请求快照。

## 说明与边界

- 本插件是**查看器**：只读，不改写任何 DSH 状态。
- 记忆分层的划分是**展示性**的（认知隐喻），不是 DSH 内部的存储分桶；README 与
  面板里都会标注「来自哪个真实字段/文件」。
- 会话内容文件解码依赖运行 DSH 的 Node 版本支持 `node:zlib` 的 zstd API
  （Node ≥ 23 实验性 / ≥ 24 可用；本机 v24.18.0 已验证）。
