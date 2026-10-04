# Evaluator Agent

接收已经细化、足够发展为项目的 idea，测试**查重**和**可行性**，输出 `passed: true/false`、两项测试结果、理由、来源和修改建议。

产品流程以 [workflow_updated.md](../../workflow_updated.md) 为准：Interview → 分歧识别与人工决策 → 深入讨论 → 独立 Idea Generator → 成员微调 → Evaluator → final_review。Evaluator 不生成候选、不管理讨论轮数、不写成员确认。

实现已提供 Pi 工具循环、Tavily CLI/HTTP 适配、DeepSeek/Gemini 模型配置、请求级来源账本、预算、JSONL 和 Python 接口。DeepSeek + Tavily CLI 已实际调用；完整过程及未通过项见 [LIVE_TEST_REPORT.md](LIVE_TEST_REPORT.md)。离线测试不调用真实 API；Gemini 和 Tavily HTTP 尚未远程验收。

模型通过带字段定义的 `submit_report` 工具提交评估内容；服务器校验候选身份和实际来源后生成响应。外层 JSON、`passed`、来源记录和 workflow 字段由服务器生成。所有非法提交共享最多一次纠正机会，纠正沿用原预算；重复错误返回 `INVALID_OUTPUT`，不会当作 idea 不通过。

DeepSeek 每个模型轮次都要求调用工具，首轮按预算指定检索，最后用 `submit_report` 结束；其他模型仍有严格校验的文本 JSON 兼容路径。非白名单来源标为 `public_web`，不会自动称为项目自述；GitHub topics 等已识别列表页不能作为具体竞品正文。

单独调查的模型提交把 `capability_outcome`（available/blocked/unknown）与 `evidence_basis`（official_documentation/member_report/unknown）分开。服务器转换为公开接口的 `conclusion` 和 `outcome`；有来源证明某能力做不到时，`outcome=blocker`。

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

WSL 中对应目录为 `/mnt/d/Mhacks/agent/evaluator`。Windows 和 WSL 共用项目时，pnpm 可能要求重装 `node_modules`；安装成功后继续运行即可，建议在同一个环境安装和运行。

`demo` 默认打印易读摘要。运行真实 Pi Agent 工具循环，但模型及检索响应完全是合成 fixture，只能验证接线，不能作为真实 idea 的评估结果。查看完整 JSON：

```sh
pnpm demo --json
```

输出含义：外层 `status: "ok"`、`error: null` 表示程序运行成功；`tests.novelty` / `tests.feasibility` 是两项判定；`passed` 是两项均通过的结果；`fixture: true` 表示上述判定来自模拟数据，`example.org` 地址也只是示例。

## 判定规则

查重：已有项目的目标用户、核心问题和核心方案高度相同，且 idea 没有明确差异时不通过。同类产品存在本身不会淘汰；只换名字或模型不算充分差异。输出最多三个相近项目，列明重合、差异、成熟度与正文来源。没有搜到只表示本次未发现，不证明全球首创。

最低检索范围是 **GitHub 仓库**和 **Devpost hackathon 项目**，每次 `evaluator.evaluate` 至少分别搜索一次。运行层优先将前两次搜索分配给这两个范围，向 Tavily 传入域名过滤并约束查询为 `site:github.com` / `site:devpost.com/software`；Devpost 查询同时包含 hackathon。模型需使用目标用户、问题和核心方案关键词，不能只搜索拟定名称。后续搜索可以扩大到其他产品或技术文档。

这是通过 Tavily 搜索公开索引中的项目，不是遍历两个平台全部项目。GitHub topics、用户主页、Devpost 比赛列表和 gallery 不能当作具体竞品；比较要读取具体仓库或 `/software/<项目>` 正文。某个平台未成功检索、仅返回范围外页面，或预算不足以完成两个范围时，不能给出查重 pass；报告返回 partial 并列出缺口。有正文证据的重复 fail 可以保留。默认 2 次搜索刚好覆盖两个最低范围；如需改写关键词、重试或补充技术搜索，workflow 可在硬上限内提高预算。专题 `evaluator.investigate` 不强制查重检索。

可行性：检查最小 demo 的核心实现路径、必要 API/数据/设备是否可获得、团队资源和时间/预算是否匹配。首版是有来源的文档和资源评估，不运行 idea 的原型。必要依赖仍未知或关键上下文缺失时不能通过；存在明确阻碍时给出失败原因和范围修改建议。

每项 `result`：`pass`、`fail`、`insufficient_evidence`。只有两项都是 pass，代码才计算 `passed=true`。最后一种表示“尚未完成核实”，不是“已证实不可行”。`passed` 不代表团队愿意推进；成员确认仍由 workflow 处理。

## 输入

完整示例：[evaluate.json](examples/evaluate.json)、[investigate.json](examples/investigate.json)。请求沿用 `schema_version: "1.0"` envelope。

`evaluator.evaluate` 的 payload 包含：

| 字段 | 说明 |
| --- | --- |
| `idea` 或 `candidate` | 恰好一个；推荐新版 IdeaCandidate，见下方。workflow 固定 candidate_id/version；单独传 idea 可省略身份，由代码分配 UUID/version=1 |
| `room_config` | 新版 Room 的评估快照：room_id、members（成员 ID string[]）、constraints，可选 hackathon_context（共享摘要 string）、discussion_round_limit、idea_candidate_limit、status，以及 time_limit |
| `team_criteria` | 可省略，默认空标准；若提供，使用 `{version,criteria,unresolved_tradeoffs}` |
| `shared_resources` | 已获准共享的技能/资源条目，不传私人访谈。没有资料可以传 []，但不能假定团队资源足够 |
| `previous_report` | 可省略、null 或历史报告；只供规划补查，不自动成为本次证据；支持 1.1/1.2 报告 |
| `tool_budget` | 可省略或部分覆盖默认预算 |

新版候选必须包含 `title`、`target_user`、`problem`、`solution`（非空 string）、`mvp`（非空 string 或非空 string[]）；candidate 还必须提供 `candidate_id` 和正整数 `version`。支持 `discussion_trace`、`tradeoffs`、`member_suggestions`（string[]，均为授权共享摘要）、`status`（string）。也支持规划第 8 节的 `why_team`（string）、`key_tradeoffs` / `open_questions`（string[]）；优先使用 tradeoffs。版本、修改来源和成员确认由 workflow 管理。

`critical_dependencies` 可选，每项 `{dependency_id,description,must_have}`。已知依赖必须完整检查；未提供时模型从 solution/mvp 识别必要条件，不能因为清单为空就通过。

旧版 `target_users/core_flow/mvp_scope` 输入及 `member_ids` Room 仍支持；这些旧字段不与新版字段混用。Evaluator 不再要求旧版访谈轮数与候选迭代配置。constraints 支持 workflow 提供的 string[]，或旧版有来源与 acceptance 的结构化条目。

### 项目时间限制：先问用户

这是被评估项目的交付约束，独立于本系统的开发窗口及 tool_budget。

| 用户回答 | `room_config.time_limit` |
| --- | --- |
| 明确无时限 | `{"kind":"none"}` |
| 有可用时长 | `{"kind":"duration","hours":40}`（正数，支持小数） |
| 有截止时间 | `{"kind":"deadline","deadline_at":"2027-01-01T12:00:00Z"}`（带时区 ISO 时间） |
| 尚未回答 | 省略此字段 |

未回答时，`evaluator.evaluate` 返回 `status="needs_input"`，`data.questions` 中包含“这个项目有没有时间限制？”；不调用模型或搜索，不给 passed 判定。Workflow 将题目显示给用户，保存答案到 room_config.time_limit 后，按更新后的 input_revision 重新提交。无时限可以正常评估，其他技术、资源、预算约束仍需检查。旧版非空 deadline_at 可转换成 deadline；deadline_at=null、普通约束文字不能替代用户回答。冲突的截止日期/无时限会被拒绝。

仅核查某个技术问题的 `evaluator.investigate` 不要求先回答整个项目的交付时间。

资源条目格式：`{profile_id, profile_version, item_id, member_id, category, text}`；category 是 `skill` 或 `resource`。授权与快照由 workflow 保证，Evaluator 校验结构和房间成员，但不承担公共入口的认证。

`evaluator.investigate` 使用相同上下文，另加 `question: {issue_id, text, expected_information}`；仅回答这一专题，不替整个 idea 判定。

默认预算每个请求：2 次搜索、3 次网页正文读取、总时限 60000ms、单次检索 10000ms。次数允许 0，时间必须是正整数；这些是执行上限，不是检索穷尽的承诺。硬上限分别为 12、12、180000ms、30000ms，单次时限不能大于总时限。时间包含模型执行；停止新检索时预留最多 5 秒给最终报告。复杂项目可由 workflow 在硬上限内提高预算。Tavily 按其服务计费单位扣额度，调用次数不等于 credits。

## 输出

整体 envelope 的 `status` 表示执行结果，报告内的 `passed` 表示 idea 是否通过：

```json
{
  "status": "ok",
  "data": {
    "report_schema_version": "1.2",
    "report_id": "server-generated-id",
    "candidate_id": "idea-1",
    "candidate_version": 1,
    "version": 1,
    "status": "complete",
    "passed": false,
    "tests": {
      "novelty": {"result": "fail", "reason": "高度相同且无明确差异", "evidence_ids": ["web-1"], "required_changes": ["补充具体差异"], "missing_information": []},
      "feasibility": {"result": "pass", "reason": "核心路径及资源可支持最小 demo", "evidence_ids": ["web-2", "member-1"], "required_changes": [], "missing_information": []}
    },
    "competitors": [],
    "feasibility": [],
    "similar_projects": [],
    "technical_checks": [],
    "risks": [],
    "unverified_assumptions": [],
    "unknowns": [],
    "recommended_changes": [],
    "evidence": [],
    "sources": [],
    "search_log": []
  },
  "warnings": [],
  "error": null
}
```

上面是展示字段的简化片段，完整有效报告还需对应的来源与 technical_checks。完整响应保留请求的五个 envelope 身份字段。报告 `1.2` 对齐最新 Evaluation 对象，外层 envelope 保持 `1.0`。

`version` 对应候选版本；`feasibility[]` 包含可行性测试结果与证据等级，`similar_projects[]` 包含相近项目与等级；`unknowns[]` 合并未验证假设、缺失信息和未知技术项；`sources[]` 是本次来源与等级。保留 `candidate_version/tests/competitors/unverified_assumptions/evidence` 供旧展示代码迁移。technical_checks 的 conclusion 已改为新枚举，旧消费者必须按报告版本读取，不能继续按 documented_support 匹配。

评估报告另含运行层生成的 `novelty_coverage`：`{required_scopes:["github","devpost"],complete,scopes:[{scope,status,attempts,result_count}]}`。每个平台 status 为 results / no_results / failed / not_searched；只有两个范围都成功完成，complete 才为 true。`search_log` 记录实际 query、scope、executed、result_status、result_count、excluded_count、result_urls，失败时附 error_code。executed=false 表示预算或取消阻止了实际调用，不能计为已搜索；范围外返回内容不计为 no_results。旧 1.1/1.2 历史报告仍接受，但不替代本次检索。

| 证据等级 | 适用范围 |
| --- | --- |
| `verified` | 实际执行并有测试记录；当前检索模式不产生 |
| `supported_by_source` | 实际读取的公开来源／官方技术文档支持 |
| `team_claim` | 已授权共享的成员技能或资源自述 |
| `needs_test` | 下一步需要实测；technical_checks.next_check_status |
| `unknown` | 无法确认、证据不足 |

technical_checks 的 `outcome` 单独表示 `support` / `blocker` / `unknown`，避免把“有来源支持存在阻碍”误读为可行。`next_check` 保留待执行任务文字。investigate 也返回 version、conclusion、outcome、sources、next_check_status。

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

`context` 包含 room_config、team_criteria、shared_resources、previous_report、tool_budget，与 workflow payload 一致。`retrieval` 可由其他 MCP/服务适配器注入，接口为 `search(query,{limit,signal,includeDomains?}) -> {results:[{url,title,content}]}`，`read(url,{signal}) -> {url,title?,content}`。适配器应执行 includeDomains 限制；运行层也检查返回的项目 URL。两个工具共享预算与来源规则，不能绕过账本直接把引用交给模型。

进度仅包含 request_id/type，不包含私人输入、工具参数或模型思考。函数不会写 SpacetimeDB；workflow 在 candidate_refinement 后调度评估，再展示 final_review，自行保存报告并核对 input_revision/version，不能以报告完成次数递增用户输入版本。needs_input 需要上层转发题目并提交新快照；此模块不直接向最终用户发消息。

## 真实模型和 Tavily 配置

环境变量是部署配置，不能从用户 idea 读取；不要把密钥提交到仓库。

| 变量 | 默认／用途 |
| --- | --- |
| `EVALUATOR_PROVIDER` | deepseek；可选 gemini |
| `EVALUATOR_MODEL` | DeepSeek 默认 deepseek-flash；Gemini 默认 gemini-2.5-flash。按账户可用模型修改 |
| `EVALUATOR_STRICT_TOOLS` | DeepSeek 官方默认启用严格工具格式并使用 /beta 生成接口。0 使用普通接口；自定义 BASE_URL 默认关闭，可显式设 1（所选接口须支持 strict）。本地字段、来源与预算校验始终保留 |
| `DEEPSEEK_API_KEY` / `GEMINI_API_KEY` | 对应模型密钥；缺失时 CONFIG_ERROR |
| `EVALUATOR_MAX_TOKENS` | 4096；允许 256–16384，实际受模型上限约束 |
| `EVALUATOR_BASE_URL` | 可选可信 HTTPS DeepSeek-compatible 地址；Gemini 使用 Pi 原生 Google provider |
| `EVALUATOR_RETRIEVAL` | cli；可选 api |
| `TVLY_PATH` | tvly；Windows 若不在 PATH，可填 `C:\Users\sks31\AppData\Roaming\Python\Python313\Scripts\tvly.exe` |
| `TVLY_PYTHON` | 可选：安装了 Tavily CLI 的 Python 解释器（Windows 本次为 python，WSL 通常为 python3）。启用项目内 MCP SSE 解析兼容入口；解决原 CLI 将来源中的 Unicode 分隔符误当协议换行的问题，认证仍由 Tavily CLI 处理 |
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

## 可重复的真实 API 测试

`live-test.mjs` 显式调用真实服务，不属于普通 `test`。它会读取本目录的 `.env`；其中保存实际密钥即可，不要发到聊天或加入 Git。生产 `cli.mjs` 不自动加载此文件，可使用 `node --env-file=.env cli.mjs`，或由部署进程注入环境变量。已有环境变量优先。

本次验证环境为 Windows PowerShell、Node 24.19.0、Python 3.13、已认证 Tavily CLI。重跑：

```powershell
cd D:\Mhacks\agent\evaluator
$env:TVLY_PYTHON = 'python'
node live-test.mjs all
# 单独复测：node live-test.mjs feasible / duplicate / blocker / investigate
```

WSL 可使用 `TVLY_PYTHON=python3 pnpm test:live`，前提是该 Python 环境已安装并认证 Tavily CLI，以及 Node >=22.19；本次未在 WSL 验证真实调用。兼容入口替换子进程内的 MCP 响应解析，不修改已安装 CLI 或认证配置。未启用时仍运行 TVLY_PATH 对应的原 CLI。

每个用例保存请求、接口响应、实际工具调用、模型公开响应及 token usage；原始思考和密钥不记录。日志位于被 Git 忽略的 `live-results/<时间>-<用例>/`。模型格式失败仍返回 INVALID_OUTPUT，不会放宽来源验证或无限重试。

另有 `*-wire.json` 保存端点及严格模式参数（不含认证头），`*-tool-feedback.json` 保存后续模型轮次收到的工具结果／纠错反馈。末次提交没有后续轮次时，其工具结果不会出现在这份反馈记录中。

测试预算每个评估为 3 次搜索、4 次读取、总计 180 秒、单次 30 秒、最多 12 个模型轮次；不等于被评估项目的时间限制。缺少项目时间回答时不调用外部服务。可行样例断言可行性及存储/导出文档来源，不预设查重一定通过。

生产输出语言为英文，保留原始来源摘录和输入的专有名称。文档和离线 demo 的说明仍可为中文。当前自动来源校验检查 ID、URL、类型和读取记录；自然语言结论与来源内容是否相符仍需语义审查。最新测试结果和剩余问题见上方报告。


## Integration branch adapter

On `feat/integration-spacetimedb`, use `workflow.mjs/runWorkflowEvaluation` through `python -m workflow --mode integrated --model offline --evaluator agent`. See [workflow integration](../../workflow/INTEGRATION.md) for v2 input mapping, approved-resource context, explicit project time, retained 1.2 reports and `.env` configuration. The standalone native API documented above is unchanged. `--model live` is required for real external calls; offline output is explicitly marked as synthetic.
