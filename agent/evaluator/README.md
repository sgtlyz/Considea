# Evaluator Agent

接收已经细化、足够发展为项目的 idea，测试**查重**和**可行性**，输出 `passed: true/false`、两项测试结果、理由、来源和修改建议。

实现已提供 Pi 工具循环、Tavily CLI/HTTP 适配、DeepSeek/Gemini 模型配置、请求级来源账本、预算、JSONL 和 Python 接口。离线测试不调用真实 API；远程模型质量、当前账户权限、额度和真实 API 兼容性尚未验收。

## 开始运行

Node >=22.19，pnpm 11.19；两个包分别安装，因为 Evaluator 复用 Pi Base 的 runner：

```powershell
cd D:\Mhacks\agent\pi-base
pnpm install --frozen-lockfile
pnpm test
cd ..\evaluator
pnpm install --frozen-lockfile
pnpm test
pnpm demo
```

`demo` 完全离线，运行真实 Pi Agent 工具循环，但模型及检索响应是合成 fixture。输出 `fixture: true`，只能验证接线，不能作为真实 idea 的评估结果。

## 判定规则

查重：已有项目的目标用户、核心问题和核心方案高度相同，且 idea 没有明确差异时不通过。同类产品存在本身不会淘汰；只换名字或模型不算充分差异。输出最多三个相近项目，列明重合、差异、成熟度与正文来源。没有搜到只表示本次未发现，不证明全球首创。

可行性：检查最小 demo 的核心实现路径、必要 API/数据/设备是否可获得、团队资源和时间/预算是否匹配。首版是有来源的文档和资源评估，不运行 idea 的原型。必要依赖仍未知或关键上下文缺失时不能通过；存在明确阻碍时给出失败原因和范围修改建议。

每项 `result`：`pass`、`fail`、`insufficient_evidence`。只有两项都是 pass，代码才计算 `passed=true`。最后一种表示“尚未完成核实”，不是“已证实不可行”。`passed` 不代表团队愿意推进；成员确认仍由 workflow 处理。

## 输入

完整示例：[evaluate.json](examples/evaluate.json)、[investigate.json](examples/investigate.json)。请求沿用 `schema_version: "1.0"` envelope。

`evaluator.evaluate` 的 payload 包含：

| 字段 | 说明 |
| --- | --- |
| `idea` 或 `candidate` | 恰好一个；业务上都是已经细化的 idea。candidate 使用共享契约全部字段，idea 允许省略版本、来源和迭代元数据，由代码补默认值 |
| `room_config` | 共享契约 RoomConfig：房间身份、成员、截止时间、已确认约束等 |
| `team_criteria` | 共享契约 TeamCriteria；可以是空标准列表，但必须给 version 和 unresolved_tradeoffs |
| `shared_resources` | 已获准共享的技能/资源条目，不传私人访谈。没有资料可以传 []，但不能假定团队资源足够 |
| `previous_report` | null 或历史报告；只供规划补查，不自动成为本次证据 |
| `tool_budget` | 可省略或部分覆盖默认预算 |

idea 必须包含 `title`、`target_users`（非空 string[]）、`problem`、`core_flow`（非空 string[]）、`mvp_scope`（非空 string[]）、`critical_dependencies`（数组，每项 `{dependency_id, description, must_have}`）。可提供 `candidate_id`、`version`、`iteration_index`、`out_of_scope`、`contributions`、`tradeoffs`、`unknowns`、`change_summary`；不提供身份时分配 UUID。workflow 应预先固定 candidate_id/version，方便多轮关联。

资源条目格式：`{profile_id, profile_version, item_id, member_id, category, text}`；category 是 `skill` 或 `resource`。授权与快照由 workflow 保证，Evaluator 校验结构和房间成员，但不承担公共入口的认证。

`evaluator.investigate` 使用相同上下文，另加 `question: {issue_id, text, expected_information}`；仅回答这一专题，不替整个 idea 判定。

默认预算每个请求：2 次搜索、3 次网页正文读取、总时限 60000ms、单次检索 10000ms。次数允许 0，时间必须是正整数；这些是执行上限，不是检索穷尽的承诺。硬上限分别为 12、12、180000ms、30000ms，单次时限不能大于总时限。时间包含模型执行；停止新检索时预留最多 5 秒给最终报告。复杂项目可由 workflow 在硬上限内提高预算。Tavily 按其服务计费单位扣额度，调用次数不等于 credits。

## 输出

整体 envelope 的 `status` 表示执行结果，报告内的 `passed` 表示 idea 是否通过：

```json
{
  "status": "ok",
  "data": {
    "report_schema_version": "1.1",
    "report_id": "server-generated-id",
    "candidate_id": "idea-1",
    "candidate_version": 1,
    "status": "complete",
    "passed": false,
    "tests": {
      "novelty": {"result": "fail", "reason": "高度相同且无明确差异", "evidence_ids": ["web-1"], "required_changes": ["补充具体差异"], "missing_information": []},
      "feasibility": {"result": "pass", "reason": "核心路径及资源可支持最小 demo", "evidence_ids": ["web-2", "member-1"], "required_changes": [], "missing_information": []}
    },
    "competitors": [],
    "technical_checks": [],
    "risks": [],
    "unverified_assumptions": [],
    "recommended_changes": [],
    "evidence": [],
    "search_log": []
  },
  "warnings": [],
  "error": null
}
```

上面是展示字段的简化片段，完整有效报告还需对应的 evidence 记录和所有输入依赖的 technical_checks。完整响应保留请求的五个 envelope 身份字段。报告 `1.1` 是在旧报告上增加判定字段，外层 envelope 保持 `1.0`，兼容现有 Base。

失败的业务测试仍可以 `status=ok, passed=false`。来源不可用/预算耗尽时 `status=partial`，保留实际获取的证据；未完成测试不会通过。模型或轮次硬截止后由代码生成 partial，所有未完成结论为未知。输入/配置/输出结构错误为 `status=error`，没有测试结果；workflow 不应把它当作 idea 不可行。

模型输出的 URL/ID 必须对应本请求实际读取的账本；搜索片段不作为正文证据。代码负责来源 ID、URL、读取时间、类型、日志和报告 ID。官方域名来自部署白名单；不能由模型自行扩大。模型做语义分析，引用校验只验证来源记录及类型，不保证自然语言判断绝对正确。

## Node 接线

```js
import { runEvaluator, evaluateIdea } from './runner.mjs';
import { createModelRuntime } from './models.mjs';
import { createTavilyCli, createTavilyApi } from './retrieval.mjs';

const runtime = createModelRuntime(process.env);
const retrieval = createTavilyCli({ executable: process.env.TVLY_PATH || 'tvly' });
// 也可换成 createTavilyApi({ apiKey: process.env.TAVILY_API_KEY })。
const result = await runEvaluator({ request, ...runtime, retrieval,
  officialDomains: ['spacetimedb.com', 'fetch.ai'],
  onProgress: event => console.error(JSON.stringify(event)) });
// 简单 idea 调用：evaluateIdea({idea, context, ...runtime, retrieval, officialDomains})。
```

`context` 包含 room_config、team_criteria、shared_resources、previous_report、tool_budget，与 workflow payload 一致。`retrieval` 可由其他 MCP/服务适配器注入，接口为 `search(query,{limit,signal}) -> {results:[{url,title,content}]}`，`read(url,{signal}) -> {url,title?,content}`。两个工具共享预算与来源规则，不能绕过账本直接把引用交给模型。

进度仅包含 request_id/type，不包含私人输入、工具参数或模型思考。函数不会写 SpacetimeDB；workflow 自行保存报告并核对 input_revision/candidate_version，不能以报告完成次数递增用户输入版本。

## 真实模型和 Tavily 配置（暂未远程测试）

环境变量是部署配置，不能从用户 idea 读取；不要把密钥提交到仓库。

| 变量 | 默认／用途 |
| --- | --- |
| `EVALUATOR_PROVIDER` | deepseek；可选 gemini |
| `EVALUATOR_MODEL` | DeepSeek 默认 deepseek-flash；Gemini 默认 gemini-2.5-flash。按账户可用模型修改 |
| `DEEPSEEK_API_KEY` / `GEMINI_API_KEY` | 对应模型密钥；缺失时 CONFIG_ERROR |
| `EVALUATOR_MAX_TOKENS` | 4096；允许 256–16384，实际受模型上限约束 |
| `EVALUATOR_BASE_URL` | 可选可信 HTTPS DeepSeek-compatible 地址；Gemini 使用 Pi 原生 Google provider |
| `EVALUATOR_RETRIEVAL` | cli；可选 api |
| `TVLY_PATH` | tvly；Windows 若不在 PATH，可填 `C:\Users\sks31\AppData\Roaming\Python\Python313\Scripts\tvly.exe` |
| `TAVILY_API_KEY` | 仅 api transport 必须；cli 使用 CLI 已有认证 |
| `EVALUATOR_OFFICIAL_DOMAINS` | 逗号分隔的官方域名；默认 SpacetimeDB、Fetch/Agentverse、DeepSeek、Google AI、Tavily 文档域名。添加新依赖时补充经过核对的官方文档域名 |

DeepSeek 使用 Pi 的 OpenAI-compatible provider；当前锁定的 Pi 内置 deepseek-flash/v4-pro。如指定 legacy/custom ID（例如 deepseek-chat），代码显式建立非推理文本模型配置，不能保证该模型仍在账户可用。Gemini 使用 Pi 的原生 provider，模型需存在于锁定目录。

Tavily CLI 的 Windows 子进程固定为 UTF-8、关闭 shell，并支持超时/取消；不会传此前后端不接受的 extract chunks/timeout 参数。HTTP transport 使用 Bearer key 和 search/extract 两个端点。参照 [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)、[DeepSeek 文档](https://api-docs.deepseek.com/)。

配置好环境后，从文件发送单行 JSON：

```powershell
Get-Content -Raw examples/evaluate.json | ConvertFrom-Json | ConvertTo-Json -Depth 30 -Compress | node cli.mjs
# 离线版本加 --fixture，不需要任何密钥：
Get-Content -Raw examples/evaluate.json | ConvertFrom-Json | ConvertTo-Json -Depth 30 -Compress | node cli.mjs --fixture
```

CLI 只在 stdout 输出一行一个 JSON 响应。多行排版的文件不能直接作为 JSONL；先转为单行或使用 Node/Python 函数。

## Python / uAgent workflow 接线

```python
import json
from pathlib import Path
from python_bridge import run_evaluator

request = json.loads(Path("examples/evaluate.json").read_text(encoding="utf-8"))
response = run_evaluator(request)              # 真实模式，继承环境配置
response = run_evaluator(request, fixture=True)  # 离线接线
```

桥接函数的 timeout 默认比请求总时限多 10 秒，最多 190 秒；进程失败或超时返回结构化错误，不自动重试。调用应放在外部 worker 中；异步 uAgent handler 可使用 `asyncio.to_thread(run_evaluator, request)`，不要阻塞事件循环。

ASI:One 入口、ACP 注册、会话/DAG 和 SpacetimeDB 权限由 workflow 同伴接入。上层可以展示 passed、两项理由及来源，但通过 Evaluator 不等于全员达成共识。
