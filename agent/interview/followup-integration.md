# Interview 新追访接口：分歧决策与评估后追加访谈

实现基于 [master 工作流 644c750](https://github.com/sgtlyz/MHacks-Conclave/blob/644c75007793c89716abfbdb11927a567e6c53fe/workflow_updated.md) 及该版本 `agent/contracts.md` / `agent/interfaces/protocol.schema.json`。该流程替代旧设计中的固定 3–5 轮结束规则。

**已实现：Interview 无状态调用、输入/输出与引用校验、提示词和离线 JSONL 接线。未实现：团队状态机、认证、数据库、人类事件汇总政策。** 本文不表示整个团队 Workflow 已完成。持续详细 Profile、time=0 初始化、NegotiationBrief 和按成员查询仍是独立待办，没有随此次追访改动完成。

## 入口与兼容

- 新团队入口：`service.mjs` 的 `runInterview({request, runtime})`；`definition.mjs` 为新角色定义。只有 `interview.turn` 和 `interview.summarize` 两个 operation。
- 外层 `schema_version` 仍是 `1.0`，业务版本在 `payload.contract_version`；返回 data 回显业务版本。
- 支持 master v2.0 的 initial、前三轮 difference_answers 追访和相应总结。
- 新的人工结论及完整评估上下文使用 **Interview 扩展 v2.1**。它是本分支新增的明确版本，不声称 master 上的 2.0 schema 已接受这些字段。
- v2.0 的 reopened 只有 review 引用，没有完整 candidate/evaluation；human_diverge 也没有类型明确的人工决定。因此这两条路径要求升级为 2.1，否则返回 INVALID_INPUT，不能从几个 ID 猜出内容。
- 原本的 CLI、本地 `InterviewWorkflow` 与 live smoke 保留旧行为，显式调用 `runLegacyInterview` / `legacy-definition.mjs`；它们不是新团队循环。旧 payload 不会被 `runInterview` 静默接收。
- JSONL `worker.mjs` 默认新接口；旧调用必须显式带 `--legacy`。`--live` 仍需本地 DeepSeek 配置；不带时仅固定模拟回答。

安装使用 `pnpm --dir agent/interview setup`，同时安装本模块的固定 Ajv / ajv-formats 校验依赖和 Pi 基座依赖。没有增加 MCP、plugin 或模型可调用工具。

## 公共输入

沿用 v2：`contract_version / discussion_round / room_context / member_id / mode / messages / current_profile / shared_context / followup_context`。

turn 另有 `interview_turn` 和 `limits: {max_questions, remaining_question_batches}`；summarize 另有 `stop_reason`。原始消息带 message_id，且只属于当前成员。之前问过的问题放在该成员的 messages 中，跨轮画像与共享历史由 Workflow 显式传入。

这不是对用户全部资料的重新压缩：模型只处理此次授权输入。Profile 草稿沿用 v2 的 items/category/evidence 格式，不擅自改变 master 分类，也不输出新的共享批准。

## 路径 A：Negotiate → 人类回答/结论 → Interview

`mode="followup"`，`followup_context` 的 v2.1 字段全部必填，可空对象用 null：

| 字段 | 内容 |
| --- | --- |
| trigger | 前三轮用 `difference_answers`；人工选择继续讨论用 `human_diverge` |
| difference | `difference_ref / discussion_round / content`，content 保留 Negotiate 的问题、选项和依据 |
| answers | 成员真实回答；每条带 answer_ref、member_id、difference_ref、选项、解释和是否否认题意 |
| decision_result | `decision_ref / discussion_round / decision / conclusion / source_ids` |
| review / candidate / evaluation | 均为 null |

`decision_result.decision` 为 `continue_interview` 或 `diverge`。前三轮的 continue_interview 是 Workflow 在收到所需人工回答后的路由结果；conclusion 忠实保留人类回答，不代表达成一致，也不要求人为补造一个额外的投票事件。第 4 轮起的 diverge 必须关联实际人工收敛选择的来源。

`conclusion` 可以是“成员对自动执行仍意见不同，继续澄清边界”，不能把相反答案合成为“大家同意自动执行”。保留 answers，是为了让 Interview 能区别每个人的选择与总的处理结论。

校验会拒绝空 answers、重复成员、错分歧版本、无效选项、缺失结论、无效来源，以及用 converge 触发追访。它不推测本轮必答者集合；完整性、身份与决策汇总权限由 Workflow 根据真实事件校验。

完整配对样例：[difference-followup-v2.1.json](examples/difference-followup-v2.1.json)。

## 路径 B：Evaluator → 人类加一轮 → Interview

`mode="reopened"`、`trigger="review_more_discussion"`。

| 字段 | 内容 |
| --- | --- |
| review | review_ref、candidate_ref、evaluation_ref、member_id、decision=`more_discussion`、instructions |
| candidate | master 的 Candidate：candidate_ref + 完整 content；不能只传题目或 ID |
| evaluation | evaluation_ref、完整报告 content、feasibility |
| difference / answers | 没有新的分歧问题时用 null / []；若保留有关联的旧分歧则成对提供 |
| decision_result | null，触发本次追访的人工结论在 review 中 |

`evaluation.content` 保留 master Evaluation 的 summary、findings、risks、unknowns、recommended_changes、evidence、report_status 等字段。

`evaluation.feasibility` 为 `{verdict, rationale}`，verdict 为 `feasible / infeasible / conditional / unknown`。这是对收到的评估判断的显式传递，不是让 Interview 再评估一次。当前 master Evaluator 没有这个总判断字段：Workflow 只能映射报告中明确已有的判断；没有明确判断时填 unknown，并解释缺失，不能从 complete 或 partial 猜测可行性。

同时检查：

```text
review.candidate_ref == candidate.candidate_ref == evaluation.content.candidate_ref
review.evaluation_ref == evaluation.evaluation_ref
review.decision == more_discussion
```

比较均包括 ID 和 version。报告缺失、候选版本不同、人工意见为空，或人选的是 accept / minor_revision，均拒绝进入此访谈入口。

Interview 依据意见和评估追问可接受的范围或条件。例如“实时语音依赖未验证，人希望加一轮”可以追问“先做文字 demo 时最需要保留什么体验”。不能直接写入“这个成员不喜欢实时语音”。可行不等于成员喜欢，不可行不等于成员放弃；unknown 也不等于不可行。

完整配对样例：[evaluation-reopened-v2.1.json](examples/evaluation-reopened-v2.1.json)。样例及其中证据均为 OFFLINE MOCK。

## Workflow 必须完成的检查

1. 从已认证用户事件加载实际 answers、review、convergence 记录，而不是相信客户端自由拼出的 JSON。
2. 检查本轮所需回答是否齐全、多人汇总政策是否满足、当前对象版本和授权是否仍有效。
3. 只投影获准共享的资料；本人私聊单独加载。消息 ID 存在不能证明它真的属于本人，身份与存储归属仍由 Workflow 保证。
4. 调用 `runInterview`，完成后先检查 status；error 不推进状态。ready_to_summarize 不等于团队 converge。
5. 保存题组并等待本人回答；总结草稿再次经本人确认才更新共享 Profile。
6. 追加访谈后回到 Profile → Negotiate → Human 的讨论循环，不能直接进入候选生成。

Agent 校验能发现缺失和不一致，不能仅凭输入对象证明人的真实意愿，也不能识别数据库里未传入的更新。提交前必须再次检查依赖版本。

无团队硬轮数上限由 Interview 决定；`limits` 只控制当前私人会话题量。第 4 轮及之后是否继续来自人类。旧 `workflow.mjs` 的 7 批/1 批限制只属于旧本地演示。

## 机器契约与验证

- `contracts/protocol-v2.0.schema.json`：从上述 master 提交原样保存的基准快照，不手改它来伪装上游兼容。
- `contracts/schema.mjs`：导出 `upstream` 与 `extended`；后者是 v2.1 的完整 schema 对象，可序列化给接线方。结构校验用 Ajv，跨对象关联校验在 `definition.mjs`。
- `service.mjs` 还检查模型 status 与 data 对应关系。若团队直接使用 Pi Base + definition，必须自行完成同样的完整返回校验。
- 旧 live smoke 仍只测试旧接口；本次新接口没有调用 DeepSeek。离线测试证明数据传递、拒绝条件和 Pi 路径，不能证明真实提问的深度或总结忠实度。

运行 `pnpm --dir agent/interview test` 验证新旧路径，`pnpm --dir agent/interview demo` 验证原本可交互流程的底层演示。
