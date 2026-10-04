# Evaluator Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将细化 idea 转为有来源的查重、可行性及通过／不通过结果，完成可接线接口而不调用真实 API。

**Architecture:** 独立 `agent/evaluator` 包复用 Pi Base。请求级账本与检索预算由代码维护；模型生成两项分析，代码校验来源并组合最终判定。Tavily CLI/API 和 DeepSeek/Gemini 接入作为部署配置，离线 fixture 验证真实 Pi 工具循环。

**Tech Stack:** Node >=22.19、ESM、node:test、Pi 1.0.1、Tavily CLI/HTTP。

**Spec:** `docs/superpowers/specs/2026-10-03-evaluator-agent-design.md`

## Global Constraints

- 用户要求接口与 API 调用代码完整实现，真实 API 暂不测试；本轮不再等待规格或计划确认。
- 在当前目录的新功能分支实现，保留既有规格修改；不创建新工作目录，不推送。
- 查重：高度相同且无明确差异才失败；同类产品存在不自动失败。
- 仅两项 pass 时 passed=true；insufficient_evidence 表示尚未核实。
- 保留 schema_version=1.0 envelope；新报告增加 report_schema_version=1.1 与通过判定字段。
- 每请求默认 2 搜索、3 读取、60 秒、单次 10 秒，可配置；来源记录隔离，超时保留已有证据。
- 不执行项目原型，不写 workflow/数据库/团队批准。

## Review Focus

- 不完整的 idea：核心字段缺失应 INVALID_INPUT，禁止进入模型。
- 零预算／故障：不能让模型输出伪造的通过结果。
- 非官方来源：不能证明技术依赖已获官方支持。
- 旧报告或并发请求：不能借用其他请求来源。
- 未配置凭据及错误环境值：返回可理解的 CONFIG_ERROR，不泄露异常或密钥。

### Task 1: Input and decision contract

**Files:** `agent/evaluator/package.json`, `contracts.mjs`, `test/contracts.test.mjs`, `test/fixtures.mjs`.

**Interfaces:** `normalizeRequest(request)` 返回规范 candidate payload；`validateDraft(data, payload, ledger)` 校验模型输出；`finalizeReport(draft,payload,ledger)` 分配报告 ID、绑定版本并计算 passed。

- [x] 写测试：完整 idea 接受，缺字段、房间错配、私人消息、负预算拒绝；真假来源、依赖覆盖、两项组合、身份篡改拒绝。
- [x] `node --test test/contracts.test.mjs` 确認因缺少实现失败。
- [x] 实现接口与严格校验；证据不足不通过，业务失败与执行失败分开。
- [x] 运行上述测试及已有 suite；保存结果。

### Task 2: Retrieval boundary and scoped tools

**Files:** `retrieval.mjs`, `session.mjs`, `test/retrieval.test.mjs`, `test/session.test.mjs`.

**Interfaces:** `createTavilyCli({executable})`、`createTavilyApi({apiKey,fetchFn})` 返回 `search(query,{limit,signal})` / `read(url,{signal})`；`createSession(payload,options)` 返回工具、账本、freeze。

- [x] 写失败测试：HTTP 方法和正文、CLI 固定参数、UTF8、故障安全错误、预算、超时、取消、来源类型和请求隔离。
- [x] 确認失败，实现适配器与请求级搜索记录/来源账本。
- [x] 实现 `search`、`read_source` 工具，source_kind 仅代码分配，成员来源保留完整引用。
- [x] 跑全部离线测试；不使用真实 Tavily。

### Task 3: Pi runner and models

**Files:** `runner.mjs`, `definition.mjs`, `models.mjs`, `skills/*/SKILL.md`, `test/runner.test.mjs`, `test/models.test.mjs`.

**Interfaces:** `runEvaluator({request,model,streamFn,retrieval,onProgress,officialDomains})` 返回 envelope；`evaluateIdea({idea,context,...runtime})` 便捷入口；`createModelRuntime(env)` 返回 model/streamFn。

- [x] 写失败测试：真实 Pi loop 两个 operation、通过/失败、伪证据、读取失败、硬预算/模型超时、并发版本隔离。
- [x] 确認失败，复用 runAgent，按 operation 显式载入两个项目 skills，输出 JSON instructions。
- [x] 写 DeepSeek OpenAI-compatible 与 Gemini provider 配置测试；实现模型适配与配置校验，API key 仅环境变量。
- [x] 跑 Evaluator 和 Pi Base 全部测试。

### Task 4: Workflow entry points and handoff

**Files:** `cli.mjs`, `python_bridge.py`, `demo.mjs`, `examples/*.json`, `README.md`, `test/cli.test.mjs`; 修改 `agent/contracts.md`, `agent/evaluator-agent.md`, `agent/README.md`。

**Interfaces:** JSONL stdin/stdout 一行一结果；Python `run_evaluator(request,timeout=...)`。

- [x] 写 CLI 测试：离线两行请求、错误 JSON、不含额外 stdout；缺凭据返回 CONFIG_ERROR。
- [x] 确認失败，实现入口与独立 fixture demo（明确标记）。
- [x] 文档写明 idea 与 workflow candidate 两种入口、模型/Tavily配置、错误/partial、查重阈值、接线方法与 API 尚未实测。
- [x] 完整测试、demo、Python语法、diff检查；整体审阅并修复重要问题，提交本次修改。

## Execution record

按用户“该写的都得写掉”直接执行；离线测试与真实 API 测试分开记录，不声称已完成远程验收。

完成记录：

- Task 1：输入和判定契约完成；规范化 idea/candidate，报告增加版本 1.1，保留 envelope 1.0。
- Task 2：CLI/HTTP transport、请求级工具预算和账本完成；外部调用全部用离线替身验证。
- Task 3：Pi runner、两个 operation、固定加载项目 skills、DeepSeek/Gemini 配置完成。
- Task 4：JSONL、Python bridge、离线 demo、两个请求样例和接线文档完成。
- 独立审阅的重要问题已通过复现测试修复：查重只能使用实际项目正文来源；历史报告和来源引用严格限制嵌套字段。答案归因也只落到被引用来源。
- 最终验证：Evaluator 33/33；Pi Base 9/9；Python fixture bridge、Python 与 Node 语法检查、demo、diff 检查通过。
- 本轮没有调用真实模型或 Tavily API。最终文件保存在 codex/evaluator-agent，本地提交，不合并或推送。
