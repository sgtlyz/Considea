# Interview 与新版 Workflow 的对齐设计

审阅日期：2026-10-03。对照 [workflow_updated.md，固定版本 f19a24c](https://github.com/sgtlyz/MHacks-Conclave/blob/f19a24c7f998192e37c567e2a1fd9b35d1d8eaca/workflow_updated.md)，以及本分支 `ec817e4` 的 Interview 实现。

**状态：接口设计与差距审查，尚未实现以下 v2 契约。** 现有 `interview.turn` / `interview.summarize`、CLI、worker 仍使用原接口。本文不能作为“已接通新版团队流程”的证明。

## 1. 结论与术语

新版 `PreferenceProfile` 就是此前讨论的 `full_profile`：成员本人审核过的完整结构化偏好，不是完整聊天记录。不再维护两个同义对象。

保留三个不同用途的数据层：

| 数据 | 用途 | 谁可以读取 |
| --- | --- | --- |
| 私人访谈 + PreferenceProfile 草稿 | 原始回答、推断、证据和待审核总结 | 本人及处理这次私人访谈的 Interview |
| 已批准 PreferenceProfile | 当前有效的完整偏好；保留版本供讨论溯源 | 授权团队流程与 Agent |
| NegotiationBrief | 默认传给 Negotiator 的短摘要，引用完整 Profile | 授权团队流程与 Agent |

Brief 是 Profile 的派生视图，不是另一份独立事实。Profile 更新后，旧 Brief 不能继续作为当前输入。

新版的关键变化是先讨论分歧、记录真实人的选择、继续深挖，之后才生成候选。Interview 不能仅把旧 `profile` 重命名后接入；必须补齐决策上下文、历史和证据。

## 2. 当前实现与所需改动

| 方面 | 当前代码 | 对齐所需改动 | 主要负责人 |
| --- | --- | --- | --- |
| Profile 维度 | `definition.mjs` 只有 pain / idea / skill / resource / preference / objection / participation_condition | 显式表达新版八个维度，避免目标用户、目标、取舍全挤进 preference | Interview |
| 证据 | item 只有 ID、category、text、basis；消息没有 answer ID | 每条总结绑定当前成员的回答来源；区分引用、推断和用户修改 | Interview + Workflow |
| 短摘要 | `getShared()` 返回整个已批准 Profile | 新增有大小限制、可追溯、随版本失效的 Brief | Interview + Workflow |
| 追访输入 | goal / expected_information / issue_id；无结构化 Divergence 和 Decision | 带入当前分歧、已记录的人工回答、上轮 Profile、历史题目和未解释原因 | Workflow 提供，Interview 消费 |
| 人工门槛 | 本地 harness 创建 followup 不检查实际决策是否齐全 | 相关成员未提交真实 Decision 时禁止进入追访；不能只信 `decision_complete: true` | Workflow |
| 轮数 | 初访最多 7 批回答，追访最多 1 批 | 保留单次会话批数，另增全局 discussion round，禁止混用 | Workflow |
| 历史与变化 | 新 session 清空题目历史；approve 为所有条目重新生成 ID；不持久化版本 | 传递本人历轮题目，稳定 item ID，存储版本和可计算的增删改 | Workflow + Interview |
| 深挖策略 | 按追访任务问问题，没有明确深度或避免重复的上下文 | 根据已解释内容继续问原因、改变判断的条件、可接受取舍 | Interview |
| 共享批准 | 有草稿编辑/删除和批准，本地无身份认证 | 保留；团队服务补身份验证、数据库和批准事件 | Workflow |

当前可复用：Pi harness、DeepSeek 适配、私人提问与总结两种 operation、摘要批准流程、会话内版本检查和轮数限制。无需为本次对齐增加 MCP、运行时 plugin 或第四个“摘要 Agent”。

## 3. PreferenceProfile v2 建议契约

以下是待实现的业务契约，不是对现有 JSON 的兼容声明。建议给角色 payload 增加明确的契约版本；不要只升级外层 envelope 后继续使用旧校验器。

沿用 `items` 列表便于稳定引用，每条有一个主维度；界面按维度分组：

```text
dimension = problems | target_users | interests | skills |
            desired_experience | constraints | tradeoffs | goals

PreferenceProfileDraft
  member_id
  base_profile_version: integer | null
  items[]
    item_id: existing ID | temporary new ID
    dimension
    text
    brief_text
    basis: member_statement | agent_inference | member_edit
    confidence: low | medium | high | null
    evidence_refs[]
    constraint_kind: objection | participation_condition | hard_constraint | null
  unknowns[]: {dimension, text}
```

- `skills` 包含当前能力、领域经验和资源；想学某技术属于 interests，不自动变成已有能力。
- 已有 idea 的名字和想保留的部分仍可记录在 interests、problems 或 desired_experience，不因新版没有 `idea` 字段而丢掉。
- `constraints` 保留主观反对与参与条件；不需要“客观合理”才能记录。`hard_constraint` 必须有成员明确表达，不能把一般兴趣升级为硬约束。
- `tradeoffs` 只记录实际表达的可妥协部分；没问过不等于愿意妥协。
- `confidence` 是模型对自己归纳的主观判断，不是支持概率、事实核验结果或成员批准。未知可为 null，不制造小数精度。
- `evidence_refs` 指向本人实际回答的 ID；模型不得引用其他成员私聊。程序检查 ID 存在、属于此人且已被本次输入授权。引用存在不证明归纳忠实，仍需成员审核。
- `member_edit` 由真实编辑事件产生，模型不得自行设置。用户修改后的条目可以引用该编辑事件，不能继续声称它是旧回答的原话。
- `brief_text` 与完整 `text` 一起给本人审核。这样共享后可直接选择批准过的短句，不必让另一次模型总结引入新含义。

批准后由 Workflow 写入 `profile_id / version / approved_at`；保留未变条目的 ID。新条目由程序分配 ID，修改保留 ID 并记录版本；删除产生历史事件。用户拒绝的推断不能进入新共享版本。

完整回答证据保存在私人层。共享层使用批准后的 Profile 条目作为证据；向团队发送原始引文需要另外明确批准。不能通过 evidence 字段绕过私人内容边界。

## 4. NegotiationBrief：按新版分歧任务设计

此前建议的 motivation / capabilities / resources 等六栏不足以直接服务新版：Negotiator 最需要比较的目标用户、问题、体验和取舍可能被隐藏。因此 Brief 使用与 Profile 一致的八个 dimension，而不是再创造一套同义分类。

```text
NegotiationBrief
  profile_id
  profile_version
  member_id
  items[]: {dimension, text, source_item_ids[]}
  omitted_item_ids[]
  unknown_dimensions[]
  status: ready | needs_review
```

建议首版预算：**最多 8 条，每个维度最多 2 条，每条最多 80 个 Unicode 字符**。这是内容预算，不是 token 数；四个人默认最多 32 条短句。未知维度可以为空，不能为了填满表格编造信息。

生成规则：

1. 模型在私人草稿阶段建议选择哪些条目；用户确认短句和完整条目。
2. 批准后程序从这些条目的 `brief_text` 构建 Brief，校验数量、长度、来源 ID、成员和 Profile 版本。Brief 本身不引入未批准的新措辞。
3. 本人当前有效的反对、硬约束和参与条件优先保留。若它们无法装入预算，返回 `needs_review`，不要静默删掉反对或截断条件。
4. 有内容但未选入 Brief 的条目登记在 `omitted_item_ids`；它们不是 unknown。已知但省略与从未表达必须区分。
5. Negotiator 应先补读遗漏的约束，以及判断关键分歧所涉及维度的完整批准条目，再下判断。Brief 是检索入口，不能把“摘要没提到”解释成“这个人没有意见”。
6. 按 `profile_id + version + item_id` 读取详情，可由 Workflow 普通接口提供，不必引入 MCP。任何 Profile 变化都重新构建 Brief；旧引用只能用于明确标注的历史讨论。

如果纯程序排序没有足够依据判断“哪些重要”，不要用前 8 条代替语义选择。由 Interview 提议、成员审核，并用来源与预算校验兜底。

## 5. 如何限制模型输出

需要三层同时做：

| 层 | 约束 |
| --- | --- |
| Prompt | 一条一个偏好，合并重复，不复述整段聊天；先保留反对和条件；不填未知；每条有证据；明确数量与长度 |
| 结构化校验 | 严格字段白名单、枚举、数量、字符长度、引用归属、重复 ID、基础版本；拒绝额外字段和越权状态 |
| Workflow | 输出未通过不更新草稿或共享状态；批准后才构建共享视图；版本变化后拒绝过期 Brief |

建议完整 Profile 草稿最多 24 条、每条 text 最多 160 字符、brief_text 最多 80 字符，unknowns 最多 8 条、每条最多 80 字符。字符按 Unicode code point 计数，不能用字节数代替。

这些是待实现的工程预算，不是新版 workflow 已规定的值。超限时保留现有草稿与所有原始回答，返回可理解的校验错误；不要 `.slice()` 截断后假装成功。可在明确调用预算内修复一次；仍失败则请求成员编辑或补充，不无限重试。

现有 DeepSeek JSON mode 只负责 JSON 形式，现有 2048 输出 token 上限也不能保证信息保真或各字段长度。上述最大合法对象可能超过该 token 预算，实施时需用最坏情况样例验证适配器预算，并保留截断失败处理；不能声称“设置 max_tokens 就能控制摘要质量”。

程序能检查旧 Profile 中受保护条目是否被无故遗漏，不能保证识别原始自然语言中所有未被抽取的反对。本人审核仍是防止语义遗漏的重要步骤。

## 6. 新版追访输入与执行门槛

建议在 followup 增加类型明确的上下文：

```text
discussion_context
  discussion_round_index
  discussion_round_limit
  input_profile_versions
  divergence: {divergence_id, type, question, affected_members, evidence_refs}
  decisions[]: {decision_id, divergence_id, member_id, answer, timestamp}
  previous_questions[]: {question_id, text, discussion_round_index}
  unresolved_reasons[]

另带：本人的当前 approved_profile、本轮私人回答、授权共享的讨论历史。
```

`previous_questions` 包括此成员历轮题目；不能把别人的私人追问题目打包进公共讨论。Decision 内容按房间批准的共享范围传递，不附带未经批准的解释。

Workflow 在调用前检查：

1. divergence 属于当前房间和轮次，输入 Profile 版本仍有效。
2. 由成员身份认证的真实事件已为每个必答成员记录 Decision；按成员去重。`affected_members` 只是 Agent 提议，必答集合由 Workflow 的房间规则确定。
3. Decision 引用正确的 divergence；同题修改以后，下游旧任务失效。
4. 未回复、缺席、超时不能合成 Decision。齐全只是允许追访，不代表选择一致。
5. 传给 Interview 的上下文符合当前成员权限，且讨论轮数未耗尽。

Interview 检查输入结构和引用，然后根据已知回答选择下一步：解释原因 → 询问改变判断的条件 → 在明确约束下讨论可接受取舍。这个顺序不是机械问卷；原因已明确就跳过，用户不愿解释也不能强迫。

追问题目建议增加 `focus` 与来源引用，引用实际的 decision / approved item / 本人历史 question。模型只提出问题，不写入成员选择、批准、轮次或团队收敛状态。

## 7. 两种轮数与历史

- `interview_batch_index`：一次私人访谈中已回答几批。对应现在的 `private_interview.round_index`；初访最多 7 批，每批最多 3 问。
- `discussion_round_index`：全团队经过几轮“画像 → 分歧 → 人工决定 → 追访”。初访是 Round 0；若配置总共 4 轮，合法索引为 0–3。
- 每次定向追访目前 1 批的限制可以继续使用；这不等于整个项目只能追访一次。
- 新建下一轮 session 不能丢掉此成员的已问问题与批准版本。不得把全部旧 user 消息塞回当前批数计数器，导致新会话误触轮数上限。
- Profile 更新保存条目增删改和来源 Decision；Idea Generator 之后使用这些**已授权的讨论事件**，不是四个人的原始私聊。

## 8. 新版文档中的待统一规则

这些属于团队 Workflow 政策，不由 Interview 私自决定：

1. **三个 Agent 还是四个角色。** 此前分工是 Interview / Negotiate / Evaluator 三人分别负责；新版第 1、8 节新增独立 Idea Generator Agent。建议保持三位 Agent 负责人，把 `generate_ideas` 作为 Negotiate 负责的另一 operation，使用独立 prompt 和输入契约；如果团队确实要第四个 Agent，应显式更新分工。
2. **达到上限仍有关键分歧怎么办。** 第 2 节要求进入 `unresolved` 并停止，第 7.2 节则要求第 5 轮后一律生成 idea。建议优先保存 `unresolved`，由成员明确选择是否带着分歧继续生成候选；继续生成也不代表共识。
3. **用户填 n 与固定 3–5。** 原需求允许用户填写总迭代上限，新文档有“建议 3–5”也有“最少 3、最多 5”的硬规则。建议仍保留可配置上限，把 3–5 和默认 4 作为产品建议；最终范围由 Workflow 统一，Interview 不在 prompt 里另硬编码一套。

## 9. 实施顺序与验收

1. **先冻结契约。** 在本分支新增 v2 Profile / Brief 与引用规则，对齐团队对象名；不把旧 category 机械转换成新语义。旧数据缺少证据时标记未补全，不能补造 evidence。
2. **再改提问和总结。** 更新 `definition.mjs` 策略、长度/数量校验及输出结构；保留旧 CLI 可运行，或显式迁移 fixtures、worker 和调用方，不能只改 prompt。
3. **补本地追访样例。** 在 `workflow.mjs` 演示 Decision gate、两个计数器、稳定 ID 和 Brief 失效；正式登录、房间级 gate 与持久化由团队 Workflow 实现。
4. **离线验证。** 缺失/重复/过期 Decision 不触发模型；私人 evidence 不出现在共享视图；未批准和被删除条目不可引用；新版本拒绝旧 Brief；预算溢出不丢约束；下一轮计数正确且历史题目可用。
5. **有限真实验证。** 用固定参与者样例检查总结忠实度和追问深度，包括主观反对、未知能力、改变条件、拒绝解释。离线结构测试不能证明这些语义质量。

本次审查只发布该设计和 README 导航，未更改运行时，也未调用付费 API。上述测试是实施后的验收目标，不能记成当前已通过。
