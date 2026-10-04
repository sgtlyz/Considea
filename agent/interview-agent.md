# Interview Agent：并行开发交付说明

负责人实现 `interview.turn` 和 `interview.summarize`。交付模块约定为 `agent/interview/definition.mjs`，default-export 的 name 为 `interview`。模块已交付并接入整合分支，运行入口为 service.mjs/runInterview。

输入/输出精确定义以 [contracts.md](contracts.md) 第 4 节和 [schema](interfaces/protocol.schema.json) 的 InterviewTurnInput/Data、InterviewSummarizeInput/Data 为准。

## 每次调用做什么

- turn 接收当前成员 messages、current_profile、shared_context、followup_context、interview_turn 和 limits；生成下一组 1–3 问，或说明可以总结。
- summarize 接收同一授权上下文和 stop_reason；输出 profile_draft，不输出批准。
- initial 的 followup_context=null；followup 必须包含上一 difference 和真实 answers；reopened 还带加一轮 review。
- ready=false 时 status=needs_input；ready=true 时 status=ok 且没有问题。剩余题组预算为 0 时必须停止。
- 根据人工回答追问原因、改变条件和取舍，不把此前已经问过的问题重新当初访。
- 不保存全局会话、不访问其他人的私人消息、不生成团队候选、不判断 converge、不替成员回答。

题目 question_key、草稿 item_key 在本次回包内唯一。private_message_ids 只引用输入中的本人消息。共享画像的 ID、版本、批准与私人引用剥离由 Workflow 处理。

## 可立即使用的样例

- [初访问题](interfaces/fixtures/interview-turn.json)
- [预算停止](interfaces/fixtures/interview-ready.json)
- [根据人工答案追访](interfaces/fixtures/interview-followup.json)
- [画像总结](interfaces/fixtures/interview-summary.json)

这些是离线假数据。Workflow 可先据此展示题目和草稿，你独立替换模型输出。

验收：输入错成员/未知引用应拒绝；不得超出 max_questions；没有剩余题组不得继续问；输出没有 approved_at；回访实际引用人工回答。Pi 中的模型 turn、个人 interview_turn、团队 discussion_round 分开。

原 example-role.mjs 仅为旧初访示例，不能直接当 v2 实现。按 contracts 第 10 节直接导出新 definition，避免继承旧“7 轮”提示词。

Implementation: [Interview](interview/README.md). Human-diverge and post-review follow-ups use the explicit [v2.1 extension](interview/followup-integration.md); the older standalone CLI contract is not the team workflow contract.
