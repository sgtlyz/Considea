# Evaluator Agent 实现规格

日期：2026-10-03。范围：成员 3 的 Evaluator；依据根 README、agent/contracts.md、agent/evaluator-agent.md，以及本次对话确认的 Tavily 选择。

## 目标和成功条件

接收已经细化、足够发展为项目的 idea，对“查重”和“可行性”两项测试给出通过／不通过，并附上真实来源、判断理由和必要修改。竞品比较与技术条件报告是判定依据，不能代替最终测试结果。Workflow 已有独立负责人；本模块不实现数据库、DAG 调度、成员认证、共享批准、反馈或最终共识。

通过评估表示 idea 满足这两项评估标准；成员是否愿意推进仍由团队确认。

主要接口为 `evaluator.evaluate`，接收一个 idea 并返回测试结果。原有 `evaluator.investigate` 可作为协商阶段补查问题的辅助接口，不能替代主要接口。沿用 schema_version=1.0 envelope，在报告上增加 report_schema_version=1.1 与判定字段，同步共享契约；旧消费者不应误读。离线 demo 必须标为 fixture；真实检索必须实际经过 Tavily。用户明确要求接口/API 调用代码全部实现，真实 API 暂不测试；离线验证不代表远程调用或研究质量已经验收。

## 测试标准

用户已明确两项主要测试：查重和可行性。用户已确认查重阈值：已有项目的目标用户、核心问题、核心方案都高度相同，并且 idea 缺少明确差异时不通过；仅有同类产品仍可通过。查重必须展示最接近项目、重合点、具体差异及来源，不能以名称相似或都使用 AI 判重复；“本次未发现高度重复”也不能称为全球首创。

可行性按最小 demo 判断：核心流程是否有可行实现路径，必要 API／数据／设备是否可获得，团队共享的能力和资源能否支撑，是否能在房间的时间和预算约束内完成。首版依据检索、官方文档和共享资源进行评估，不运行 idea 的项目原型；模型与检索调用层全部写好，但按用户要求暂不测试真实 API。文档支持与实际测试成功必须区分。缺少团队或约束信息时标出必要补充，不能擅自假定资源充足。

每项测试内部区分 `pass`、`fail`、`insufficient_evidence`。最终 `passed` 为布尔值：仅两项都为 pass 才为 true。若有明确失败，则写清失败原因；若因来源不可用或关键信息缺失未通过，则写“未完成核实”，不能写成“已证明不可行”。执行错误保留错误响应，不伪装成对 idea 的失败判断。

## 已确认的接入选择

- 三 Agent 共用现有 Pi Core 基座，每次 operation 独立上下文。
- Tavily 是首版检索服务。本机已安装 tavily-cli 0.1.8 和官方技能，已验证搜索与正文提取。
- 首版支持通过固定 CLI 子进程适配 Tavily；传输接口允许以后替换为直接 MCP/API，无需改动业务契约。
- DeepSeek 是模型接入候选，Gemini 为后续备选。Workflow 可注入 Pi 的 model/streamFn；离线运行不需要模型密钥。
- 不改动 Interview、Negotiate、Workflow 实现，也不替 workflow 写业务权威状态。

CLI 实测限制：当前终端找不到短命令 tvly，但完整安装路径可运行；Windows 需要 UTF-8 输出；当前 Tavily 后端拒绝 extract 的 chunks_per_source 和 timeout 参数，基础 URL 提取可以运行。适配器使用基础参数，自己实施进程超时与正文长度限制。

## 输入契约

业务输入是一个细化好的 idea：目标用户、要解决的问题、核心方案／体验、最小 demo、差异点、关键依赖。payload 接受 idea 或现有 candidate，恰好一个；idea 补默认元数据后规范化为 candidate，保留身份与版本，不复制两份内容。`room_config`、`team_criteria` 和 `shared_resources` 为可行性判断提供时间、预算、团队能力和可用资源；`previous_report`（可 null）和 `tool_budget` 为执行上下文。investigate 额外接收 `{issue_id, text, expected_information}`。

验证完整候选字段、非空身份、正整数版本、依赖 ID 唯一性、枚举及字符串数组。RoomConfig 的 room_id 必须与 envelope 一致。拒绝额外原始访谈或私人消息字段；workflow 仍须负责授权和最小快照投影。

为尚未细化的字段明确工程格式，记录在 Evaluator README 供 workflow 接线：

- `tool_budget`：`{max_searches, max_reads, timeout_ms, per_call_timeout_ms}`。非负检索次数；正整数时间。默认建议每候选 2 次搜索、3 次读取；总时限 60 秒，单次 10 秒。允许 workflow 提供更低限额；超出部署硬上限的配置拒绝。
- `shared_resources`：共享条目数组，包含 `profile_id, profile_version, item_id, member_id, category, text`；category 只允许 skill/resource。无需传整份访谈。资源是否获准共享由 workflow 保证；来源引用必须完整。
- 来源的官方域名配置属于部署端可信配置，不接受模型自行扩大。必要时由 workflow 负责人配置依赖服务的官方域名。

本模块不根据客户端 room_id 自行认定权限，不根据批准时间字符串认定访问已授权。

## 执行和导出接口

提供 `runEvaluator({request, model, streamFn, retrieval, ...deploymentOptions})`，返回现有统一 envelope。`retrieval` 可注入离线数据或 Tavily transport。

提供创建本次请求 definition 的工厂，复用 `defineRole` 与 `runAgent`。来源记录、工具预算和输出验证器共享本次请求的闭包，不能用进程全局的可变来源表；并发房间不能相互引用证据。

独立 JSONL 入口逐行读取请求、逐行写出响应；诊断不得混入 stdout。该入口为 workflow 内部调用，不是公开认证服务。若与现有 pi-base CLI 的静态 definition 加载方式不相容，在文档中明确使用 Evaluator 专用入口，避免弱化来源校验。

模型接入以锁定的 Pi 版本实际接口为准。若所选模型不在其内置表中，使用明确的模型配置/适配层，不把改环境变量当成已经支持。仅在已有凭据可用时执行有上限的真实模型验收，不展示或写入凭据。

## 工具与来源

暴露 `search(query, limit)` 和 `read_source(url)`。每次实际外部请求都计入预算；重试也计数。首版不进行自动全站爬取或长时间 deep research。

CLI 调用使用固定可执行程序和参数数组、关闭 shell。可执行程序路径是部署配置；请求不可提供脚本、模块路径或任意命令。设置子进程 PYTHONIOENCODING=utf-8，支持取消、超时、输出大小限制。只把规范化的查询、URL、结果和安全错误交给模型，不转发原始 stderr 或用户配置。

搜索结果只用于发现和提供线索。真正引用竞品功能或技术能力前，必须有实际读取的正文；搜索无结果、服务失败、正文读取失败分别记录。

来源账本由普通代码生成 evidence_id、URL、标题、accessed_at 和实际正文片段。模型可以提出 claim 和 limitation，但不能新建来源或修改来源身份。技术文档的 official_documentation 分类依据可信官方域名配置；第三方说明不能用于证明官方能力。成员自述形成 member_report，保持共享条目引用，绝不升级为实测。

前次报告不自动成为本次证据。首版可用它规划补查，但复用外部结论前重新读取来源；不传播无法核对的旧来源或旧授权。

技能指令明确页面正文属于待分析数据，不能改变角色、契约、预算或权限。

## 输出校验

evaluate 在 EvaluationReport 的来源与检查明细之上增加 `passed` 和 `tests`；`tests.novelty` 与 `tests.feasibility` 各包含 `result`、`reason`、`evidence_ids`、`required_changes`、`missing_information`。两项测试只有都为 pass 才能输出 passed=true，这条组合规则由代码执行；模型负责有来源的各项分析。来源明细仍保留 competitors、technical_checks、risks、unverified_assumptions、recommended_changes、evidence 和 search_log。同步 agent/contracts.md 与 agent/evaluator-agent.md 的通过判定描述。investigate 返回规定的专题对象。report_id 由代码分配；候选与 issue 身份从原请求绑定。

- 每个关键依赖都有且仅有一项 technical_check，不允许引用候选不存在的依赖。
- 竞品最多 3 个，不足时不补造；URL 和 evidence_ids 必须对应实际来源。
- documented_support/documented_blocker 必须引用实际获取的官方文档；member_reported 必须引用成员自述。
- 所有 evidence_ids 都属于本次账本；输出 evidence 的身份字段不得被模型篡改。
- search_log 从实际执行记录生成，不采信模型自行编造的查询记录。
- 不输出成员立场变更、批准事件或 consensus 等业务权威字段。
- 结构或来源校验失败返回 INVALID_OUTPUT；不静默改写成成功报告。

引用校验能证明来源存在和类型符合要求，不能自动证明每个自然语言结论都正确；真实样例需要人工核对结论与正文的对应关系。

## 预算和失败

软截止提前停止新外部调用，留出 Pi 最终生成报告的时间。提示词要求预算不足时明确 unknown；工具包装器在代码中强制停止。

若搜索/读取失败、覆盖不足或软预算耗尽，响应 status=partial，evaluate 报告 status=partial，保留已有证据和未检查项。正常完成也可包含 unknown；complete 不代表所有依赖已验证。执行 status 与测试结果分开：完整评估可以判不通过，执行不完整不能默认判通过；关键测试证据不足时 result=insufficient_evidence，passed=false，理由明确为尚未核实。

若 Pi 触发硬工具/轮次预算或模型超时，可由 Evaluator wrapper 生成确定性的 partial：保留真实来源和 search_log，所有未完成的判断为 unknown，不用代码伪造比较或技术结论。取消后冻结本次账本，晚返回的工具不能继续修改结果。

INVALID_INPUT、CONFIG_ERROR、INVALID_OUTPUT 保留结构化错误。provider 失败不泄露凭据或私人输入。重试由 workflow 决定，本模块不自动重复整个 operation。

## Skills

新增项目自己的 `candidate-research` 和 `technical-feasibility` SKILL.md，以仓库 evaluator 目录为边界，按 operation 固定加载。

前者定义用户/场景/流程/交互/成熟度比较及查重判定；后者定义必须依赖、官方能力、访问条件、时间与团队资源约束，以及可行性判定与最小替代方式。两者均遵守证据、预算和输出契约。

Tavily 官方 skills 可作为开发参考；不原样引入其 shell、登录、自由文件写入或不同报告格式。运行时不自动扫描个人 .agents/.codex 技能，不执行 skill 附带脚本，不添加通用技能市场或任意文件读取工具。

## 文件与接线文档

新增 agent/evaluator 下的 runner、definition、validators、Tavily transport、来源与预算工具、两份 skills、测试、离线 demo、两个请求样例、README 和模型调用入口。

README 给出安装、离线测试/demo、真实 Tavily 检索、真实模型运行和 Node/Python workflow 调用方式；解释 Windows 路径与 UTF-8、预算格式、来源分类、partial 和超时，注明模型与搜索费用分别计算。

尽量不改共用 Base；必要兼容性改动必须有回归测试并在文档说明。只修改模块接线说明，不重新设计其他角色。

## 验收

先写行为测试，再实现。至少覆盖：

1. 两个 operation 正常的 Pi 工具循环和合法输出。
2. 假来源 ID、篡改 URL/时间、错误候选版本、错误 issue、非官方证据支持技术结论被拒绝。
3. search 无结果与失败分开；读取失败如实 partial。
4. 预算为零、预算耗尽、子进程超时与取消不继续检索；已有证据保留。
5. 两个房间并发执行，证据互不串用。
6. 每个关键依赖覆盖、竞品数上限、来源状态和错误输出。
7. 旧报告不能直接变成新版本的已验证证据。
8. 运行原有 Pi Base 测试和 Evaluator 测试。
9. 离线 demo 显示 fixture 标记；真实 Tavily smoke test 实际获取公开来源。
10. 两项通过才得到 passed=true；查重失败、可行性失败分别给出依据和修改建议。
11. 同类产品存在与高度重复区分；没有搜索结果不能变成“全球首创”。
12. 缺少关键证据时不能通过，也不能声称已证实不可行；业务未通过与运行错误区分。

真实模型 smoke test 在配置可用时执行，检查工具调用、最终 JSON 与来源；若缺少模型凭据，明确报告“离线运行和真实检索已验收，真实模型质量未验证”。

## 与比赛和 Workflow 的关系

Evaluator 的模型和检索逻辑不依赖 ASI UI。Fetch 要求主流程在 ASI 对话内完成，入口、身份和交互由 workflow 同伴实现；SpacetimeDB 保存任务、版本和实时共享状态。本模块提供可展示的结构化结果及不含私人内容的真实进度。

ASI 四人身份映射、注册与提交，SpacetimeDB DAG、权限与持久化，均不属于这次代码交付，不阻塞 Evaluator 的独立实现和验收。
