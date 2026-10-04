# Agent 整合：运行、接口与验收

当前主线：`master`（已整合 `feat/integration-spacetimedb` 与 `deploy/vercel-render`）；云端配置见 [部署说明](../DEPLOYMENT.md)。四个角色均使用队友代码；Evaluator 已通过 `agent/evaluator/workflow.mjs` 接入当前工作流。Mem0 保留原实现，但没有启用，也不会上传任何记忆到 Mem0。

## 安装与运行

在仓库根目录运行，需要 Python 3.10+、Node 22.19+ 和 pnpm：

```powershell
python -m pip install -r workflow/requirements.txt
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/interview install --frozen-lockfile
pnpm --dir agent/idea install --frozen-lockfile
pnpm --dir agent/evaluator install --frozen-lockfile
pnpm --dir agent/idea/spacetime install --frozen-lockfile
pnpm --dir workflow/node install --frozen-lockfile
pnpm --dir workflow/node build
python -m workflow --mode integrated --model offline --evaluator agent --db workflow/data/integrated.sqlite3
```

打开 http://127.0.0.1:8765 。`offline` 使用真实 Agent service、validator 和 Pi loop，但模型回答来自明确标记的固定样例；Negotiator 使用队友实现的 Python 规则排序，不调用模型。

真实模型：首次将根目录 `.env.example` 复制为 `.env`（已有 `.env` 时直接编辑），填写 `DEEPSEEK_API_KEY`、`TAVILY_API_KEY`，然后启动：

```powershell
python -m workflow --mode integrated --model live --evaluator agent --db workflow/data/live.sqlite3
```

启动时自动读取**仓库根目录** `.env`，无需再逐条设置终端环境变量。支持 UTF-8 BOM、注释和引号；值按原文读取，不展开 `${...}`。终端已有变量优先，`.env` 不存在时继续使用终端配置。修改文件后需重启服务。不会自动搜索父目录或读取各 Agent 子目录的 `.env`。

`.env.example` 已提供 `PI_PROVIDER=deepseek`、`DEEPSEEK_MODEL=deepseek-flash` 和空密钥；真实 `.env` 被 Git 忽略。其他 provider 可配置 `PI_PROVIDER`、`PI_MODEL` 和对应密钥。配置密钥不会自动开启 live，仍需显式传 `--model live`；不会自动回退到模拟模型。用新的数据库文件创建 live 房间，避免与旧 mock/offline 房间混用。

Evaluator 默认 `--evaluator agent`：live 使用真实 Pi 工具调用与 Tavily API；offline 使用同一运行器、检索账本与提交校验，模型和检索结果都是模拟数据。`stub` / `blocked` 仅保留作显式调试选项，不代表真实评估完成。

Evaluator 默认复用 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL`；可单独设置 `EVALUATOR_PROVIDER`、`EVALUATOR_MODEL`。工作流默认 `EVALUATOR_RETRIEVAL=api`，无需安装 Tavily CLI。Gemini 则使用 `EVALUATOR_PROVIDER=gemini` 和 `GEMINI_API_KEY`。不要把真实密钥提交到 Git。

创建房间时给出 `config.project_time_limit`：`{"kind":"none"}` 明确表示无时限，或 `{"kind":"duration","hours":24}`，或 `{"kind":"deadline","deadline_at":"2026-10-05T18:00:00Z"}`。已有 `room_context.deadline_at` 可直接使用；两者同时提供时必须一致。遗漏不会被解释为无限时间，生成后会停在 evaluating，等待管理员在页面补充。该配置填入后不可通过此接口变更，避免已评估版本的约束被静默修改。

页面默认启用最多 2 次公开网页搜索。直接调用创建 API 时需传 `search_enabled:true,max_search_queries:2`；API 旧默认仍为关闭。Evaluator 实际搜索上限为 12，默认最多读取 3 个来源，评估运行时限 120 秒。搜索关闭时不调用检索也不需要 Tavily 密钥，只能给出证据不足的创新性结论；评估运行时限和项目交付时限是两个不同参数。

## 接 SpacetimeDB

使用 **CLI 与 SDK 同为 2.10.2**。先在另一个终端启动自己的本地实例：

```powershell
spacetime start --listen-addr 127.0.0.1:3000
```

保持实例运行，在仓库根目录：

```powershell
python -m workflow.prepare_spacetime --server http://127.0.0.1:3000 --database considea-dev
python -m workflow --mode integrated --model offline --evaluator agent --db workflow/data/integrated-space.sqlite3 --spacetime-config workflow/data/spacetime.json
```

从旧版本升级时也需重新运行准备脚本，更新允许 `evaluation_details` 的共享看板字段白名单。准备脚本在指定开发服务器发布模块、生成绑定、构建 SDK 客户端，并将 owner token 写入 Git 忽略的 `workflow/data/spacetime.json`。**不会删除已有数据库数据**。脚本支持 `--cli` 指定已安装 CLI 的完整路径。首次连接产生独立 workflow/worker 身份并写回同一私有配置；配置文件必须可写，不能提交或发送给浏览器。

本次本机验收使用 `127.0.0.1:3019`、`considea-integration`，数据、下载的 CLI、日志及配置均在忽略的 `workflow/data/`，没有云端发布。该测试进程不保证持续运行；上述命令可重建自己的运行环境。

## 接线与记忆

| 模块 | 输入/输出与入口 |
| --- | --- |
| Interview | `service.mjs/runInterview`；所有新访谈使用 Interview 专用 v2.1 扩展；返回相同版本 |
| Negotiator | `agent.negotiate.handle_request`；v2.0 `negotiate.detect`；使用原生 Python 实现 |
| Idea | `service.mjs/runIdea`；接数据库时走 `runIdeaFromStore`；生成和修改都用 v2.0 |
| Evaluator | `workflow.mjs/runWorkflowEvaluation` → `runner.mjs/runEvaluator`；对其他 Agent 保持 v2.0，完整原生 1.2 报告保存在 `evaluation_details` |
| Human 事件 | 仍是 v2.0；身份、批准、轮数、投票和审阅只由 workflow 验证 |

Interview v2.1 只扩展该角色，不启用 Idea 的独立 v2.1 检索协议。新跟进输入额外含 `decision_result / candidate / evaluation`：前三轮携带已收齐的真实回答和继续路由；diverge 携带真实投票；reopened 携带确切候选、对应报告和每位成员自己的 review。reopened 的 feasibility 来自完整报告的测试结果：pass→feasible、fail→infeasible、insufficient_evidence→unknown；旧报告没有 verdict 时仍为 unknown，不从 partial 推断不可行。

Idea 小改的 `human_review` source.text 与原始 `review.instructions` 一致；事件完整正文仍存 SQLite。无修改文字的 accept 事件保留其结构化文本。

- SQLite 是流程状态与授权历史的主记录，保存私人访谈、批准、事件、任务快照和来源。
- SpacetimeDB 是 Idea 执行队列和结果缓存；Python 的任务记录只跟踪派发及应用结果，不另行执行同一 Idea。
- Agent 每次创建新的 Pi 会话；workflow 明确传入授权上下文。Idea 只使用数据库中领取到的任务快照。没有隐式跨调用 memory，也没有启用 Mem0。
- 共享看板仅含批准资料与共享事件；原始 rooms.state、私聊、草稿、令牌不会同步。
- SQLite 同一事务保存状态及 `shared_outbox` 最新快照。同步失败保留重试，SpacetimeDB 按版本拒绝旧覆盖；两库之间没有分布式原子事务。
- SDK 订阅通过服务器转为带 Bearer 认证的 `/api/rooms/{id}/updates` SSE，页面收到变更后重新获取本身份 RoomView。浏览器没有 SpacetimeDB 后端凭证；另保留 10 秒恢复轮询。
- `agent_runtime` 标明模型模式、真实规则 Negotiator、Evaluator 运行方式和 Mem0 关闭；HTTP RoomView 的 `realtime` 含连接状态和已同步版本。

## 并发、失败与边界

- Idea 的 SpacetimeDB 租约为 5 分钟，模型执行上限为 90 秒。整合模式接数据库时，外层 SQLite 派发租约为 8 分钟，避免旧任务恢复期间又派发一个独立执行者。
- 先等待 reducer 提交和订阅缓存应用，再读请求或返回结果。并发领取只允许一个有效 attempt；成功结果重连后可复用。
- 失败结果不会推进流程。workflow 在有界自动重试或人工 retry 时保留 request_id、递增 attempt，允许重新执行缓存的错误结果；成功缓存不能被清除。JSON/契约错误仍需要显式 retry，详细规则见 [失败恢复](README.md#失败恢复并发与权限边界)。
- 停止房间会作废 SQLite 任务并排队更新远端版本；同步尚未到达时远端可能完成已启动调用，但旧结果不能推进本地状态。
- 进程崩溃和租约过期可能导致模型重跑或再次计费；只保证有效结果不会重复应用。
- 当前没有授权撤回功能；`authorizationRevision=0`，不声称已实现撤回记忆。新增撤回入口时必须同时处理历史来源和远端任务版本。
- 独立 Interview Agentverse/ASI 会话仍有自己的 JSON 存储，它不是团队房间的入口，本轮没有把整个团队 workflow 发布到 ASI。
- 当前已接 Evaluator 自带的检索；Idea 独立检索扩展、Mem0 与云端部署未启用。真实模型验收状态见下方记录。

## 测试

```powershell
python -m unittest discover -s workflow/tests -v
python -m unittest agent.negotiate.test_negotiator -v
python agent/interfaces/validate_contracts.py
pnpm --dir agent/interview test
pnpm --dir agent/idea test
pnpm --dir agent/evaluator test
pnpm --dir agent/idea/spacetime typecheck
pnpm --dir agent/idea/spacetime test
```

本地 SpacetimeDB 启动并准备配置后：

```powershell
$env:CONCLAVE_TEST_SPACETIME_CONFIG = (Resolve-Path workflow/data/spacetime.json).Path
python -m unittest workflow.tests.test_integration.SpacetimeIntegrationTests -v
pnpm --dir workflow/node test
```

这组测试创建虚构房间，不能指向生产数据库。浏览器验证使用 `workflow/node/browser-smoke.mjs`；安装 Playwright 及 Chromium 后，对本地已启动服务设置 `CONCLAVE_TEST_URL` 再执行。也可用 `PLAYWRIGHT_MODULE` 指定已有 Playwright 安装路径。默认验证真实 SSE；无 SpacetimeDB 时设 `CONCLAVE_TEST_POLLING=1` 验证 HTTP 轮询，并通过管理员页面补充时限，随后检查原生评估报告与人工接受。

首次整合验收（Evaluator 接入前）：Interview/Pi/会话 70 项、Idea 75 项、Negotiator 18 项、SpacetimeDB reducer 10 项、原 workflow 18 项、跨 Agent 闭环 4 项、本地数据库闭环 4 项、真实 SDK 3 项、独立 ACP 传输 5 项通过；协议样例和双浏览器闭环通过。浏览器关闭了恢复轮询，验证实时更新确实来自订阅。模型均为模拟响应，Evaluator 均为占位，不代表模型输出质量。


### 2026-10-04：`.env` 与真实模型初验（harness 增强前）

- 仓库根目录 `.env` 已能加载 DeepSeek 配置并传给 Node worker；真实 API 已返回 Interview 问题和摘要。测试仅使用虚构的双人成员及回答。
- 本次相关回归：Workflow 26 项、Interview/Pi/会话 73 项通过。4 项 SpacetimeDB 集成测试因未启动专用实例而跳过；本次真实 API 测试使用隔离的本地 SQLite，不代表重新验收了 SpacetimeDB。
- 真实调用发现摘要条目键重复、unknowns 类型错误、warnings 层级错误，以及跟进提问误用问题预算和来源编号。已补全 Interview 提示；仅对错放在 data 下的字符串 warnings 做保留原内容的层级规范化。事实、来源、停止条件和人工门控仍严格校验；增加 3 项回归用例。
- **真实模型完整闭环尚未通过**：后续调用仍出现不完整 JSON，被拒绝为 INVALID_OUTPUT。四轮讨论后的真实 Idea 生成及小改尚未验收，不能以离线测试通过代替。Evaluator 仍是占位实现。
- 没有加入自动重试、放宽事实/来源校验或自动跳过人工步骤。后续需解决真实模型的结构化输出可靠性，再重新运行完整闭环。
- 原始测试记录、隔离数据库与脱敏诊断留在 Git 忽略的 `workflow/data/`；真实 `.env` 不进入版本控制。


### 2026-10-04：harness 增强后的状态

- Interview 和 Idea 从现有 Schema 生成逐请求输出约束；Interview 约束成员身份、问题数和私有/共享来源，Idea 约束槽位、候选版本与成员贡献来源。提示中的 Schema 与本地校验配合使用，不声称 provider 开启了严格 Schema 解码。
- Interview 可由程序补齐遗漏的固定身份/版本和临时条目键。显式错误身份、重复键、其他成员的证据、未知来源、伪造批准继续拒绝。
- 团队 Interview 最多两次模型调用，共用 60 秒期限；无 Mem0 的 Idea v2.0 最多一次输出纠正，共用原 90 秒及模型轮次上限。工具模式不启用纠正；provider 错误不自动重试；意外工具请求立即终止。
- 本地只接受两类有限格式修复：补末尾缺失的容器结束符；将提前关闭顶层对象后的字符串 warnings 数组接回顶层。不得补业务字段、续写字符串、猜测来源或丢弃内容，修复结果仍执行全部校验。成功修复/纠正有 warning；失败保留安全的错误分类，受保护诊断不进入公共进度。
- 本轮最终相关回归：Interview/Pi/会话 **88 项**，Idea **81 项**，Workflow **26 项**通过；接口样例通过。4 项依赖专用 SpacetimeDB 实例的测试跳过。本轮真实测试使用隔离 SQLite，未重新验收 SpacetimeDB。
- 真实 DeepSeek 已通过四轮双人访谈、分歧回答与人工收敛门控。Idea 生成在修复后通过（包括一次有上限的模型纠正）；捕获到的真实小改响应也通过了有限包装修复后的离线重放和完整契约校验。
- **真实完整闭环仍未通过**：重新发起的小改调用在有限修复与一次纠正后仍出现 INVALID_JSON，另一次出现输出/来源归属拒绝。后续已细化来源白名单和错误分类，但最新真实小改仍因 JSON 格式失败。任务保持 failed，没有发布错误候选，没有完成最终人审。
- 没有继续追加无上限的模型重试，没有将测试失败伪装为成功；本轮未 commit/push。真实测试的失败记录和合成成员数据均留在 Git 忽略的 `workflow/data/`。Evaluator 仍为明确标记的 stub。


### 2026-10-04：Workflow 故障恢复增强

- 增加可配置的有限退避重试、运行任务续租、过期结果拒绝和按次失败审计；既有输入/输出契约与人工决策规则不变。不会自动重新执行已完成的前三轮访谈或清除已保存的人工意见。
- Schema/引用校验失败准确归类为 INVALID_OUTPUT，不再被当成 MODEL_ERROR。应用结果出错则回滚整个状态转换并保留失败响应，避免无限租约重领或半完成的候选更新。
- 新增恢复测试覆盖：断连/超时、重启保留退避、重试耗尽、房间预算、租约续期/过期、重复提交、停止房间、私有任务权限、旧数据库升级、写入中断回滚，以及四轮之后 Idea 小改失败并从该节点恢复到人工接受。
- 本轮验证使用合成数据、故障注入和真实 Agent 代码的离线模型；不代表 DeepSeek 的 JSON 问题已经解决。真实模型完整闭环仍待通过，Evaluator 仍为 stub；本轮不追加付费模型调用，也不 commit/push。

- 验证结果：Workflow 相关 **40 项**通过（含新增 **14 项**故障恢复测试），**4 项**专用 SpacetimeDB 测试未启用而跳过；接口样例通过。保存的真实调用合成测试数据库已在只读备份上验证迁移，房间状态、原任务输入、次数和失败响应均保持不变，原库未修改。


### 2026-10-04：多余右括号自动修复

- 在共享 harness 的文本解析入口扩展确定性修复，覆盖对象内部、数组元素和末尾多出一个 `}` 的情况。它不额外调用 LLM；只接受唯一通过完整校验的结果，并记录修复 warning。字符串内容、源引用、候选版本及人工批准规则不放宽。
- 有歧义、重复键、多处语法损坏、超过扫描预算或修复后契约仍无效时不采用本地修复，继续原有有界纠正/失败处理。具体边界见 [Pi Base](../agent/pi-base/README.md#多余右括号的本地修复)。
- 本轮相关回归：Interview/Pi/会话 95 项，Idea 83 项、跨 Agent 离线闭环 4 项通过（共 182 项）。已保存的两次真实 JSON 失败响应通过离线修复重放与完整契约校验。真实模型闭环不因此视为通过，本轮未增加付费调用；SpacetimeDB 实例未重测。没有 commit/push。


### Evaluator 接口与持久化

本次导入 `origin/feature/evaluator` 的 Evaluator 实现（`642eb9c`），并适配本分支的人工工作流；没有合并该分支的其他架构变化。

- `evaluator.evaluate` 的 v2.0 request / response 保持不变。工作流在内部任务 `context` 中另存明确时限、当前已批准的 skill/resource 条目及来源映射；只传 `basis=member_statement` 的条目，不传私人原文或 AI 推测资源。Node 桥接核对成员、画像版本及原文与共享 source 一致。
- 兼容层将输入转成队友原生结构；实际评估执行 search → read_source → submit_report。Pi Base 支持经过校验的工具提交直接结束，保留原有文本输出修复逻辑。
- SQLite `tasks.context` 是兼容新增列；房间 `evaluation_details[candidate_id]` 保存完整 1.2 报告，包括 novelty / feasibility、passed、技术核查、来源与实际搜索记录。GET RoomView、Final Output、候选历史及 SpacetimeDB 共享投影都包含该报告。小改保存旧报告，生成新版后重新评估。
- v2.0 不支持 `public_web` 来源分类，因此这类证据完整保留在 `evaluation_details`，不会伪装成官方文档或项目自述。兼容报告标 partial 并提供来源链接与限制；其他 Agent 继续收到合法的 v2.0 评估输入。
- 当前工作流只调用 evaluate；原生 investigate 接口保留但未新增产品流程。原生报告不会导入 v2 `provided_evidence`；当前工作流始终发送空数组，评估以本次检索账本为准。
- `passed` 是评估结论，绝不代替人审。原有四轮门控、全员 converge、最终全员 accept、小改后重新确认保持不变。

初次接入只做离线整合；后续真实验收与已知限制见文末记录。


### 本次 Evaluator 整合验收（离线）

- Interview / Pi / 会话 95 项、Idea 83 项、Evaluator 89 项 Node 测试与 5 项 Python 测试通过；Workflow 44 项通过，5 项需独立 SpacetimeDB 实例的测试跳过。包括完整双人四轮流程、小改后新报告、加一轮回访、时限缺失等待及管理员幂等补填。
- 契约样例验证通过。浏览器实际完成两名成员与管理员三个隔离会话：四轮讨论 → 管理员补充时限 → 原生评估报告 → 全员接受；无页面错误。本次使用 HTTP 轮询，没有声称重测 SpacetimeDB / SSE。
- 页面测试服务已停止；合成房间数据库和截图留在被 Git 忽略的 `workflow/data/`。
- 用户现有 `.env` 未被修改；模板新增空 `TAVILY_API_KEY` 与 Evaluator 选项。尚未调用真实 API，未 commit / push；下一步为配置密钥后的真实完整流程验收。


### 2026-10-04：Evaluator 真实 API 与 SpacetimeDB 验收

- `.env` 加载真实 DeepSeek 与 Tavily 配置；Tavily 搜索和网页正文读取均成功。使用全新隔离 SQLite、两个虚构成员和显式合成的人工事件，未替真实成员批准任何方案。
- 完成四轮真实访谈 → Python Negotiator → 分歧回答 → 全员模拟 converge → Idea v1 → 原生 Evaluator → 模拟 minor_revision → Idea v2 → 再评估 → 模拟全员 accept。最终 room=completed、候选 version=2；共 32 个任务成功、1 个失败后手动重试恢复。
- 首次 Idea generate 在有界纠正后仍 INVALID_JSON，未发布候选。开启受保护诊断后重试同一任务：首个输出有多余右括号及无效贡献来源引用，未被本地修复放行；单次模型纠正后通过。Idea revise 一次模型调用，经已有包装修复后通过。没有放宽字段、来源归属或人工决定规则。**本次成功不表示模型格式问题完全消失；失败仍可能需要人工重试。**
- 两次原生 Evaluator 调用分别读取 2 / 3 个真实网页；创新性和可行性均返回 insufficient_evidence，属于有效评估结论。v1 原生报告 partial、v2 原生报告 complete；v2 兼容投影保留 partial 标记，因为原生 public_web 来源无法无损放入 v2 枚举。完整来源和限制保存在 evaluation_details；从未将其伪装成官方文档。
- 修复真实数据库暴露的兼容遗漏：共享看板 reducer 白名单补入 evaluation_details，更新本地模块后同步通过。重新建立 SDK 连接，读回的完整原生报告与 SQLite 一致，最终状态也为 completed。未发布云端数据库，未删除历史数据。
- 新增字段回归后，SpacetimeDB 类型检查通过，reducer 11 项、实际 SDK 3 项、实际数据库整合 5 项通过。浏览器关闭恢复轮询，三个隔离成员/管理员会话通过真实订阅完成时限补填、报告展示与人工接受，无页面错误。
- 其余已验证回归：Interview/Pi/会话 95 项、Idea 83 项、Evaluator Node 89 项与 Python 5 项、Workflow 本地 44 项；协议样例通过。本次所有相关测试累计 335 项通过，另有真实流程和浏览器验收。
- 密钥、凭据、真实调用诊断及合成测试数据库都留在 Git 忽略目录；提交仅包含代码、文档、空配置模板及离线测试。
