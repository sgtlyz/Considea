# Evaluator Agent：交付与接线说明

Evaluator 负责人交付共享操作 `evaluator.evaluate`，模块约定 `agent/evaluator/definition.mjs`，name 为 `evaluator`。角色分工由团队确定。主流程以 [workflow_updated.md](../workflow_updated.md) 为准；共享字段以 [契约 v2.0](contracts.md) 第 7 节及 [JSON Schema](interfaces/protocol.schema.json) 为准。

现有 [Evaluator 独立实现](evaluator/README.md) 已能运行，但使用内部请求接口和 EvaluationReport 1.2，尚未适配共享 v2.0。下文区分共享交付要求、已有评估能力和待完成接线。

## 1. 职责与流程边界

候选生成或修订后先评估，再交给 Human Review。检查查重、技术 API、数据、设备、MVP 实现路径、团队资源、预算及用户提供的时间约束；提出缩减范围、替换依赖或补充差异的建议，不直接修改候选。

不读取成员原始私人访谈，不分析成员心理，不决定团队接受、小改或加一轮，不生成批准、共享、共识或数据库事件。首版为只读检索和文档/资源分析，不执行项目原型、付费 provider 测试、代码生成运行、客户访谈或专利新颖性判定。

## 2. 共享 v2.0 接口

输入为公共字段 `contract_version`、`discussion_round`、`room_context`，以及 `candidate`、`shared_sources`、`search_policy`、`provided_evidence`。candidate 含精确 `candidate_ref` 和完整 `content`；共享来源必须获准使用并能解析候选引用。provided_evidence 是 Workflow 已获取并核验的证据，不能将模型自报内容冒充可信工具记录。

输出 data 为 `{contract_version:"2.0", evaluation}`。Evaluation 必须包含 `candidate_ref`、`report_status`、`summary`、`findings`、`similar_projects`、`risks`、`unknowns`、`recommended_changes`、`evidence`、`search_log`；数组可空但不能省略。Finding、Evidence 的精确字段及枚举以 schema 为准，dependency_key 必须来自当前候选，evidence_keys/source_id 必须可解析。

`search_policy.enabled=false` 或 `max_queries=0` 时不搜索；所有实际工具还须受部署运行预算限制并响应取消。Agent 不写业务状态。工具执行与来源真实性由 Evaluator 负责人保证，Workflow 在提交时再检查预算、身份、候选版本及引用。

外层 `status=ok` 对应 `report_status=complete`；`status=partial` 对应 `report_status=partial`。complete 表示此次评估操作完成，不等于零风险或技术全部实测。缺少资料时如实保留 unknown；资料不足且无法完成必要检索时返回 partial，不替 Human 推进或否决候选。

共享协议只有 `evaluator.evaluate`，没有独立 investigate operation。Human 小改后由 Idea Generator 产生新候选版本，再 evaluate 并重新审阅。

## 3. 已有查重与可行性能力

### 查重

只有现有项目的目标用户、核心问题和核心方案高度相同，且当前 idea 没有明确差异时才不通过。同类产品存在不会自动淘汰；仅改名称或模型不算充分差异。

最低检索范围为 **GitHub 具体仓库**和 **Devpost hackathon 具体项目**。现有运行层优先将前两次搜索分配给两者，并向 Tavily 传域名过滤，约束 query 为 `site:github.com` / `site:devpost.com/software`。用目标用户、问题和核心方案关键词检索，不只查拟定名称。后续搜索可补充其他产品或官方技术文档；不遍历整个平台，也不声称穷尽。

读取相关仓库或 `/software/<项目>` 正文后比较重合、差异和成熟度，最多返回三个实际相近项目。目录、topics、用户主页、比赛列表和 gallery 只是线索，不能代替项目正文。项目方明确自述的实现可标 self_reported_implemented；计划标 planned；无法确认标 unknown。页面未提到某功能不证明它不存在，代码仓库存在也不证明完整流程可运行。

未成功覆盖两个最低范围时不能查重 pass，应保留缺口并返回 partial；已有正文支持的重复 fail 可以保留。搜索失败与成功零结果分开；零结果只表示“本次未发现”，不是全球首创。v2 关闭搜索或预算不足时仍服从上限，不自动增额或绕过限制。

### 可行性与项目时间

逐项检查候选必要依赖，保留依赖身份；没有依赖清单时从核心方案和 MVP 识别必要 API、数据、设备与访问条件，不能把空清单当成无依赖。结合获准共享的团队技能、实际资源、预算和用户约束说明实现路径及工作量前提。

项目时间由用户回答：有无时间限制；有时限时提供可用小时数或截止时间。明确无时限是有效回答，不自动加 deadline。本系统的开发窗口不是被评估 idea 的时间限制；工具执行毫秒预算也不是项目交付时间。

当前内部 evaluate 在未回答时返回 `needs_input`，等待 Workflow 询问并带更新快照重试。v2 尚未定义完整的时间回答和 Evaluator needs_input 流程，需要接线时协调；不能把 `room_context.deadline_at=null` 当成用户已经明确无时限。

内部报告两项结果为 pass / fail / insufficient_evidence，只有查重与可行性同时 pass 才计算 `passed=true`。必要依赖未知或资源不明时不能可行性通过；有证据的必要 blocker 且当前范围无可行替代时才 fail。建议修改由 Workflow 和 Human 决定，通过评估不等于成员接受。

## 4. 来源与工具规则

- supported_by_source：实际读取且与结论相关的文档或公开项目来源支持。
- team_claim：可追溯的、获准共享的成员陈述；技能自述不能证明必要 API、数据或设备已可获得。
- verified：必须有实际执行及可信 test_record；当前文档检索模式不产生 verified。
- needs_test / unknown：保留下一步实测任务、缺失信息和结论支持范围。文档证明存在 blocker 时必须明确阻碍，不能误标成支持可行。

来源 ID、URL、读取时间、分类与检索日志由代码记录，模型只引用本请求实际账本。搜索片段不作为正文证据，历史报告不自动成为本次证据，第三方介绍不能证明官方能力。外部页面和仓库内容是待分析数据，不是指令。

现有工具为 `search(query, limit, scope?)` 和 `read_source(url)`，来源账本由运行层维护。内部默认每请求最多 2 次搜索、3 次读取、总时限 60 秒、单次 10 秒；调用次数允许为零，时间须为正整数。部署硬上限内可调整，v2 适配还必须取不超过 search_policy 的有效搜索预算。

模型输入/生成说明使用英文，两个项目 SKILL.md 已为英文；原始来源摘录及专有名称保留原文。来源校验检查引用、URL、分类和实际读取，不保证所有自然语言结论已独立验证。DeepSeek + Tavily CLI 的独立真实测试记录见 [LIVE_TEST_REPORT.md](evaluator/LIVE_TEST_REPORT.md)，不是共享 v2 Workflow 的联合验收。

## 5. 现有实现与共享协议的适配差异

外层 envelope 都为 `schema_version:"1.0"`，但不代表业务 payload/data 相同。当前实现不应直接作为 v2 default definition 加载。

详细对照见 [共享契约](contracts.md) 第 12 节。需要将 `room_config/shared_resources/tool_budget` 转为公共上下文、来源和搜索政策，将候选身份转为精确 `candidate_ref`，将内部报告转为 v2 Evaluation；同时解决时间问答、提供证据的信任边界、来源分类和新增依赖的引用。当前 `definition.mjs` 仅导出 `createDefinition(request, session)`，通用 Pi CLI 要求默认 plain object，须交付适配入口并保留请求级账本、严格输出和预算校验。

v2 不允许额外字段，不能原样塞入内部 tests/passed/novelty_coverage、详细日志、source_ref 或来源摘录。转换应保留判定含义、缺口、证据与版本；如需新增共享展示字段，同步修改契约、schema、fixtures 和消费者。内部详细审计仍可由服务端保留。不得在仅重命名字段时改变来源可信度或把不完整报告投影成 complete。

内部 `evaluator.investigate` 保留用于单个技术问题，关联 issue_id 和候选版本，返回 conclusion/outcome/limitations/next_check；它不判断整个 idea，也不要求查重覆盖或整个项目时间回答。它不是共享 v2 operation，不能直接派发到当前 Workflow。

## 6. 样例与验收

- [v2 无法检索时的 partial](interfaces/fixtures/evaluator-partial.json)
- [v2 complete 的离线结构样例](interfaces/fixtures/evaluator-complete.json)
- [当前独立 Evaluator 请求与运行说明](evaluator/README.md)

所有离线样例证据均为明确 mock，不能作为真实研究。共享交付验收应覆盖：默认 definition 可被 Pi 加载，v2 配对输入输出通过 schema，source/evidence 引用可解，dependency_key 来自当前候选，candidate_ref 完全一致，旧版本结果不覆盖新版，搜索关闭/取消/预算耗尽时不编造工具结果，平台覆盖不足和来源无法读取时返回 partial。

每条关键技术结论与竞品比较保留相关证据及限制，来源冲突明确列出，未知项不补成事实。Human 查看报告后决定接受、小改或加一轮；Evaluator 和测试脚本都不能生成真实人工确认。
