# 整合分支：运行、接口与验收

分支：`feat/integration-spacetimedb`。Interview、Negotiator、Idea 使用队友的真实代码；Evaluator 尚未接入。Mem0 保留原实现，但没有启用，也不会上传任何记忆到 Mem0。

## 安装与运行

在仓库根目录运行，需要 Python 3.10+、Node 22.19+ 和 pnpm：

```powershell
python -m pip install -r workflow/requirements.txt
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/interview install --frozen-lockfile
pnpm --dir agent/idea install --frozen-lockfile
pnpm --dir agent/idea/spacetime install --frozen-lockfile
pnpm --dir workflow/node install --frozen-lockfile
pnpm --dir workflow/node build
python -m workflow --mode integrated --model offline --evaluator stub --db workflow/data/integrated.sqlite3
```

打开 http://127.0.0.1:8765 。`offline` 使用真实 Agent service、validator 和 Pi loop，但模型回答来自明确标记的固定样例；Negotiator 使用队友实现的 Python 规则排序，不调用模型。

真实模型：在服务器环境配置 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`，然后将 `--model offline` 改为 `--model live`。也可显式配置 `PI_PROVIDER`、`PI_MODEL` 和该 provider 的密钥。不会自动读取队友的 `.env` 文件，不会自动回退到模拟模型。用新的数据库文件创建 live 房间，避免与旧 mock/offline 房间混用。

Evaluator 可选 `--evaluator stub`（醒目标记的 partial 占位报告，可联调后续人审）或 `--evaluator blocked`（停在评估任务，报告尚未实现）。两者均不表示真实评估完成。

## 接 SpacetimeDB

使用 **CLI 与 SDK 同为 2.10.2**。先在另一个终端启动自己的本地实例：

```powershell
spacetime start --listen-addr 127.0.0.1:3000
```

保持实例运行，在仓库根目录：

```powershell
python -m workflow.prepare_spacetime --server http://127.0.0.1:3000 --database considea-dev
python -m workflow --mode integrated --model offline --evaluator stub --db workflow/data/integrated-space.sqlite3 --spacetime-config workflow/data/spacetime.json
```

准备脚本在指定开发服务器发布模块、生成绑定、构建 SDK 客户端，并将 owner token 写入 Git 忽略的 `workflow/data/spacetime.json`。**不会删除已有数据库数据**。脚本支持 `--cli` 指定已安装 CLI 的完整路径。首次连接产生独立 workflow/worker 身份并写回同一私有配置；配置文件必须可写，不能提交或发送给浏览器。

本次本机验收使用 `127.0.0.1:3019`、`considea-integration`，数据、下载的 CLI、日志及配置均在忽略的 `workflow/data/`，没有云端发布。该测试进程不保证持续运行；上述命令可重建自己的运行环境。

## 接线与记忆

| 模块 | 输入/输出与入口 |
| --- | --- |
| Interview | `service.mjs/runInterview`；所有新访谈使用 Interview 专用 v2.1 扩展；返回相同版本 |
| Negotiator | `agent.negotiate.handle_request`；v2.0 `negotiate.detect`；使用原生 Python 实现 |
| Idea | `service.mjs/runIdea`；接数据库时走 `runIdeaFromStore`；生成和修改都用 v2.0 |
| Evaluator | v2.0 请求和返回保持不变，暂用占位或暂停，等待队友交付 |
| Human 事件 | 仍是 v2.0；身份、批准、轮数、投票和审阅只由 workflow 验证 |

Interview v2.1 只扩展该角色，不启用 Idea 的独立 v2.1 检索协议。新跟进输入额外含 `decision_result / candidate / evaluation`：前三轮携带已收齐的真实回答和继续路由；diverge 携带真实投票；reopened 携带确切候选、对应报告和每位成员自己的 review。当前报告没有整体 feasibility verdict，因此明确传 `unknown`，不从 partial 推断不可行。

Idea 小改的 `human_review` source.text 与原始 `review.instructions` 一致；事件完整正文仍存 SQLite。无修改文字的 accept 事件保留其结构化文本。

- SQLite 是流程状态与授权历史的主记录，保存私人访谈、批准、事件、任务快照和来源。
- SpacetimeDB 是 Idea 执行队列和结果缓存；Python 的任务记录只跟踪派发及应用结果，不另行执行同一 Idea。
- Agent 每次创建新的 Pi 会话；workflow 明确传入授权上下文。Idea 只使用数据库中领取到的任务快照。没有隐式跨调用 memory，也没有启用 Mem0。
- 共享看板仅含批准资料与共享事件；原始 rooms.state、私聊、草稿、令牌不会同步。
- SQLite 同一事务保存状态及 `shared_outbox` 最新快照。同步失败保留重试，SpacetimeDB 按版本拒绝旧覆盖；两库之间没有分布式原子事务。
- SDK 订阅通过服务器转为带 Bearer 认证的 `/api/rooms/{id}/updates` SSE，页面收到变更后重新获取本身份 RoomView。浏览器没有 SpacetimeDB 后端凭证；另保留 10 秒恢复轮询。
- `agent_runtime` 标明模型模式、真实规则 Negotiator、Evaluator 占位和 Mem0 关闭；HTTP RoomView 的 `realtime` 含连接状态和已同步版本。

## 并发、失败与边界

- Idea 的 SpacetimeDB 租约为 5 分钟，模型执行上限为 90 秒。整合模式接数据库时，外层 SQLite 派发租约为 8 分钟，避免旧任务恢复期间又派发一个独立执行者。
- 先等待 reducer 提交和订阅缓存应用，再读请求或返回结果。并发领取只允许一个有效 attempt；成功结果重连后可复用。
- 失败结果不会推进流程。用户在 workflow 显式重试后，允许重新执行缓存的错误结果；成功缓存不能被清除。
- 停止房间会作废 SQLite 任务并排队更新远端版本；同步尚未到达时远端可能完成已启动调用，但旧结果不能推进本地状态。
- 进程崩溃和租约过期可能导致模型重跑或再次计费；只保证有效结果不会重复应用。
- 当前没有授权撤回功能；`authorizationRevision=0`，不声称已实现撤回记忆。新增撤回入口时必须同时处理历史来源和远端任务版本。
- 独立 Interview Agentverse/ASI 会话仍有自己的 JSON 存储，它不是团队房间的入口，本轮没有把整个团队 workflow 发布到 ASI。
- 本轮未接外部检索扩展、Mem0、Evaluator 实现或云端部署。真实模型效果需要密钥配置后另验收。

## 测试

```powershell
python -m unittest discover -s workflow/tests -v
python -m unittest agent.negotiate.test_negotiator -v
python agent/interfaces/validate_contracts.py
pnpm --dir agent/interview test
pnpm --dir agent/idea test
pnpm --dir agent/idea/spacetime typecheck
pnpm --dir agent/idea/spacetime test
```

本地 SpacetimeDB 启动并准备配置后：

```powershell
$env:CONCLAVE_TEST_SPACETIME_CONFIG = (Resolve-Path workflow/data/spacetime.json).Path
python -m unittest workflow.tests.test_integration.SpacetimeIntegrationTests -v
pnpm --dir workflow/node test
```

这组测试创建虚构房间，不能指向生产数据库。浏览器验证使用 `workflow/node/browser-smoke.mjs`；安装 Playwright 及 Chromium 后，对本地已启动服务设置 `CONCLAVE_TEST_URL` 再执行。也可用 `PLAYWRIGHT_MODULE` 指定已有 Playwright 安装路径。

本次验证：Interview/Pi/会话 70 项、Idea 75 项、Negotiator 18 项、SpacetimeDB reducer 10 项、原 workflow 18 项、跨 Agent 闭环 4 项、本地数据库闭环 4 项、真实 SDK 3 项、独立 ACP 传输 5 项通过；协议样例和双浏览器闭环通过。浏览器关闭了恢复轮询，验证实时更新确实来自订阅。模型均为模拟响应，Evaluator 均为占位，不代表模型输出质量。
