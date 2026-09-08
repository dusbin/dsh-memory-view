# Changelog

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
