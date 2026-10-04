# Workflow ↔ Agent 接口契约 v2.0

这份契约让 Workflow 和四个 Agent 可以独立开发。**操作名、JSON 字段、枚举与返回结构以本文件及 [JSON Schema](interfaces/protocol.schema.json) 为接线基准。** 流程以 [workflow_updated.md](../workflow_updated.md) 为准。本文件固定接口、离线样例和校验规则；实际 Workflow 与 HTTP 接口见 [workflow/README.md](../workflow/README.md)，业务 Agent 由各负责人实现。

## 1. 分工与交付物

| 负责方 | 固定 operation | 交付模块路径（约定） |
| --- | --- | --- |
| Interview | `interview.turn`、`interview.summarize` | `agent/interview/definition.mjs` |
| Negotiator | `negotiate.detect` | `agent/negotiate/definition.mjs` |
| Idea Generator | `idea.generate`、`idea.revise` | `agent/idea/definition.mjs` |
| Evaluator | `evaluator.evaluate` | `agent/evaluator/definition.mjs` |
| Workflow | Agent 路由、上下文构造、人工事件、权限、持久化、状态机 | workflow/ |

上表的模块是将来的交付位置，不代表这些文件已经实现。对外统一为一次请求得到一次结构化返回，不依赖 HTTP 框架。Agent 不互调，不自行等待用户点击，不读全库，不写业务状态。

每位 Agent 负责人交付：default-export 的 definition、各 operation 的输入和输出校验器、prompt、必要的只读工具，以及离线/真实调用的验收结果。Workflow 可以先使用 [fixtures](interfaces/fixtures) 中的固定回包接线。

业务参数由 Workflow 显式传入；已实现的全员收敛政策和预算配置见 Workflow 开发说明，字段约定保持 v2.0。

## 2. 统一信封

为兼容现有 Pi Base，外层 `schema_version` 保留 `"1.0"`，业务契约通过 **payload.contract_version = "2.0"** 区别旧接口。成功结果的 data 也带 `contract_version: "2.0"`。新角色校验器必须拒绝旧 payload，不能静默兼容旧字段。

```json
{
  "schema_version": "1.0",
  "request_id": "req-unique",
  "room_id": "room-1",
  "operation": "negotiate.detect",
  "input_revision": 12,
  "payload": {
    "contract_version": "2.0",
    "discussion_round": 4,
    "room_context": {},
    "shared_context": {}
  }
}
```

以上只演示信封，两个空对象是结构占位，不能直接发送；可发送的完整 JSON 见 fixtures。

| 请求字段 | 定义 |
| --- | --- |
| schema_version | 固定字符串 `1.0` |
| request_id | Workflow 生成的逻辑任务 ID，同一任务重试复用 |
| room_id | 经身份认证后确定的房间，不是权限证明 |
| operation | 上述六个精确名称之一 |
| input_revision | 非负整数，Workflow 对本次授权输入快照分配的版本 |
| payload | 对应 operation 的完整业务输入 |

返回复制五个信封字段，再添加 `status`、`data`、`warnings: string[]`、`error`。所有字段必填；不知道的可空字符串字段按 schema，集合为空用 `[]`，可空对象用 `null`。禁止未声明字段。

| status | 允许位置与含义 |
| --- | --- |
| ok | 一次操作完成；并不代表用户已批准或全队共识 |
| needs_input | 仅 interview.turn：问题已生成，等待 Workflow 展示给本人 |
| partial | 仅 evaluator.evaluate：报告可用但核查不完整，交给人审阅 |
| error | 任一操作失败，data 必须为 `{}`，不得推进业务状态 |

非 error 时 `error: null`。error 为 `{code, message, retryable}`，code 为 `INVALID_INPUT / INVALID_OUTPUT / CONFIG_ERROR / MODEL_TIMEOUT / MODEL_ERROR / BUDGET_EXCEEDED / TOOL_UNAVAILABLE`。原 Base 可能将未分类工具异常映射为 MODEL_ERROR；不得声称它已经识别全部工具错误。

模型仅生成 `{status, data, warnings}`，Base 补信封和 error。格式错误请求的低层诊断可能带空信封，不属于正常有效请求的响应 schema。

## 3. 公共输入与不可变引用

每个 payload 都含 `contract_version`、`discussion_round`、`room_context`。discussion_round 是 Workflow 提供的正整数，Agent 只读取。它与个人 interview_turn、模型 tool turns、候选 version 分开。

RoomContext：`member_ids`、`hackathon_context`、`deadline_at`（带时区或 null）、`constraints`。约束含 `constraint_id/text/verification/acceptance`；个人偏好不自动升级为已确认硬约束。

`Ref = {id: string, version: positive integer}`。引用以 id+version 同时匹配；所有权威实体 ID、版本、时间戳由 Workflow 创建。Agent 只回显输入引用，或生成本次输出内的局部 key。

### SharedContext

| 字段 | 内容 |
| --- | --- |
| profiles | 经本人批准的共享画像投影，含 profile_ref、member_id、items、unknowns |
| discussion_history | 按轮次排列的共享轨迹；各轮记录 profile/difference/answer/convergence/review 的 source_id 列表 |
| sources | 此次允许引用的 Source 全文目录，覆盖所提供的讨论历史 |

Source 为 `{source_id, kind, object_ref, member_id, discussion_round, text}`；kind 固定为 profile_item、difference、difference_answer、convergence_decision、human_review、evaluation、constraint。member_id 可 null，discussion_round 可 null。

**source_id 由 Workflow 分配并与获准共享的原对象绑定。** Agent 输出引用只能取自本次 sources（Evaluator 使用 shared_sources）。历史目录须带获准共享的实际文本，不能只给模型无法解引用的 ID。按最小权限投影；撤回内容不得通过历史目录重新泄露。删除来源引用时同步更新 history，不能留悬空引用。

SharedProfile 每个 item 含 item_id、category、text、basis、confidence、source_id；不含私人 message ID。历史画像版本通过 sources 的 object_ref 保留可追溯性，不要求把所有私人消息发给生成器。

### 权威写入

Workflow 负责 request_id、批准事件、成员真实回答、投票、轮次、candidate/version、report/version、最终确认和状态提交。模型局部 key 如 question_key、item_key、slot_id、dependency key、evidence_key 只在对应输出或输入范围内有效，不能被当作数据库写入授权。

## 4. Interview 接口

完整定义：schema 的 InterviewTurnInput / InterviewTurnData / InterviewSummarizeInput / InterviewSummarizeData。模块指南见 [interview-agent.md](interview-agent.md)。

两个输入共用：

| 字段 | 定义 |
| --- | --- |
| member_id | 当前被访谈成员，必须属于 room_context.member_ids |
| mode | initial、followup、reopened |
| messages | 该成员私人消息，格式 message_id / role(user或assistant) / content |
| current_profile | 本人已批准 SharedProfile；没有则 null |
| shared_context | 回访所需的获准共享资料，初访可为空集合 |
| followup_context | initial 必须 null；其余必须带 difference、人工 answers 和 trigger、review |

FollowupContext 的 trigger 为 difference_answers、human_diverge、review_more_discussion；difference 带 difference_ref、discussion_round、content。answers 至少一项，每项带 answer_ref、member_id、difference_ref、selected_option_key（可 null）、text、disagrees_with_framing。所需回答是否齐全由 Workflow 在调用前校验。reopened 必须提供触发加一轮的 review；其他模式的 review 可 null。

**interview.turn** 另外接收 interview_turn（该成员本轮第几次提问调用）及 limits：max_questions 为 1–3、remaining_question_batches 为非负整数。

返回 data：contract_version、member_id、questions、ready_to_summarize、stop_reason。每题为 question_key、text、purpose、related_source_ids；purpose 是可展示的提问目的，不是内部推理。

- 继续提问：status=needs_input，questions 为 1 到 max_questions 条，ready=false，stop_reason=null。
- 可以总结：status=ok，questions=[]，ready=true，stop_reason 为 enough_information、question_budget 或 member_requested。
- remaining_question_batches=0 时必须停止提问，stop_reason=question_budget；题目 key 不重复。
- Workflow 持久化题组，等待本人回答，再决定下次调用。模型不能自己生成用户回答。

**interview.summarize** 另外接收 stop_reason。返回 data 为 contract_version、member_id、profile_draft（items、unknowns）。

Profile 草稿 item：item_key、category、text、basis、confidence、private_message_ids。category 的完整枚举在 schema；basis 为 member_statement/agent_inference，confidence 为 high/medium/low。证据只能指向该成员传入的消息。输出里没有 approved_at、profile_ref 或共享批准。Workflow 保存草稿，等本人编辑并确认后生成共享投影，移除私人证据 ID。

样例：[初访](interfaces/fixtures/interview-turn.json)、[预算停止](interfaces/fixtures/interview-ready.json)、[回访](interfaces/fixtures/interview-followup.json)、[总结](interfaces/fixtures/interview-summary.json)。

## 5. Negotiator 接口

`negotiate.detect` 输入：公共字段 + shared_context。返回 data：contract_version + difference；一次选出一个当前优先讨论项。

Difference：kind、category、question、answer_type、options、affected_member_ids、why_it_matters、source_ids。沿用“对最终方向影响最大”的定义，不按人数简单投票排序。

- kind=difference 表示有依据的分歧；kind=clarification 表示暂无明确分歧，需要成员核实未知条件。后者不能编造冲突，也不能替代人工 converge。
- answer_type=binary 时 options 恰好两项，格式 key/label；open 时 options=[]。
- affected_member_ids 非空，必须属于房间；source_ids 必须来自输入目录。
- 返回中没有 actions、候选、converge 或任何最终决定。
- Workflow 创建 difference_ref 和人工答题任务。**clarification 同样经过 Human 回答**，并遵守轮数门槛。

样例：[分歧](interfaces/fixtures/negotiate-difference.json)、[澄清](interfaces/fixtures/negotiate-clarification.json)。指南见 [negotiate-agent.md](negotiate-agent.md)。

## 6. Idea Generator 接口

### idea.generate

输入：公共字段 + shared_context + convergence_decision + candidate_slots。

convergence_decision 为 `{decision_ref, discussion_round, decision: "converge", source_ids}`，由 Workflow 从合法人工事件形成。discussion_round 必须至少 4，且与当前讨论一致。模型不能把客户端伪造的对象变成授权；调用前由 Workflow 校验事件。

candidate_slots 是 Workflow 预留的非重复槽位字符串列表，数量 1–5，由调用方决定；产品原建议 3–5 不硬编码在 Agent 中。输出 candidates 必须与槽位一一对应、不少、不多、不重复。每项为 `{slot_id, draft}`。Workflow 在提交时分配 candidate_ref，不由模型创建权威 ID/version。

### idea.revise

输入：公共字段 + shared_context + candidate + evaluation + reviews。仅对一个候选修订一次；reviews 为 Workflow 已校验的 minor_revision 人工意见。意见冲突先留在 Workflow，不让模型替团队选择策略。

返回：contract_version、base_candidate_ref（精确回显当前版本）、draft。Workflow 检查版本后保存 version+1，再调用 Evaluator，最后再次请求 Human Review。小改不修改 discussion_round。

### CandidateDraft

title、target_users、problem、solution、core_flow、mvp_scope、out_of_scope、critical_dependencies、contributions、discussion_source_ids、tradeoffs、unknowns、change_summary。

critical_dependencies 每项含局部 key、description、must_have。contributions 每项含 description、origin(member_input/agent_synthesis)、source_ids；member_input 必须能追溯到真实共享来源。每个候选至少有一个 discussion_source_id。首次生成 change_summary 可空，修订必须解释改动。

Agent 不合并不同候选、不删除其他候选、不修改人类态度。跨候选合并属于后续接口扩展。样例：[生成](interfaces/fixtures/idea-generate.json)、[修订](interfaces/fixtures/idea-revise.json)。指南见 [idea-agent.md](idea-agent.md)。

## 7. Evaluator 接口

`evaluator.evaluate` 输入：公共字段 + candidate + shared_sources + search_policy + provided_evidence。

- candidate 包含 candidate_ref 与完整 CandidateDraft。
- shared_sources 只含评估所需、且能解析候选引用的共享来源。
- search_policy 为 enabled / max_queries。enabled=false 或 max_queries=0 时不允许发起检索。
- provided_evidence 是 Workflow 已获取并核验来源的证据。实际搜索工具也须受运行预算限制。

返回 data：contract_version、evaluation。Evaluation 包含 candidate_ref、report_status、summary、findings、similar_projects、risks、unknowns、recommended_changes、evidence、search_log。所有数组字段必填，可空。

Finding：finding_key、dependency_key（非依赖问题可 null）、finding、conclusion、evidence_keys、next_check。dependency_key 必须来自当前候选。conclusion 为 verified / supported_by_source / team_claim / needs_test / unknown。

Evidence：evidence_key、url（成员陈述或本地测试记录可 null）、title、accessed_at、source_kind、claim、limitation、source_id（没有共享来源时 null）。kind 为 official_documentation / project_self_report / team_claim / test_record。

- verified 必须对应实际 test_record；supported_by_source 必须有实际文档或项目来源；team_claim 必须引用成员共享来源。不得生成虚构工具证据。
- sources 和 evidence_keys 必须可解析；不能给不知道的判断配一个不相关链接。
- 相似项目条目含 name、url、overlap、differences、maturity、evidence_keys。
- search_log 每项为 query / result_status(results、no_results、failed、disabled)。无结果和失败分开。
- status=ok 对应 report_status=complete；status=partial 对应 report_status=partial。complete 表示此次评估操作完成，不意味着技术全部验证或没有风险。
- 没有检索能力且资料不足时返回 partial，不能自行推进或否决候选。

样例：[partial](interfaces/fixtures/evaluator-partial.json)、[complete 结构](interfaces/fixtures/evaluator-complete.json)。所有样例证据均为明确标注的离线模拟，不能作为真实报告。指南见 [evaluator-agent.md](evaluator-agent.md)。

## 8. Human → Workflow 事件接口

这些事件不发给 Agent，也不允许 LLM 生成。完整五种输入见 [human-events.json](interfaces/fixtures/human-events.json) 和 schema 的 ClientEvent。

统一客户端字段：contract_version=2.0、event_id、room_id、expected_revision、type、payload。actor_member_id、received_at、approved_at 等由服务端从认证身份与时钟写入，不信任客户端自报。event_id 持久化去重；expected_revision 按事件目标校验。

| type | payload | Workflow 处理 |
| --- | --- | --- |
| interview.answer | session_ref、question_batch_ref、answers(question_key/text/declined) | 校验本人的当前题组，保存私人答案 |
| profile.approve | draft_ref、items(item_key/category/text/basis/confidence)、unknowns | 本人编辑批准，创建共享画像版本；私人消息引用不公开 |
| difference.answer | difference_ref、selected_option_key、text、disagrees_with_framing | 保存真实答案；binary 选项须有效，否认题意可选 null 并给文本 |
| convergence.vote | difference_ref、discussion_round≥4、decision(diverge/converge)、reason | 保存个人选择，交由独立人工决策汇总政策处理 |
| candidate.review | candidate_ref、evaluation_ref、decision(accept/minor_revision/more_discussion)、instructions | 保存真实审阅；小改/加一轮需要非空意见，再经汇总政策路由 |

这份契约**不默认多数票或房主独断**。个人 vote/review 入库不等于立即完成团队状态转移。Workflow 只有在团队配置的人工决策规则满足后才形成 ConvergenceDecision 或审阅结果，Agent 接口不用随投票政策变化。

profile.approve 只允许编辑已保存草稿条目，item_key 用于关联私人证据；新信息先提交私人回答并重新总结。服务端保存用户编辑的版本和授权依据，不将 AI 置信度当成批准证据。

事件响应约定：成功 `{event_id, status:"accepted", current_revision}`；重复提交返回原成功结果；拒绝为 `{event_id, status:"rejected", current_revision, error:{code,message}}`。code 使用 UNAUTHORIZED、STALE_INPUT、INVALID_EVENT、CONFLICT；这是 Workflow 接口，不是 Pi Agent 错误信封。相同 event_id 不同内容返回 CONFLICT。成功与失败应作为应用事件结果处理，HTTP 状态映射由实现决定。

## 9. Workflow 接线与提交检查

```text
interview.turn → Human 私人回答 → … → interview.summarize
→ 本人批准共享 → negotiate.detect → Human 回答
→ n≤3：interview.turn(mode=followup)
→ n≥4：Human converge/diverge
    diverge → interview.turn(mode=followup)
    converge → idea.generate → evaluator.evaluate → Human Review
        minor_revision → idea.revise → evaluator.evaluate → Human Review
        more_discussion → interview.turn(mode=reopened) → … → negotiate.detect → Human
        accept → 输出人工接受的当前版本
```

调用前：认证、权限投影、所需人工答案齐全、预算、输入 schema。调用后：完整响应 schema、五个信封字段、引用与数量、禁止的权威字段、证据来源，再在事务内检查相关 revision 后提交。

input_revision 代表本次任务的输入快照。Interview 同时记录该成员会话版本和用到的共享对象版本；无关成员私聊不应令任务过期，但被引用的共享资料变更必须失效。其他操作检查输入共享快照与候选/评估版本。具体存储可用独立 revision 和依赖列表，不要求把全房间所有变更挤进一个计数。

同 request_id 同输入返回已存结果；同 ID 不同输入拒绝。失败和重试不扣新一轮。过期结果不覆盖新答案；重新规划使用新 request_id。人未回答时保持等待，不通过重复 Agent 调用尝试猜答案。

Agent 业务 validator 必须校验数量、允许引用、回显对象和角色边界；Workflow 再校验一次。schema 检查结构，无法独自证明授权或来源真实性。

## 10. 现有 Pi Base 兼容方式

[base.mjs](pi-base/base.mjs) 已允许自定义 definition，并从请求复制信封。新角色请直接 default-export definition，暂不复用旧 roles.mjs 的业务提示词；其中没有 idea 角色，旧 negotiate prompt 还包含生成职责。

```js
// 示意结构，函数由角色负责人实现；不是已实现的业务模块。
export default {
  name: 'idea', // interview / negotiate / idea / evaluator
  systemPrompt: '本角色职责，以及仅使用获准共享输入的约束',
  operations: {
    'idea.generate': {
      validateInput: validateGenerateInput,
      validateOutput: validateGenerateData,
      outputInstructions: 'Return data conforming to IdeaGenerateData.',
    },
    'idea.revise': {
      validateInput: validateReviseInput,
      validateOutput: validateReviseData,
      outputInstructions: 'Return data conforming to IdeaReviseData.',
    },
  },
  createTools: () => [],
};
```

validateOutput 的签名是 `(data, payload) => boolean`；不是校验整个返回信封。模型生成的 status 与 data 的对应关系需在 runAgent 返回后由 Workflow 的完整 Response 校验器检查。definition.name 必须与 operation 点号前缀一致。

Node Workflow 可直接调用 runAgent；Python Workflow 可调用现有 python_bridge.call_agent 并配置 role_module。模块路径由服务端路由表确定，不接受用户给出的任意路径。CLI 默认 example-role.mjs 只支持旧示例，**不是 v2 Agent**。真实集成应设置 AGENT_MODULE。大候选回包需要负责人核对模型 token 预算，避免被 CLI 当前上限截断。

## 11. 本地联调方式与冻结范围

1. Workflow 负责人先按 operation 从 fixtures 读取 response，把原请求的五个信封字段正确匹配；模拟来源显式标注。
2. 每位 Agent 负责人用配对 request 开发，结果对照 Response 及该 operation 的 data 定义。
3. 在仓库根目录运行 `python agent/interfaces/validate_contracts.py`。需要 Python 的 jsonschema 包；当前开发环境已具备。
4. 也可运行 `python agent/interfaces/validate_contracts.py path/to/pair.json` 校验自己的 request/response 配对文件。此工具不调模型或网络。
5. 最后接真实调用，另验来源真实性、隐私、并发、人工状态门槛和模型质量。

字段/枚举/操作名改动需同时更新 contracts、schema、fixtures 和对应角色说明。新增展示信息先扩 schema，不随意塞进 data。

已冻结接口不替团队决定：多人汇总政策、精确轮次递增事务、每轮访谈对象、运行预算、候选选择与界面交互仍由 Workflow 配置或另行确认。Agent 接收显式参数，不能自行填补这些规则。
