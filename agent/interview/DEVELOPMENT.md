# Interview Agent 开发工作流

## 分支与修改范围

使用 `agent/interview` 分支。开始前检查 `git status`，保留用户和队友改动。主要编辑 `agent/interview/`；DeepSeek 适配在 `agent/pi-base/deepseek.mjs`，基础运行层接口保持兼容。合并到 master 由团队后续安排。

## 开发顺序

1. 从 [设计](../interview-agent.md) 和 [共享契约](../contracts.md) 确认行为；字段的可执行约束以 `definition.mjs` 为准，发现冲突需同时修正文档。
2. 先写一段具体输入和期望行为，例如“我不喜欢这个方向，但不想解释”，不要只凭模型回复看起来合理就判断完成。
3. 在 `definition.mjs` 修改追问/摘要提示词；在 `service.mjs` 放轮数等程序规则。批准时间、态度与共识不得交给模型生成。
4. 运行 `pnpm --dir agent/interview test`；需要看完整流程时再跑 `demo` 或 `chat`。
5. 离线通过后再进行经用户授权的两次 DeepSeek smoke。记录模型、日期、请求数量、错误类别；记录不得含 API key、完整私人对话或模型内部推理。
6. 以少量合成案例检查实际访谈质量：无 idea、只说不知道、主观反对、不会但想学、追访只问一个条件。修改策略后复核受影响场景。
7. 给 workflow 负责人交付两个 operation 的请求/响应及错误示例；整体房间服务继续负责认证和持久化。

## Skills、plugin、MCP

| 能力 | 当前安排 | 用途 |
| --- | --- | --- |
| `mhacks-interview-dev` skill | [版本化源文件](skill/SKILL.md)，本机已安装到 `~/.codex/skills/mhacks-interview-dev` | 后续开发可使用本模块的开发步骤、接口和测试边界 |
| Engineering skills | 使用已有 system-design / documentation；遇到实际故障按需使用 debug | 设计、维护与诊断 |
| Node + pnpm + Pi | 已有固定依赖与 lockfile | 开发、模拟模型、真实模型运行 |
| Git、官方文档读取 | 现有工具可用 | 版本控制和核对 DeepSeek API |
| DeepSeek | 应用服务端直接访问官方 API | 生成问题和摘要；需用户提供 key 后测试 |
| 新 plugin / MCP server | 当前不需要添加 | 初访无需外部数据或系统操作；不引入额外凭据与服务 |

开发 skill 服务于写代码的助手。它不是应用运行时第四个 Agent，也不会自动把开发者的工具、文件、shell 权限交给 Interview 模型。

## 验证边界

已能离线检验：输入输出结构、7 轮/3 问限制、单批追访、无回答不编资料、上下文隔离、批准后只共享编辑稿、重复/过期回答、模拟 provider 请求与失败。

待真实模型检验：DeepSeek key/型号是否可用、响应延迟、JSON 成功率、中文追问与摘要质量。

待团队集成检验：登录权限、数据库恢复、房间并发与请求去重、Negotiate/Evaluator 协作、比赛平台通路。不得将单 Agent 的离线通过描述为全产品已验证。
