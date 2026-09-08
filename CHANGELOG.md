# Changelog

## v0.1.3 (2026-09-08)

修复：加载插件报 `cannot get property "connection" without inject`，Failed to load plugins。

- **客户端**：apply 的激活日志对象里读取了未注入的 `ctx.connection`
  （cordis ctx 是代理，访问未在 `exports.inject` 声明的服务名会直接抛错）→ 删除该读取。
- **Node 半身**：`inject` 误含 `'connection'`（host 侧不存在名为 connection 的服务）
  → 收敛为 `['webServer']`，与 dsh-multi-tenant 等 Node 插件一致。
- 审计两个半身全部 `ctx.*` 访问：客户端只剩注入的 `slots/sessions` 与基座
  `effect`；Node 侧只剩 `get/logger/on/provide` 与注入的 `webServer`。
- 新增 Node 半身 apply 冒烟测试（fake host ctx）：缺 sessions 服务也能启动、
  挂载 /memory-view 路由、GET 健康说明、POST RPC 协议（+5，共 26 项全绿）。

## v0.1.2 (2026-09-08)

修复：点击后仍不显示 / 需切换对话才显示 / 一直“正在加载”。

- **Store 改为整体替换（不可变更新）**：`useSyncExternalStore` 只认快照的新引用，
  原来原地改 `state` 不会触发重渲染（点击后无反应），切换会话时外部重渲染才“顺带”
  看到面板。现在 `patchState` 每次产出新对象，点击即时出面板。
- **去掉 loading 互斥早退**：打开时若先置 `loading=true` 再调 `loadData`，请求会被
  早退跳过、loading 永远无人清除 → 卡“正在加载”。现在每次点击都真正发请求，
  seq 丢弃旧响应，成功/失败/超时必清 loading。
- **RPC 改用同源 fetch + 15s 超时中断**：不再依赖 `ctx.connection.rpc` 内部通道
  （可能不 settle 导致无限等待）；与 host `/memory-view` 前缀路由（curl 实测 ~50ms）
  直连，错误/超时都走明确路径并降级为会话摘要。

## v0.1.1 (2026-09-08)

修复：点击「🧠 记忆」无反应 / 反应慢。

- 面板改为由**标题栏按钮组件自身直接渲染**（React portal），不再依赖 `shell.overlay`
  槽位挂载 —— 按钮可见即组件已挂载，点击必然立即弹出面板；
- 增加半透明背板（点击背板关闭）；打开即显示「⏳ 刷新中」占位，数据到达后填充；
- 各页签渲染包 try/catch：异常时显示错误卡而不是空白；
- 请求带序号防过期写：快速切换会话时旧响应不再覆盖新状态，避免“卡住/慢”；
- 会话不匹配/加载中显示 spinner，切换会话自动重载。
- 服务端 `/memory-view` 实测 ~50ms 返回完整 snapshot（无性能问题）。

## v0.1.0 (2026-09-08)

首个可用版本：

- **四层记忆查看器**（浏览器端）：会话标题栏「🧠 记忆」按钮 → 右侧记忆面板，
  页签 = 短期记忆 / 工作记忆 / 长期记忆 / 过程与语义记忆。
- **Node 半身**：`/memory-view` RPC 通道（协议与 dsh-multi-tenant `/mt` 一致），
  方法 health / overview / snapshot / shortTerm / working / longTerm /
  proceduralSemantic / refresh；`ctx.provide('memoryView', …)`。
- **会话日志解码**：多 zstd frame 容器扫描 + `node:zlib` 逐帧解码（零第三方依赖），
  把事件流折叠为按 turn 分组的最近交换摘要。
- **工作记忆行**：优先 `sessionProjections.snapshot`（实时），磁盘投影缓存兜底。
- **长期 / 过程语义**：工作区索引、会话档案、设置、知识库 roots 文档统计、
  SKILL.md 技能清单、knowledge-base 语义索引 dump 统计。
- 通道不可用时浏览器端降级为 `ctx.sessions` 投影摘要。
- 测试：20 项（collectors / service / dispatcher / client 纯函数）。
- 文档：README、docs/MODEL.md、docs/research/client-plugin-framework.md。
