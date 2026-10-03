# Interview Agent 开发入口

本分支 `agent/interview` 用于单个 Interview Agent 的开发。复用团队 [Pi 基座](../pi-base/README.md)，提供初访、定向追访、摘要草稿，以及可单独运行的本地流程。产品规则见 [设计文档](../interview-agent.md)。

**当前状态：可以离线开发和测试；DeepSeek 真实调用与访谈质量待提供 API key 后验证。** 本地 workflow 只保存进程内状态，退出后清空；它是第四位成员接线的参考，不是带登录、数据库的团队服务。

## 先跑离线流程

需要 Node.js >=22.19.0、pnpm 11.19.0。在仓库根目录执行：

```sh
pnpm --dir agent/interview setup
pnpm --dir agent/interview test
pnpm --dir agent/interview demo
pnpm --dir agent/interview chat
```

- `test`：角色契约、workflow、Pi 基座和 DeepSeek 请求格式测试，不需要 key。
- `demo`：自动演示初访 → 摘要 → 删除一条 → 本人确认 → 定向追访。
- `chat`：本地文字访谈。默认固定样例；输入 `/finish` 提前结束、`/quit` 退出。
- 所有离线结果都标注 `OFFLINE FIXTURE`，不能用来评价真实模型的访谈质量。

## 你主要改哪里

| 文件 | 用途 |
| --- | --- |
| [definition.mjs](definition.mjs) | 访谈策略、两个 operation 的提示词和输入输出验证 |
| [service.mjs](service.mjs) | `runInterview` 入口，确定性的轮数上限与无回答处理 |
| [workflow.mjs](workflow.mjs) | 本地成员会话、回答计数、版本检查、草稿确认 |
| [fixtures.mjs](fixtures.mjs) | 无 API 的固定样例 |
| [definition.test.mjs](definition.test.mjs)、[workflow.test.mjs](workflow.test.mjs) | 需要保持的业务与隐私边界 |
| [../pi-base/deepseek.mjs](../pi-base/deepseek.mjs) | DeepSeek 的 Pi 模型适配器 |
| [worker.mjs](worker.mjs) | 给团队 workflow 的 JSONL 接线入口 |

目前不提供浏览器、搜索或文件工具给 Interview 模型。竞品研究属于 Evaluator；问题目的由 Negotiate 的 `followup_task` 传入。

## 接给团队 workflow

Node 调用 `runInterview({request, runtime})`；`runtime` 由 `createDeepSeekRuntime` 或离线适配器创建。Python/uAgents 可将下面 JSON 写到 `node agent/interview/worker.mjs` 的标准输入，每行一个请求、每行一个响应。带 `--live` 才调用 DeepSeek；模型及密钥由服务端环境提供。

```json
{"schema_version":"1.0","request_id":"req-a-1","room_id":"room-1","operation":"interview.turn","input_revision":0,"payload":{"room_config":{"room_id":"room-1","member_ids":["a","b","c","d"],"initial_interview_max_rounds":7,"max_questions_per_turn":3},"private_interview":{"member_id":"a","mode":"initial","round_index":0,"messages":[],"coverage":{"pain":"unknown","idea":"unknown","skill":"unknown","resource":"unknown","preference":"unknown","objection":"unknown","participation_condition":"unknown"}},"shared_context":null,"followup_task":null}}
```

`private_interview.round_index` 明确表示 **已经回答的问答批次数**：初始为 0，第一批问题输出 1；答完第七批后停止，不生成第八批。返回停止信息时，output round_index 保持已回答数。该口径补全了设计文档中尚未明确的字段含义。

调用 `interview.summarize` 使用同样 envelope 和该成员历史，获得 `{member_id,draft_profile,changes,unknowns}`。本人可编辑 draft，应用收到确认事件后才分配 `profile_id/version/approved_at` 并共享。定向追访最多一批问题；`followup_task` 至少包含 `goal`、`expected_information`、`issue_id`，可带当前成员的上一版 `profile`。

接线负责人仍需实现：成员认证与请求投影、持久化、request_id 去重、旧回复失效检查、全团队的 n 轮限制，以及撤回共享后的刷新。这里的 session_id 只是本地索引，不是身份认证。

## DeepSeek 真实测试

按照用户要求，准备和离线验证不需要 key。要开始真实测试时再索取。不要把 key 写进源代码、示例、提交或聊天记录。

将本目录 [.env.example](.env.example) 复制为 `.env`，在本地填写 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL`。`.env` 已被 Git 忽略；默认离线命令不会读取它。首次真实 smoke 在本目录执行：

```sh
node --env-file=.env live-smoke.mjs --live
```

脚本只做两次调用：生成首轮问题、生成一份摘要；每次最多输出 2048 token，不自动重试。检查结果后，交互式真实访谈使用：

```sh
node --env-file=.env cli.mjs --live
```

交互式每进程最多 16 次模型调用；单次上下文字符上限 48,000，调用超时 60 秒。限制是调用次数和大小，不是美元结算保证；首次真实测试前和用户确认模型及可接受的费用上限。超限或模型返回无效结果时保留错误，不自动切模型或反复付费重试。

当前官方文档列出 `deepseek-flash` 和 `deepseek-v4-pro`。示例选前者，模型名可以更改；每次开展真实测试时核对当前可用型号。本适配采用官方 Chat Completions、JSON 输出和关闭 thinking 的文字访谈配置。来源：[首次调用](https://api-docs.deepseek.com/)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。

真实 smoke 成功仅证明连接和结构化接口可用；仍需人工评估追问是否自然、是否重复、摘要是否保留主观反对、是否将“想学”误写成已掌握能力。

完整开发步骤和技能/工具安排见 [DEVELOPMENT.md](DEVELOPMENT.md)。
