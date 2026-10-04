"""Pluggable transport. Mock is explicit; Pi routes only to configured local modules."""
import asyncio
import copy
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PiRunner:
    mode = "pi"

    def __init__(self, modules=None):
        self.modules = modules or {
            role: ROOT / "agent" / role / "definition.mjs"
            for role in ("interview", "negotiate", "idea", "evaluator")
        }
        spec = importlib.util.spec_from_file_location("conclave_pi_bridge", ROOT / "agent/pi-base/python_bridge.py")
        self.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.bridge)

    def __call__(self, request):
        module = Path(self.modules[request["operation"].split(".")[0]]).resolve()
        if not module.is_file():
            raise RuntimeError("Agent definition missing; install the teammate's configured module")
        return asyncio.run(self.bridge.call_agent(request, role_module=str(module)))


class MockRunner:
    """Deterministic data for exercising workflow, not an implementation of the Agents."""
    mode = "mock"

    def __call__(self, request):
        p, op = request["payload"], request["operation"]
        data, status = {"contract_version": p["contract_version"]}, "ok"
        shared = p.get("shared_context", {})
        source_ids = [s["source_id"] for s in shared.get("sources", [])]
        if op == "interview.turn":
            ready = p["limits"]["remaining_question_batches"] == 0
            questions = [] if ready else [{
                "question_key": "q-1",
                "text": ("最近最想解决的问题是什么？" if p["mode"] == "initial"
                         else "结合上一轮的人工回答，什么条件会让你改变判断？"),
                "purpose": "离线演示：澄清目标与可妥协条件。",
                "related_source_ids": source_ids[-1:] if source_ids else [],
            }]
            data.update(member_id=p["member_id"], questions=questions, ready_to_summarize=ready,
                        stop_reason="question_budget" if ready else None)
            status = "ok" if ready else "needs_input"
        elif op == "interview.summarize":
            answers = [m for m in p["messages"] if m["role"] == "user"]
            items = [] if not answers else [{
                "item_key": "draft-1", "category": "goal", "text": answers[-1]["content"],
                "basis": "member_statement", "confidence": "medium",
                "private_message_ids": [answers[-1]["message_id"]],
            }]
            data.update(member_id=p["member_id"], profile_draft={"items": items, "unknowns": []})
        elif op == "negotiate.detect":
            data["difference"] = {
                "kind": "clarification", "category": "unknown", "question": "共同方向还遗漏了什么不能接受的条件？",
                "answer_type": "open", "options": [],
                "affected_member_ids": p["room_context"]["member_ids"],
                "why_it_matters": "离线演示：请成员真实回答，不模拟共识。",
                "source_ids": source_ids[:4],
            }
        elif op == "idea.generate":
            data["candidates"] = [{
                "slot_id": slot,
                "draft": {
                    "title": f"离线演示候选 {index + 1}", "target_users": ["Hackathon 团队"],
                    "problem": "团队需要澄清偏好。", "solution": f"方案 {index + 1} 的示例取舍。",
                    "core_flow": ["表达偏好", "人工决定", "审阅结果"],
                    "mvp_scope": ["文字讨论"], "out_of_scope": ["自动部署"],
                    "critical_dependencies": [{"key": "model-api", "description": "模型 API", "must_have": True}],
                    "contributions": [{"description": "基于获准共享的讨论。", "origin": "agent_synthesis",
                                       "source_ids": source_ids[:1]}],
                    "discussion_source_ids": source_ids[:1], "tradeoffs": ["仅做文字 MVP"],
                    "unknowns": ["尚无真实检索"], "change_summary": "",
                },
            } for index, slot in enumerate(p["candidate_slots"])]
        elif op == "idea.revise":
            draft = copy.deepcopy(p["candidate"]["content"])
            draft["change_summary"] = p["reviews"][0]["instructions"]
            draft["mvp_scope"] = [p["reviews"][0]["instructions"]]
            data.update(base_candidate_ref=p["candidate"]["candidate_ref"], draft=draft)
        elif op == "evaluator.evaluate":
            status = "partial"
            data["evaluation"] = {
                "candidate_ref": p["candidate"]["candidate_ref"], "report_status": "partial",
                "summary": "离线演示：未进行真实搜索或技术验证。",
                "findings": [], "similar_projects": [], "risks": ["仍需真实评估"],
                "unknowns": ["API、相似项目与实现条件"], "recommended_changes": [],
                "evidence": [], "search_log": [],
            }
        else:
            raise ValueError("Unsupported mock operation")
        headers = {k: request[k] for k in ("schema_version", "request_id", "room_id", "operation", "input_revision")}
        return {**headers, "status": status, "data": data, "warnings": ["MOCK: offline data, no real research"],
                "error": None}
