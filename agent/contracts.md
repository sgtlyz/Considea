# Agent 的共享输入输出契约

最新产品流程、四个 Agent 职责和状态机以 [workflow_updated.md](../workflow_updated.md) 为准。本文保留旧版 Interview/Negotiate 对象供迁移；它们不能覆盖最新版规划。Evaluator 当前接线见 [实现 README](evaluator/README.md)，已支持新版 IdeaCandidate/Room 和 Evaluation 1.2。统一调用 envelope 保持 1.0。

## 1. 统一调用与返回

每次调用由 workflow 生成请求，不让 Agent 自己读取整个数据库。

```json
{
  "schema_version": "1.0",
  "request_id": "req-001",
  "room_id": "room-001",
  "operation": "negotiate.plan",
  "input_revision": 12,
  "payload": {}
}
```

`request_id` 标识一次逻辑任务，重试不产生第二份业务结果。`input_revision` 是相关输入快照的版本标识；回包过期时重新验证或丢弃，不覆盖较新的用户输入。Interview 的版本按成员会话核对，其他角色按房间共享快照核对，避免四人并发回答相互误判过期。

```json
{
  "schema_version": "1.0",
  "request_id": "req-001",
  "room_id": "room-001",
  "operation": "negotiate.plan",
  "input_revision": 12,
  "status": "ok",
  "data": {},
  "warnings": [],
  "error": null
}
```

| 字段 | 约束 |
| --- | --- |
| `status` | `ok`、`needs_input`、`partial`、`error` |
| `data` | operation 对应的结构化结果；不得夹带隐藏的其他成员原始访谈 |
| `warnings` | 未知项、证据缺口、部分失败的短说明 |
| `error` | 失败时为 `{code, message, retryable}`；其他情况为 null |

错误码建议：`INVALID_INPUT`、`MODEL_TIMEOUT`、`INVALID_OUTPUT`、`TOOL_UNAVAILABLE`。Schema 修复最多一次，不进行无上限重试。workflow 负责超时和重试策略。

## 2. 核心对象

### Evaluator 当前输入：IdeaCandidate 与 Room

IdeaCandidate 使用 `candidate_id/version/title/target_user/problem/solution/discussion_trace[]/tradeoffs[]/mvp/member_suggestions[]/status`。讨论轨迹与成员建议传获准共享的 string[] 摘要，不传原始访谈；`mvp` 支持 string 或 string[]。可选 critical_dependencies；未提供时必须识别必要依赖再核实，不能当作没有技术条件。版本与成员确认仍由 workflow 控制。

Room 的评估快照使用 `room_id/members[]/hackathon_context/constraints[]/discussion_round_limit/idea_candidate_limit/status`；members 为成员 ID，hackathon_context 为共享文字摘要，constraints 可用 string[]。旧 member_ids 与旧结构化约束仍可输入。Evaluator 不要求旧访谈轮数或候选迭代字段。

新增 `time_limit` 表示用户回答的项目交付约束：`{kind:"none"}`、`{kind:"duration",hours:正数}` 或 `{kind:"deadline",deadline_at:带时区ISO时间}`。未回答时省略，evaluator.evaluate 返回 needs_input 和 data.questions；workflow 询问用户、更新快照后再调用，不把开发用的时间窗口当作每个 idea 的限制。tool_budget 的执行毫秒数独立于项目时间。

以下 RoomConfig 和 Candidate 字段表是旧格式兼容说明。

### RoomConfig：共同上下文

| 字段 | 类型 / 含义 |
| --- | --- |
| `room_id` | string |
| `member_ids` | string[]，首个场景四人 |
| `deadline_at` | 带时区的 ISO 8601 string 或 null |
| `max_iterations` | 正整数，用户填写 n；总候选轮数，含首次展示 |
| `initial_interview_max_rounds` | integer，首版 7 |
| `max_questions_per_turn` | integer，首版 3 |
| `followup_batches_per_member_per_iteration` | integer，建议首版 1 |
| `constraints` | `{id, text, source_kind, source_id, verification_status, acceptance}`[] |

约束的 `verification_status` 为 `documented`、`member_reported`、`unverified`；`acceptance` 为 `team_confirmed`、`proposed`、`disputed`。个人偏好放在 SharedProfile，不自动升级为共同硬约束。赛道要求需要来源，不可凭模型记忆猜测。

### PrivateInterview：只提供给对应成员的 Interview Agent

`member_id`、`session_revision`、`mode`（`initial` / `followup`）、`round_index`、`messages`、`draft_profile`、可选的 `followup_task`。

`messages` 是当前成员的原始对话。数据库存储与路由需按房间/成员隔离；不能在一条模型上下文中混入其他成员的原始回答。

### InterviewTurnResult

`member_id`、`mode`、`round_index`、`questions`（最多 3 项，每项 `{question_id, text, purpose}`）、`coverage`（各主题 `known` / `unknown` / `declined`）、`ready_to_summarize`（bool）、`stop_reason`（null / `enough_information` / `round_limit` / `member_requested`）。

`purpose` 用于解释为什么问，不是模型内部思考。ready 不表示已共享；共享必须经过本人确认。

### SharedProfile：获准进入整合流程的个人摘要

```json
{
  "profile_id": "profile-a",
  "member_id": "member-a",
  "version": 1,
  "items": [
    {
      "item_id": "a-pain-1",
      "category": "pain",
      "text": "经常不知道朋友现在有没有空一起吃饭",
      "basis": "member_statement"
    },
    {
      "item_id": "a-pref-1",
      "category": "preference",
      "text": "希望产品有趣并贴近日常生活",
      "basis": "member_statement"
    }
  ],
  "unknowns": ["后端开发经验"],
  "approved_at": "2026-10-03T15:00:00-04:00"
}
```

`category`：`pain`、`idea`、`skill`、`resource`、`preference`、`objection`、`participation_condition`。`basis`：`member_statement` 或 `agent_inference`，推断也需本人确认才可共享。`approved_at` 必须由用户确认事件写入，LLM 不得生成。

Interview 输出的是相同内容结构的草稿，省略 `approved_at`；由 workflow 分配/校验 ID 和版本，保存本人编辑后的内容。后续追访形成新版本，旧版保留用于来源追溯。

### TeamCriteria：候选比较标准

`version`、`criteria`（`{id, text, member_source_refs, acceptance}`[]）、`unresolved_tradeoffs`（string[]）。标准由 Negotiate 提议；`acceptance` 必须来自团队 UI 的确认记录。首版可不设置数值权重，直接展示逐项匹配和取舍。

### Candidate：候选方案与来源

| 字段 | 含义 |
| --- | --- |
| `candidate_id` / `version` / `iteration_index` | 方案身份、版本、所属候选轮次 |
| `title` / `target_users` / `problem` | 名称、用户、问题 |
| `core_flow` | string[]，具体用户步骤 |
| `mvp_scope` / `out_of_scope` | string[]，最小 demo 与以后再做的部分 |
| `critical_dependencies` | `{dependency_id, description, must_have}`[]，供 Evaluator 检查 |
| `contributions` | `{description, source_refs, origin}`[] |
| `tradeoffs` / `unknowns` | string[] |
| `change_summary` | 相对上个版本的变化；首版可空 |

`origin`：`member_input` / `agent_synthesis`。`source_refs` 格式为 `{profile_id, profile_version, item_id}`，只允许已批准版本和条目。无法归因的创意标为 `agent_synthesis`，不得伪造出处。相同方向修改保持 candidate_id 并递增 version；新的方向分配新 ID。

### Evidence 与 EvaluationReport

Evidence 必须是实际获取的来源记录：`evidence_id`、`url`（成员自述可 null）、`title`、`accessed_at`、`source_kind`、`claim`、`limitation`。

`source_kind`：`official_documentation`、`public_web`、`member_report`；旧报告的 `project_self_report` 仍可读取。普通公开页面统一为 `public_web`，不能自动视为项目方声明。官方文档支持某能力也不等于团队已经测试成功；项目列表或第三方文章不证明项目已经实现某能力。

EvaluationReport 1.2：`report_schema_version`（`1.2`）、`report_id`、`candidate_id`、`version`、`feasibility[]`、`similar_projects[]`、`technical_checks[]`、`risks[]`、`unknowns[]`、`sources[]`、`status`（`complete` / `partial`）、`passed`（bool）、`tests`、`recommended_changes`、`search_log`。保留 candidate_version、competitors、unverified_assumptions、evidence 供旧展示代码迁移；报告版本递增，外层 envelope 仍为 schema_version=1.0。

结论等级对齐最新规划：实际测试为 verified（当前检索模式不产生）、公开来源支持为 supported_by_source、授权成员自述为 team_claim、待实测为 needs_test、证据不足为 unknown。sources/feasibility/similar_projects 附 conclusion；technical_checks.conclusion 采用这些新等级，outcome 区分 support/blocker/unknown，next_check_status=needs_test。旧 documented_support 等枚举仅在 Pi 内部模型草稿中使用，不再作为公开报告枚举。

- `tests`：`{novelty, feasibility}`，每项 `{result, reason, evidence_ids, required_changes, missing_information}`；result 为 `pass` / `fail` / `insufficient_evidence`。两项都 pass 时 passed=true，否则 false。证据不足表示尚未核实，不能称已证明不可行。
- 查重失败标准：已有项目的目标用户、核心问题、核心方案高度相同，并且 idea 没有明确差异。仅有同类产品仍可通过。
- 可行性评估最小 demo 的核心实现路径、关键依赖访问条件、团队资源、时间与预算；首版不运行项目原型。Evaluator 的通过判定不是团队共识或成员批准。
- `evaluator.evaluate` 支持 payload.idea 或 payload.candidate，恰好一个。idea 是细化想法，规范化到 Candidate；基础字段及默认元数据见 [实现接口](evaluator/README.md)。其他共享上下文不变。
- `tool_budget`：`{max_searches,max_reads,timeout_ms,per_call_timeout_ms}`，可省略或部分覆盖；默认 2/3/60000/10000，每请求独立。`shared_resources` 是已获准共享的 `{profile_id,profile_version,item_id,member_id,category,text}`[]，category 为 skill/resource。

- competitor：`{name, url, overlap, differences, maturity, evidence_ids}`；maturity 为 `self_reported_implemented` / `planned` / `unknown`。
- technical_check：`{dependency_id, finding, conclusion, outcome, evidence_ids, next_check, next_check_status}`；公开 conclusion 为 `supported_by_source` / `team_claim` / `unknown`，next_check_status 为 needs_test。
- search_log：`{query, result_status}`；result_status 为 `results` / `no_results` / `failed`。失败和无结果不可混为一谈。
- Evaluator 查重最低要求是分别检索 GitHub 仓库与 Devpost hackathon 项目；前两次搜索优先覆盖这两个范围，不增加原预算。`search_log` 新增运行层字段 `scope`（github/devpost/web）、`executed`、`result_count`、`excluded_count`、`result_urls`，query 是实际传给 Tavily 的查询。`novelty_coverage` 为 `{required_scopes:["github","devpost"],complete,scopes:[{scope,status,attempts,result_count}]}`；status 为 results/no_results/failed/not_searched。缺少成功平台覆盖时不得查重 pass，报告为 partial；有证据的重复 fail 保留。旧报告兼容为历史上下文，不计入当前覆盖。investigate 不需要查重覆盖。
- 代码生成的 Evidence 可附带实际正文 excerpt 和成员来源 source_ref；模型不能生成或修改这些身份字段。失败的 search_log 可以附 error_code。
- 首版不输出“全网重复率”“全球首创”“成功概率”，也不使用未经校准的综合分数代替证据。

### MemberFeedback：成员对当前候选版本的实际态度

`member_id`、`candidate_id`、`candidate_version`、`stance`、`shared_reason`、`conditions`、`submitted_at`。

`stance`：`support`、`conditional`、`oppose`、`undecided`。没有记录就是 missing，不自动补成 support。反馈由成员 UI 写入；Agent 不得替成员改变 stance。`shared_reason` 可以为空，反对仍然有效；若要私下说明，原文交给 Interview，不送入公共共享快照。

### NegotiationPlan：给 workflow 的下一步提案

`open_issues`（`{issue_id, candidate_id, candidate_version, involved_member_ids, description, category, source_refs}`[]）、`actions`、`recommendation`。

issue category：`interest`、`role_fit`、`technical`、`novelty`、`track_fit`、`scope`、`unknown`；分类是待确认的工作假设，不是对成员心理的诊断。

每个 action：`{action_id, type, member_id, issue_id, candidate_id, candidate_version, goal, depends_on, expected_information, requires_team_confirmation}`。

type 只允许：`interview_followup`、`evaluate_question`、`propose_revision`、`request_feedback`、`propose_direction_change`、`report_unresolved`。member_id 非定向成员动作时为 null。depends_on 为其他 action_id[]，禁止循环依赖。

```json
{
  "open_issues": [
    {
      "issue_id": "issue-1",
      "candidate_id": "candidate-1",
      "candidate_version": 1,
      "involved_member_ids": ["member-a", "member-b"],
      "description": "对实时语音的可行性存在分歧",
      "category": "technical",
      "source_refs": []
    }
  ],
  "actions": [
    {
      "action_id": "action-1",
      "type": "interview_followup",
      "member_id": "member-b",
      "issue_id": "issue-1",
      "candidate_id": "candidate-1",
      "candidate_version": 1,
      "goal": "核实成员提到的现成接口和已完成的测试",
      "depends_on": [],
      "expected_information": ["接口名称", "已有测试的范围"],
      "requires_team_confirmation": false
    },
    {
      "action_id": "action-2",
      "type": "interview_followup",
      "member_id": "member-a",
      "issue_id": "issue-1",
      "candidate_id": "candidate-1",
      "candidate_version": 1,
      "goal": "基于获准共享的新信息，确认哪些延迟或范围可接受",
      "depends_on": ["action-1"],
      "expected_information": ["可接受的修改条件"],
      "requires_team_confirmation": false
    }
  ],
  "recommendation": null
}
```

依赖 interview_followup 的动作必须等回答与共享批准完成，不是模型回包后立即执行。未批准内容不得带入下一动作。

### Recommendation

`candidate_id`、`candidate_version`、`reasons`、`tradeoffs`、`unresolved_issue_ids`、`suggested_next_step`、`decision_status`。decision_status 固定为 `recommendation_only`；workflow 单独生成 `consensus` / `unresolved` / `ended_by_team` 状态，不能接受 LLM 自称“全员同意”。

## 3. 数据权限

| 数据 | Interview | Negotiate | Evaluator | 公共工作台 |
| --- | --- | --- | --- | --- |
| 某成员原始对话 | 仅本人对应会话 | 无 | 无 | 无 |
| 摘要草稿 | 仅本人对应会话 | 无 | 无 | 无 |
| 本人确认的共享摘要 | 追访需要时按允许范围提供 | 有 | 仅评估必需部分 | 有 |
| 候选与共享反馈 | 当前追访所需部分 | 有 | 当前评估所需部分 | 有 |
| 外部来源与评估结果 | 当前追访所需部分 | 有 | 有 | 有 |

不跨成员复用访谈会话。共享摘要撤回/更新后，新任务只使用仍获批准的数据；已有结果的历史可追溯，但不能悄悄把撤回内容继续作为新候选依据。复杂历史清理可后续实现，首版至少阻断新的传播并提示结果需刷新。

## 4. 公共进度事件

`{event_id, room_id, task_id, agent, phase, message, visibility, member_id}`，其中 agent 为 `interview` / `negotiate` / `evaluator` / `workflow`，visibility 为 `private` / `shared`。

私人访谈的 message 和题目只给对应成员；公共仅展示“等待某成员完成访谈”等状态。公开原因、候选来源、检索结果都必须来自共享快照或外部证据。首版用轮询读取状态也可以，不强制 SSE。
