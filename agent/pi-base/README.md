> **v2 接线提示：** 下文演示保留旧业务格式。当前六个 operation 和新 payload 见 [接口契约 v2.0](../contracts.md)。新角色直接导出 definition；不要将旧 roles.mjs 或 example-role.mjs 当作四角色实现。外层 schema_version 仍为 1.0，业务 contract_version 为 2.0。团队 Interview 的输出约束和限次纠正见下方说明。

# Pi Agent Base v0.1

供 Interview、Negotiate、Evaluator 三位负责人复用的运行层。整体设计见 [framework-design.md](../framework-design.md)。这不是三个完整业务 Agent，也不包含房间数据库、界面或 Agentverse 注册。

## 先跑起来（无 API key、无费用）

需要 Node.js >=22.19.0、pnpm 11.19.0。在本目录执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm demo
```

demo 使用 Pi 官方 faux provider，真实经过 Agent 循环但模型响应为固定样例。输出有 `Offline fixture` 标记，不能用作真实访谈质量证明。依赖与 lockfile 已固定；仓库不包含上游源码副本或个人凭据。

## 每个人如何接入

1. 新建自己的模块，例如 `agent/interview/definition.mjs`。
2. 从 `../pi-base/roles.mjs` 导入 `defineRole`，声明自己的 operation。
3. 每个 operation 实现 `validateInput(payload)`、`validateOutput(data, payload)` 和 `outputInstructions`。结构以团队 contracts 为准，不能只检查“是对象”。需要校验 ID、版本、题数和业务枚举。
4. 使用 `createTools(request)` 创建本次请求的工具。工厂只能绑定 workflow 已授权的数据，必须快速完成；不要在工厂里调用网络。
5. workflow 调用 `runAgent`，业务模块不能直接提交共享批准、用户反馈或最终决定。

```js
import { defineRole } from '../pi-base/roles.mjs';

export default defineRole('evaluator', {
  'evaluator.evaluate': {
    validateInput: validateEvaluationRequest, // 由本角色实现并导入
    validateOutput: validateEvaluationReport,
    outputInstructions: '输出团队约定的 EvaluationReport，所有来源必须能追溯。',
  },
}, request => makeSearchTools(request)); // 实现返回 Pi AgentTool[] 的工厂
```

这是接线示意，函数需要实现；`example-role.mjs` 则是可运行的最小 Interview 示例。它只覆盖 `interview.turn` 初访，不包含摘要与追访完整业务逻辑。

工具使用 Pi 的 `AgentTool` 接口，包含 `name`、`label`、`description`、TypeBox `parameters`、`execute`；返回 `{content: [{type: 'text', text: '...'}], details: {}}`。参见 `base.test.mjs` 中实际通过的工具循环测试。工具应响应传入的 AbortSignal；禁止把请求里的任意模块路径或脚本当工具执行。

## 真实模型（开发者手动运行，会产生 API 费用）

PowerShell 示例：

```powershell
$env:PI_PROVIDER = 'openai'
$env:PI_MODEL = 'gpt-4o-mini'
$env:OPENAI_API_KEY = '<your-key>'
$env:AGENT_MODULE = '../interview/definition.mjs'
node cli.mjs
```

API key 只放本地环境。CLI 不自动加载 `.env`。未设置 AGENT_MODULE 时使用 `example-role.mjs`。模型名只是可替换的开发默认值，不代表团队最终选型。输入每行一个请求，输出每行一个响应：

```json
{"schema_version":"1.0","request_id":"req-1","room_id":"room-1","operation":"interview.turn","input_revision":0,"payload":{"member_id":"a","mode":"initial","round_index":1,"messages":[]}}
```

消息文本和房间 ID 必须由已认证的 workflow 组装；CLI 本身不是公开服务。不要把模型 JSON 文本直接转发给 ASI 用户，应由 workflow 生成适当的问题/看板。

Python 可用 `python_bridge.call_agent(request, role_module=...)` 异步调用，适合已有 uAgents 服务。它每次启动一个 Node worker；70 秒未结束即关闭 worker。role_module 是部署配置，不能接受用户输入。直接集成 Node 时调用 `runAgent({request, definition, model, streamFn})` 即可。

## Base 已实现的边界

- 每次操作创建新的 Pi 实例，不隐式继承其他请求的上下文。连续访谈由 workflow 传入当前成员的授权历史。
- 统一 envelope、角色 operation 检查、输入/输出校验入口、结构化错误。ID/版本从原请求复制，不采信模型生成的 envelope。
- 默认 60 秒、最多 6 个模型轮次、最多 12 次工具执行；CLI 每次模型响应最多 4096 token。默认 `maxOutputRepairs=0`，不自动纠正输出。无工具角色可显式设为 `1`，最多再调用一次模型纠正输出；不重试整次业务操作或 provider 错误。
- 工具需显式注入；没有内置文件读写、shell、coding agent 扩展发现或个人会话读取。
- 进度回调只有事件类型和 request_id，不包含聊天内容、工具结果或内部思考。
- `MODEL_TIMEOUT`、`MODEL_ERROR` 可由 workflow 判断是否重试；`INVALID_INPUT`、`INVALID_OUTPUT`、`CONFIG_ERROR`、`BUDGET_EXCEEDED` 需修正配置、输入或策略。

运行层不实施用户认证、持久化去重、版本比较或房间权限；workflow 必须在调用前后实施。进程内 timeout 发出取消并返回，但无法强制终止不配合取消的自定义工具；需要硬隔离时使用 Python worker 或等价子进程。不要给工具写业务权威状态的权限。轮次/token 上限不是美元预算，需要 workflow 或模型网关额外核算。

## 输出约束与一次纠正

operation 可提供 `outputSchema(payload)`，从业务 Schema 生成本次输出说明；它会进入系统提示。`outputIssues(raw, payload)` 可返回 `{code, path}` 数组帮助模型纠正，但不能包含成员原文、密钥或 provider 原始错误。该机制是提示约束加本地强校验，不声称 provider 已启用严格 Schema 解码。

团队 Interview v2/v2.1 service 使用 `maxOutputRepairs: 1, maxTurns: 2`；Idea v2.0 且未注入 memoryClient 时也启用一次纠正。只有 JSON/输出协议失败允许替换输出；纠正共用原总期限（Interview 60 秒，Idea 90 秒）、同一授权上下文与总 turn 限制。声明工具的 operation 不能启用该机制，避免重放副作用。Idea 研究扩展、Mem0 工具模式、其他 Agent 和旧 CLI 默认不启用纠正。

启用纠正的无工具模式会先尝试两种有限本地格式修复：只补全末尾缺失的容器结束符；或将提前关闭顶层对象后独立的字符串 warnings 数组接回顶层。两者都不补字段、不改文字、不猜测来源；未闭合字符串、未知尾部字段和缺失业务字段仍拒绝。所有本地修复和模型纠正结果重新经过完整输出校验；二次失败不发布任何部分结果。模型意外请求工具也立即终止，不允许增加调用轮次。成功纠正返回 `MODEL_OUTPUT_REPAIRED` warning；失败仅包含固定错误分类，详细模型内容只可经调用方显式提供的受保护 `onDiagnostic` 回调观察，不进入公共进度。

## 文件与维护分工

| 文件 | 作用 |
|---|---|
| `base.mjs` | Pi 调用、校验、限制和响应；由 workflow 负责人统一维护 |
| `roles.mjs` | 三种角色的最小职责提示；业务负责人可扩充自己的定义 |
| `example-role.mjs` | 一个可运行的初访 operation 示例 |
| `cli.mjs` / `python_bridge.py` | JSONL worker 与 Python 接线入口 |
| `demo.mjs` / `base.test.mjs` | 离线样例与运行层测试 |

测试验证运行层，不证明模型判断正确；真实 provider、检索服务、Fetch.ai/ASI 通路需要另行集成验收。

## 上游

使用 Pi 的 `@earendil-works/pi-agent-core@1.0.1` 和 `@earendil-works/pi-ai@1.0.1`，不是此前讨论的完整 coding-agent CLI RPC。选择 core 是为了直接注入业务工具并保持状态由 workflow 管理。

- [Pi 官方 Agent Core 文档](https://github.com/badlogic/pi-mono/tree/main/packages/agent)
- [Pi 官方模型层文档](https://github.com/badlogic/pi-mono/tree/main/packages/ai)
- [Coding SDK / CLI 方案参考](https://pi.dev/docs/latest/sdk)

上游 main 文档可能更新；本基座以锁定的 1.0.1 实际安装和离线测试为准。Pi 是 MIT 项目，上游许可证保留在安装依赖内；这里只发布本项目的适配代码。


### 多余右括号的本地修复

已启用 `maxOutputRepairs: 1` 的无工具调用，在原有末尾闭合与 warnings 包装修复都不适用时，会尝试 `json-repair.mjs`：

- 只处理原本无法解析的 JSON；一次只删除一个字符串外的 `}`，不补字段、修改事实或移动/删除正文。
- 最多扫描 65,536 字符和 256 个右括号位置。每个可解析候选均执行原有规范化及完整 operation 校验；只有一个不同的原始对象通过时才接受。存在歧义或会覆盖重复字段（包括转义后的同名键）则拒绝。
- 字符串中的括号、转义引号和反斜线保留。原本合法但契约错误的 JSON 不会被重新摆放层级来强行通过。
- 成功返回 `MODEL_JSON_EXTRA_BRACE_REMOVED` warning，不增加模型调用。无法修复时走原有最多一次模型纠正和失败恢复路径；不叠加新模型重试。
- 执行位置是 Agent 输出进入 workflow 前的解析边界；Python workflow 仍只接收并验证结构化响应，人类门控保持不变。
