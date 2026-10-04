# Idea Generator 的完整上下文与长期记忆

`memory.mjs` 已实现 Mem0 HTTP 客户端、授权来源回查、后台来源同步和 SpacetimeDB 接口适配器。`spacetime/` 提供实际 TypeScript 服务端表、权限视图和事务 reducer。当前验证是离线 HTTP 测试、真实 reducer 函数加模拟数据库的测试，以及 TypeScript 检查；尚未部署数据库或调用付费服务。

## 权威数据与检索数据

Workflow 从经过身份验证的房间状态构造完整请求：比赛背景、硬约束、获准共享的画像、完整共享讨论历史及可解析来源目录；首次生成带真实人工收敛事件，修订带当前候选、评估与人工意见。`mem0` 仅对该来源目录排序，不能补入未经当前授权的旧文本，也不能取代硬约束。

长期记忆先限定为同一房间跨轮次、跨会话。客户端传入 `room_id` 不构成权限证明。必须先由 Workflow 验证成员身份、批准状态、讨论门槛和预算，再调用 Generator。撤回导致房间授权 revision 改变，旧任务立即隐藏且不能提交；新请求目录移除撤回来源和悬空历史引用。

## 已提供的 JavaScript 接口

```js
import {
  createMem0Client,
  createSpacetimeContextStore,
  recallSharedMemory,
  syncSharedSources,
} from './memory.mjs';

// 仅在服务器读取环境变量；不向模型或浏览器暴露客户端写入能力。
const memory = createMem0Client({ apiKey: process.env.MEM0_API_KEY });
const recalled = await recallSharedMemory({
  request: authorizedRequest, client: memory,
  query: '过去否决的方向，以及成员提出的可接受替代方案', limit: 5,
});
// recalled.sources 只含 authorizedRequest 中的原文副本；完整请求保持不变。
```

| 导出 | 输入 / 返回 | 限制 |
| --- | --- | --- |
| `createRoomMemoryScope(roomId)` | 固定房间 namespace | 服务器使用；不能授予权限 |
| `createMem0Client({apiKey,fetch?,timeoutMs?})` | `.search({scope,query,limit?,signal?})`、`.add({scope,source,signal?})` | 固定 API 地址、不跟随重定向、不自动重试 |
| `recallSharedMemory(...)` | `{sources,warnings}` | 失败降级为空补充资料；不丢弃完整上下文 |
| `syncSharedSources(...)` | `{mappings,warnings}` | 仅后台调用；模型不能写入长期记忆 |
| `createSpacetimeContextStore(...)` | `.loadSnapshot(...)`、`.commitResult(...)` | 必须注入已认证的后端回调 |

检索结果必须匹配当前 `source_id`、`object_ref.id/version`、房间、`team_shared` 范围及原文 SHA-256。输出只使用数据库快照原文；忽略 Mem0 返回的自然语言记忆、额外元数据及未知来源。错误消息不包含 API key 或服务商响应原文。HTTP 响应最多 256 KiB，默认 15 秒超时，检索数量最多 20。

官方当前接口为 `POST /v3/memories/search/` 和 `POST /v3/memories/add/`。搜索将 `user_id`、`agent_id` 放入 `filters`；写入以 `infer:false` 保存原文。详见 [Mem0 Search](https://docs.mem0.ai/api-reference/memory/search-memories) 与 [Mem0 Add](https://docs.mem0.ai/api-reference/memory/add-memories)。

写入 metadata 固定为：

```json
{
  "room_id": "room-1",
  "visibility": "team_shared",
  "source_id": "approved-source-42",
  "object_ref": { "id": "answer-12", "version": 2 },
  "content_sha256": "SHA-256 of the exact approved source text"
}
```

旧授权 revision 本身不能证明现在仍共享；读取时的完整新快照才是依据。相同来源在无关授权变更后仍可命中，但撤回、版本变化或原文变化会被排除。

## 持久化与幂等边界

使用 [SpacetimeDB 模块说明](spacetime/README.md) 提供的真实服务端模块，或接现有应用的等价事务。

`loadSnapshot({roomId,requestId,operation,signal})` 返回：

```js
{
  request: completeAuthorizedIdeaRequest,
  authorization_revision: 12,
  // 已完成的同一逻辑任务可带 response，用于直接返回缓存。
  // response: previouslyCommittedResponse
}
```

回调必须先原子领取该任务，拒绝其他正在执行的 attempt；随后读取已经应用到客户端的授权视图。`commitResult({request,response,authorizationRevision,signal})` 必须等待服务端提交确认并返回已保存响应。事务内同时校验房间身份、request hash、输入 revision、授权 revision、执行 attempt 和有效租约。同 ID 不同输入必须拒绝；同输入重复提交返回原结果。不能用进程内 Map 代替数据库去重，也不能把“发出了 reducer 调用”当成成功提交。

`createSpacetimeContextStore` 只校验回调结果形状和信封，不替应用实现认证或事务。它没有默认空数据库，也不会伪造连接。没有两个后端回调时会返回配置错误。

## 后台同步的可靠性

`syncSharedSources({request,client,knownMappings,signal})` 逐一发送当前共享目录，返回来源到 Mem0 ID / event ID 的映射。`succeeded`、`pending`、`unknown` 的已有映射都不会被自动重发。网络失败可能发生在远程已经写入之后，因此未知结果必须人工或后台对账，不能盲目重试。

生产 Worker 应把每条来源同步包装在应用自己的持久 outbox 中：

1. 共享批准事件与 outbox job 在同一事务中保存，以房间、来源 ID、对象版本、文本哈希组成唯一键。
2. Worker 原子领取单条 job；写入前重新读取授权来源。已撤回则跳过，不向 Mem0 上传。
3. 在请求前持久化 attempt；请求后持久化返回的 memory IDs 或 pending event ID。
4. `pending` 通过服务商事件接口对账，`unknown` 查明远程状态后决定是否重试；本模块没有自动轮询或跨服务 exactly-once 保证。
5. 撤回立即阻止读取和旧任务提交，同时登记远程删除任务；本客户端尚未实现 Mem0 删除/事件轮询接口。不能声称远程旧副本已删除。

`syncSharedSources` 本身不创建 durable outbox，也不会阻塞生成流程等待记忆同步；这两点由接入方明确处理。

## 验证

```powershell
node --test agent/idea/memory.test.mjs
cd agent/idea/spacetime
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
```

离线测试覆盖跨房间/撤回/陈旧版本过滤、完整上下文保留、密钥泄露、HTTP 超时及大小上限、写入未知结果、缓存信封，以及服务端权限、租约、幂等和过期提交。真实部署、订阅刷新、服务商网络和人类事件状态机仍需应用联调。
