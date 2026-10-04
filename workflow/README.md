# Workflow：本地运行与接线

实现位置：`workflow/engine.py`（状态机）、`store.py`（SQLite）、`agents.py`（mock / Pi 适配）、`server.py`（HTTP）、`web/`（Considea 工作台：HTML、样式、HTTP 接线与动效）。

整合入口见 [INTEGRATION.md](INTEGRATION.md)：已接 Interview、Python Negotiator、Idea、Evaluator 与 SpacetimeDB 共享桥接。以下说明保留基础 mock / 自定义 Pi 模块模式，团队联调用 `--mode integrated`。

Workflow 已实现四角色的调度与人工节点。业务 Agent 的 prompt、工具和实际输出由队友实现；默认 mock 仅用于验证流程，页面会明确标记，不能把演示候选或报告当成真实研究结果。

界面使用方式、数据对应关系和浏览器回归见 [INTERFACE.md](INTERFACE.md)。假 login 只是测试入口，房间权限仍由邀请码和成员令牌控制。

## 启动与验证

在仓库根目录：

```powershell
python -m pip install -r workflow/requirements.txt
python -m workflow
```

使用 Python 3.10+，额外 Python 依赖是 jsonschema 和 python-dotenv。启动时自动加载仓库根目录 `.env`，终端环境变量优先；详见 [配置说明](INTEGRATION.md#安装与运行)。打开 http://127.0.0.1:8765 ，点击 **Enter test workspace**。创建房间后保存管理员令牌，将对应邀请码分别交给成员。成员在独立标签页加入；同一标签页只保持一个身份。加入后展开“保存本人的恢复凭据”，私下保存 room_id 和 token；退出或换标签页后，填写房间 ID 与已有个人令牌即可恢复。

```powershell
python -m unittest discover -s workflow/tests -v
python agent/interfaces/validate_contracts.py
```

默认测试不调用真实模型或网络；整合测试依赖安装后的队友 Agent 代码，使用合成模型输出与合成检索结果。

参数：

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| --host | 127.0.0.1 | 本机监听 |
| --port | 8765 | HTTP 端口 |
| --db | workflow/data/conclave.sqlite3 | SQLite 文件 |
| --mode | mock | mock、旧 pi、自带队友接线的 integrated |
| --model | offline | integrated 的 offline / live 模型 |
| --evaluator | agent | integrated 的 agent / stub / blocked |
| --spacetime-config | 无 | 私有数据库连接 JSON 文件 |
| --workers | 4 | 后台任务并发数，1–16 |

数据目录已被 Git 忽略，数据库包含私人访谈，不能作为联调样例提交到仓库。重启同一路径会恢复状态；mock 房间仅由 mock worker 处理，pi 房间仅由 pi worker 处理。切换模式时创建相应模式的新房间。

## 确认规则与默认政策

用户已确认：每轮 Human 回答 difference；n≤3 回 Interview；n≥4 才开放人工选择；全员 converge 才生成，任何人 diverge 即继续讨论。

当前实现：

- n 从 1 开始。前三轮所需答案齐全、n≥4 有人 diverge、或候选审阅选择加一轮时，n 加 1 并启动 Interview。小改、重试、重复请求不加轮。
- 每轮所有成员重新访谈并批准画像；difference 等待 Agent 输出中 affected_member_ids 的所有成员回答。没有实质分歧时仍可提出 clarification，仍需人答。
- 访谈可明确拒答；画像草稿可编辑或删除条目、修改未知项。批准前仅本人可见，批准后才进入共享上下文。
- 生成后所有候选先评估，报告 complete 或 partial 均可交给人审阅；partial 明确表示核查不完整。
- 审阅默认全员针对同一候选、版本和报告提交同一动作。全员 accept 才最终输出；全员 more_discussion 返回 Interview；全员 minor_revision 且修改文字去除首尾空白后相同时才小改。
- 不同动作或冲突修改文字会保持等待，成员可修改自己的审阅；没有多数票或房主代投。这个审阅政策是当前保守默认值，不声称白板已规定所有细节。
- 小改产生新版本、新报告，并清除该候选旧版确认。加一轮保存候选和审阅历史，重新经过 Interview、Negotiator、人工回答与收敛节点。
- 模型输出、沉默、预算耗尽、超时、达到某个最大轮数都不能充当人工决定。

创建房间可传 config，省略项使用默认值：

| 字段 | 默认 | 允许值 |
| --- | --- | --- |
| question_batches_per_round | 1 | 1–7 |
| max_questions | 3 | 1–3 |
| candidate_count | 3 | 1–5 |
| max_agent_calls | 200 | 1–10000 |
| max_task_retries | 2 | 0–3；每次人工重试周期内允许的自动重试/崩溃重领次数，0 关闭 |
| search_enabled | false | boolean |
| max_search_queries | 0 | 0–50 |
| project_time_limit | null | none / duration(hours) / deadline(deadline_at) 对象；原生 Evaluator 开始前必须明确 |
| decision_policy | unanimous | 当前仅支持这一已确认规则 |

## HTTP 输入输出

JSON 请求使用 `Content-Type: application/json`，单次请求最多 1 MiB。除创建、加入和 health 外，使用 `Authorization: Bearer <token>`。客户端不能指定可信 actor；身份由令牌确定。

| 方法与路径 | 输入 | 成功输出 |
| --- | --- | --- |
| GET /api/health | 无 | {status:"ok", agent_mode:"mock"或"pi"} |
| POST /api/rooms | {room_context, config?} | 201，{room_id, admin_token, invitations:{member_id:邀请码}, mode} |
| POST /api/rooms/{room_id}/join | {invitation} | {room_id, member_id, token} |
| GET /api/rooms/{room_id} | 无 body | 本身份可见的 RoomView，见下文 |
| POST /api/rooms/{room_id}/events | v2.0 ClientEvent | EventResult，accepted 为 200，业务 rejected 为 409 |
| POST /api/rooms/{room_id}/tasks/{task_id}/retry | {} | {task_id,status:"queued"} |
| POST /api/rooms/{room_id}/project-time-limit | {time_limit}，管理员；只能首次设置，相同值幂等 | {project_time_limit} |
| POST /api/rooms/{room_id}/budget | {max_agent_calls:更大的整数}，管理员 | {max_agent_calls} |
| POST /api/rooms/{room_id}/stop | {}，管理员 | {phase:"ended"} |

无权限、格式错误等非事件业务错误返回 `{error:{code,message}}` 和相应 4xx；内部异常只给通用错误，不把私人上下文或 provider 原始错误发到页面。

创建示例：

```json
{
  "room_context": {
    "member_ids": ["alice", "bob", "carol", "dan"],
    "hackathon_context": "四人 Hackathon 团队",
    "deadline_at": null,
    "constraints": []
  },
  "config": {
    "candidate_count": 3,
    "decision_policy": "unanimous"
  }
}
```

RoomContext 字段由 [JSON Schema](../agent/interfaces/protocol.schema.json) 的 RoomContext 固定；成员最多 12 人。邀请码单次使用，管理员令牌和成员令牌分别保存；数据库只存令牌及邀请码的哈希。管理员能查看共享信息和任务状态，不能读取成员私人问答或代提交成员决定。

### RoomView

`GET /api/rooms/{room_id}` 返回：

| 字段 | 内容 |
| --- | --- |
| room_id / revision / discussion_round / phase / mode | 房间标识、展示快照版本、讨论轮次、阶段、运行模式 |
| room_context / config | 比赛背景、成员、约束和运行配置 |
| actor | {role:"member"或"admin", member_id:字符串或null} |
| members | 每位成员的 stage、approved_round；不含私人问答 |
| private | 本人成员的 session_ref、stage、messages、question_batch、draft、revision、mode、interview_turn、batches_asked；管理员为 null |
| event_revisions | interview、difference、convergence，以及 review:{candidate_id:revision}；管理员为 null |
| shared_context | v2 SharedContext：profiles、discussion_history、获准共享的 sources |
| difference / answers / votes / convergence_decision | 当前分歧、按成员索引的真实回答与选择，以及最终进入生成的决定 |
| candidates / evaluations / reviews | 按 candidate_id 索引的当前候选、报告、按成员索引的审阅 |
| candidate_history | 旧候选版本、对应报告和真实审阅 |
| tasks | 允许查看的 task_id、member_id、operation、status、attempts、auto_retries、next_attempt_at、脱敏 error |
| calls_started / paused_reason | 已开始的调用尝试数；暂停原因为 agent_budget 或 null |
| selected_candidate_ref / final_output | 接受前为 null；接受后包含当前 candidate、evaluation、human_reviews |

候选、报告、difference 等对象仍使用 v2 的 Ref/content 结构；不要用标题或数组位置作为身份。历史 difference 在下一轮访谈期间保留，用于解释追问；其 discussion_round 指示所属轮次。

公共任务所有成员可见；私有 Interview 任务只向对应成员及管理员显示状态。原始任务 payload、模型错误和响应内容不会出现在公共任务列表。

### Human 事件

五种事件的精确 payload：`interview.answer`、`profile.approve`、`difference.answer`、`convergence.vote`、`candidate.review`，见 [契约第 8 节](../agent/contracts.md) 和 [完整样例](../agent/interfaces/fixtures/human-events.json)。

```json
{
  "contract_version": "2.0",
  "event_id": "client-generated-unique-id",
  "room_id": "room-id-from-create",
  "expected_revision": 0,
  "type": "difference.answer",
  "payload": {
    "difference_ref": {"id": "difference-id-from-view", "version": 1},
    "selected_option_key": null,
    "text": "需要保留离线使用能力。",
    "disagrees_with_framing": false
  }
}
```

上例 ID 和 revision 是占位值，必须从实际 RoomView 获取：

| 事件 | expected_revision |
| --- | --- |
| interview.answer、profile.approve | view.event_revisions.interview |
| difference.answer | view.event_revisions.difference |
| convergence.vote | view.event_revisions.convergence |
| candidate.review | view.event_revisions.review[candidate_id] |

**不要直接提交 view.revision。** revision 检查按成员和当前对象隔离，另一位成员的正常回答不会导致自己的提交失效。Ref 仍必须同时匹配当前 id 和 version。

成功：`{event_id,status:"accepted",current_revision}`。拒绝增加 `error:{code,message}`。相同身份、相同 event_id、相同请求重发返回原结果；复用 ID 却改变正文或身份返回 CONFLICT。修正一次已拒绝的提交应生成新 event_id。前端收到 STALE_INPUT 应先刷新再让人确认新对象。

每个事件的原始正文、经认证的 actor、接收时间和结果持久化保存；其中私人事件不会进入共享历史。共享来源只由应用层根据批准或共享事件构造。

## 队友如何接 Agent

基础契约为 v2.0；新 Interview 请求和输出使用其显式 v2.1 扩展，其他 operation 与人工事件保持 v2.0。详见 [整合接口](INTEGRATION.md#接线与记忆)。

| operation | 默认模块 |
| --- | --- |
| interview.turn、interview.summarize | agent/interview/definition.mjs |
| negotiate.detect | 集成模式：agent/negotiate/definition.py；旧 pi 模式仅支持自定义 JS 模块 |
| idea.generate、idea.revise | agent/idea/definition.mjs |
| evaluator.evaluate | agent/evaluator/definition.mjs |

按 [契约的 Pi 接入说明](../agent/contracts.md) default-export plain definition；不要把旧 roles.mjs 或 example-role.mjs 当作新业务实现。Workflow 已构造公共来源、当前成员私人上下文、前轮 difference/人工回答、候选/报告/修改意见和各项限制。

安装 [Pi Base](../agent/pi-base/README.md) 所列 Node 依赖与模型配置，确保 node 在 PATH，然后：

```powershell
python -m workflow --mode pi --db workflow/data/pi.sqlite3
```

需要改模块位置时使用服务器环境变量 CONCLAVE_INTERVIEW_MODULE、CONCLAVE_NEGOTIATE_MODULE、CONCLAVE_IDEA_MODULE、CONCLAVE_EVALUATOR_MODULE。浏览器请求不能传入任意模块路径。

传输链路：

```text
engine 构造请求 → 持久化任务 → PiRunner
→ 原有 python_bridge.call_agent → cli.mjs → 队友 definition
→ schema + 引用/预算等语义校验 → 原子提交
```

Agent 不直接读数据库、互调、登记人类同意或写状态。它只返回规定结构；失败和缺少模块会保持原阶段，修复配置后重试任务。

Evaluator 的搜索工具由队友提供并遵守 search_policy；Workflow 校验搜索报告及引用，不能仅凭模型自报日志证明真实检索。当前没有可信的原型测试记录入口，因此不接受 Agent 自行捏造 test_record 后声称 verified；可以返回 needs_test、unknown 或有来源支持的结论。

## 失败恢复、并发与权限边界

- SQLite 短事务管理状态、事件去重、排队和任务提交；模型调用在事务外执行。
- 独立成员 Interview 可并行。输入快照及依赖包含轮次、阶段、对应成员 revision 或 candidate_ref；旧结果不能覆盖新状态。
- 基础任务领取使用 120 秒租约；SpacetimeDB 整合派发使用 480 秒，远端 Idea 使用 300 秒。`run_once` 每隔 min(30 秒, 租约/3) 续租，避免正常的长调用被重复领取；过期持有者即使尚未被替换，也不能续租或提交。内置 runner 自身仍有调用超时；自定义 runner 也必须实现有界超时。
- `MODEL_TIMEOUT` / 明确标为 retryable 的 `MODEL_ERROR` 及已知连接/超时故障默认自动重试两次，等待约 2–3、4–5 秒。等待时任务仍为 queued，不占用工作线程；`next_attempt_at` 是持久化的 Unix 秒时间，重启不清零。租约过期重领共用同一重试额度；它已经等待租约到期，不再增加短退避。重试耗尽后显示 failed。
- `INVALID_OUTPUT`、配置/输入/工具/预算问题和未知程序异常不自动重试。JSON 错误已由 Agent harness 做有界纠正，workflow 不叠加自动整轮生成。人工 retry 保留原 request_id 和输入快照，重新检查轮次、阶段、成员 revision、候选版本；只重跑失败节点。公共任务可由成员重试，私人任务只允许本人或管理员。
- `attempts` 是累计派发数；`auto_retries` 是最近一次人工 retry 之后已安排的自动重试/重领数。人工 retry 重置后者，不重置累计次数或房间预算。`error.recovery` 为 automatic_retry、manual_retry 或 fix_configuration，便于前端解释下一步；错误消息不包含模型原文。
- 新增 SQLite `task_attempts` 私有审计，保存各次尝试的状态及失败响应（可序列化且不超过 1,048,576 字符的响应）；人工重试不会擦掉诊断。它不进入 RoomView 或 SpacetimeDB 看板。旧数据库只添加表/列并保留已有失败记录，无需清空房间。迁移前记录缺少精确开始时间，保留原任务创建时间，finished_at 可为空。
- 应用结果和排队下一节点使用事务内保存点：应用异常会完整回滚房间、共享 outbox 和新任务，再记录 APPLY_FAILED。旧候选、人工回答和确认保留；修复后可重试。不会把部分应用当成成功。
- 进程崩溃、连接丢失或超时仍可能导致远端调用重跑或再次计费；保证的是有效结果只应用一次，不是远端模型只执行一次。
- 每次实际派发或重领计入 max_agent_calls。达到额度只暂停派发；管理员提高额度后恢复，或 stop 结束。已经开始的调用不因额度用尽自动取消。
- stop 取消排队和运行任务并拒绝迟到结果；已完成房间不能被 stop 覆盖。
- 已批准历史会传给后续 Agent。新画像编辑不等于撤销旧授权；授权撤回、依赖结果清理、邀请补发、令牌恢复和生产登录尚未实现。
- 本地 HTTP 工作台用于开发联调；未实现公网部署、TLS、多租户运营管理或生产级访问入口。真实 Agent 效果需接入后另行验证。

Evaluator 完整报告通过 RoomView 的 `evaluation_details` 展示，`evaluation_input_required` 为 true 时由管理员补充项目时限。输入输出映射、来源限制与真实 API 配置见 [整合说明](INTEGRATION.md#evaluator-接口与持久化)。
