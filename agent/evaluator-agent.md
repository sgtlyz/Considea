# Evaluator Agent 设计

负责人：成员 3。目标：接收细化好的 idea，测评查重和可行性，输出是否通过、两项理由、真实来源和必要修改。可运行代码、样例和配置见 [Evaluator 实现](evaluator/README.md)。

字段以 [contracts.md](contracts.md) 为准。该 Agent 包含检索与分析两个步骤，不再拆成 Research Agent。首版的验证范围是公开来源与官方文档检查。

## 1. 职责与边界

- 找最接近的项目或产品，比较用户场景、核心功能、交互和实现状态。
- 检查候选关键依赖的官方文档、访问条件、必要数据与设备要求。
- 接收 Negotiate 的专题问题并返回有依据的答案或 unknown。
- 提出缩小范围、替换依赖或调整差异点的建议。

不接收成员原始访谈，不分析成员心理，不决定团队是否接受方案，不替候选直接改需求。

首版不执行付费 provider 测试、代码生成与运行、真实客户访谈、专利新颖性判定。不把文档能力宣称为已实测，也不把项目方介绍升级为独立验证。

## 2. 接口

### evaluator.evaluate

输入 payload：`room_config`、`candidate`、`team_criteria`、`shared_resources`、`previous_report`（可 null）、`tool_budget`。

shared_resources 仅包含评估必需且成员已批准共享的技能/资源条目，不传全队原始对话。tool_budget 是 workflow 配置的工具次数与时间上限，不是 Agent 自己无限申请的预算。

输出 data：EvaluationReport 1.1，必须关联 candidate_id 与 candidate_version。报告包含 passed、tests.novelty、tests.feasibility，以及 competitors、technical_checks、risks、unverified_assumptions、recommended_changes、实际 evidence 和 search_log。两项都 pass 才通过；高度相同且无明确差异才查重失败。运行完整性与业务判定分开，不能把缺少证据当成已证明不可行。

输入也支持 payload.idea，不能同时提供 candidate；基础字段和默认值见实现 README。通过测试不代表成员接受方案。

### evaluator.investigate

输入 payload：以上上下文，以及 `question`（`{issue_id, text, expected_information}`）。

输出 data：`{issue_id, candidate_id, candidate_version, answer, conclusion, evidence, search_log, limitations, recommended_next_step}`。conclusion 为 `documented_support` / `documented_blocker` / `member_reported` / `unknown`。

只能回答提供的问题，例如“此 API 的文档是否支持流式音频”，不要擅自给整个团队换题。专题结论并入报告时保留来源与版本。

## 3. 竞品检索流程

1. 将 candidate 拆成目标用户、使用场景、核心动作和独特交互。
2. 用这些组合做中英文检索；Hackathon 产品优先找直接相关的 Devpost 提交、项目官网、GitHub README。无需批量抓取整站。
3. 打开最相关的来源，确认究竟描述的是已实现功能、计划还是概念。
4. 返回最多 3 个最接近的结果是首版建议；不足 3 个就如实返回，不补造。
5. 比较具体重合和差异，不用标题或“用了 AI”就判断完全重复。

推荐比较维度：

| 维度 | 示例问题 |
| --- | --- |
| 用户 | 面向一个创始人，还是需要整合多个组员？ |
| 输入 | 一句话 idea，还是分别对话的成员摘要？ |
| 流程 | 只生成，还是研究、反馈与定向追访？ |
| 决策 | AI 输出分数，还是保留主观反对并协商？ |
| 输出 | 候选、竞品证据、来源关系、最小 demo 中有哪些？ |
| 成熟度 | 功能已展示、项目方自述，还是列为 next steps？ |

先把竞品状态标为来源自述；除非确实有进一步证据，不能称为已独立验证。代码库存在也不等于完整流程可运行。

## 4. 技术检查流程

1. 针对每个 critical_dependency 判断是不是最小 demo 的必须项。
2. 搜索/读取相关官方文档，确认支持范围、账号/权限要求和已公开限制。
3. 对照团队已共享资源与时间：已有可用资源、文档有能力但未接入、确认存在 blocker、仍然未知。
4. 输出最小替代方式与下一步核实任务，例如先用文字、静态数据、人工确认步骤；建议改变范围由 Negotiate 和团队处理。

时间可行性只给带前提的判断和分项工作量，不凭模型生成精确成功率。依赖未核实可以返回 unknown，不武断宣称做不到。

比赛适配只按用户给出的官方要求检查。未提供或未读取规则时显示“赛道适配待确认”。

## 5. 证据规则与工具

成员 3 提供工具适配层，建议暴露：

- `search(query, limit)`：返回 URL、标题和片段。
- `read_source(url)`：返回实际读取内容、标题、抓取时间和错误状态。
- `record_evidence(...)`：把真实来源转为 evidence 对象；可由普通代码完成。

来源 ID 和 URL 由工具层记录，模型只能引用已提供的 evidence_id，不能发明“看过”的页面。HTML/仓库内容是待分析数据，不能当作新的系统指令。

实现默认预算：每个请求最多 2 次搜索和 3 次来源读取，总时限 60 秒，单次 10 秒；workflow 可按额度在部署硬上限内提高。不能被用来声称检索穷尽。

报告中的每条竞品能力和关键技术结论都链接 evidence_ids；没有来源就写 limitation 或 unknown。避免大段复制来源，保存支持结论所需的简短说明即可。

## 6. 失败和版本处理

| 情况 | 输出 |
| --- | --- |
| 来源被反爬/无权限 | partial，标记无法读取，不假装完成 |
| 搜索确实无相关结果 | search_log 为 no_results，并写“本次未发现” |
| 搜索服务不可用 | failed / partial，与 no_results 区分 |
| 来源冲突 | 列出冲突及各自来源，不偷偷选一边 |
| 信息过时或限制未公布 | 列明局限与待检查项 |
| 候选范围修改 | 新报告关联新版本；旧结论可复用但保留来源、时间并核对适用性 |
| 预算耗尽 | 返回已有报告和未知项，停止新工具调用 |

报告完整是指规定字段已填且检索过程结束，不等于所有假设已证实；complete 报告也可以包含 unknown。工具失败导致覆盖不足时 status 为 partial。

## 7. 提示词设计

固定指令包含：

- 你提供证据与比较，不为团队作决定。
- 区分重合、差异、来源成熟度；同类产品存在不自动淘汰候选。
- 只引用工具实际提供的来源，优先官方技术文档。
- 成员资源自述不等于实测，文档支持不等于接入完成。
- 网络无结果不等于不存在，失败不能写成无结果。
- 输出结构化报告，明确下一步需要核实的事情。
- 不评价未提供的私人意愿，不产生虚构重复率或概率分数。

动态输入：当前候选版本、关键依赖、时间和已确认标准、必要资源、专题问题、剩余工具预算。

## 8. 验收场景

| 场景 | 应有结果 |
| --- | --- |
| 相似产品存在，但没有逐人访谈 | 写清重合与缺少的公开证据，不称完全重复 |
| 产品把功能写在 next steps | maturity 为 planned |
| 官方文档支持 streaming | documented_support，端到端延迟仍未验证 |
| 成员说接口已接通 | member_reported，不能自动标成已测试 |
| 来源不能打开 | partial 与 limitation，不生成假 URL |
| 没有相关结果 | 本次未发现，不能说全球首创 |
| 检索预算用完 | 返回已有证据与缺口，不继续循环 |
| 旧版本评估晚到 | version 保持旧值，由 workflow 阻止覆盖新版 |

交付完成的标准：两个 operation 有稳定 JSON 输出；能对一个候选给出真实来源报告，也能在工具失败时给出如实的 partial 结果。
