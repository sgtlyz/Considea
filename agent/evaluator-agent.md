# Evaluator Agent：并行开发交付说明

负责人实现 `evaluator.evaluate`，模块约定 `agent/evaluator/definition.mjs`，name 为 `evaluator`。

输入 candidate、shared_sources、search_policy、provided_evidence 及公共字段。输出带精确 candidate_ref 的 evaluation。完整字段以 [契约](contracts.md) 第 7 节和 [schema](interfaces/protocol.schema.json) 的 EvaluatorEvaluateInput/Data、Evaluation、Evidence、Finding 为准。

## 评估范围

技术 API、数据、设备、MVP 时间条件、相似项目与具体差异。只基于传入或实际只读工具取得的证据，报告保留支持范围与未知项。

- supported_by_source：有真实文档或公开项目来源。
- team_claim：可追溯到共享成员陈述。
- verified：确有实际测试记录；普通网页检索不能升级为 verified。
- needs_test / unknown：如实保留，不补成确定事实。

enabled=false 或 max_queries=0 时不搜索。工具须响应取消，不能写业务状态。工具实现与来源真实性由本角色负责，预算和候选版本提交由 Workflow 再检查。

status=ok 对应 report_status=complete；status=partial 对应 partial。失败和没有搜索结果分开记录。complete 不等于零风险。返回完整报告后由 Human 决定接受、小改或加一轮，你不替人选择。

## 样例与验收

- [无法检索时的 partial](interfaces/fixtures/evaluator-partial.json)
- [complete 的离线结构样例](interfaces/fixtures/evaluator-complete.json)

样例证据明确为 mock，不能当作真实研究。验收 source/evidence 引用可解、dependency_key 来自本候选、candidate_ref 完全一致、旧版本报告不覆盖新版、无工具时不编造 URL。Evaluator 没有独立 investigate 操作；同一 evaluate 可根据候选新版本重新评估。
