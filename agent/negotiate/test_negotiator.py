import json
import unittest
from pathlib import Path

from agent.negotiate.definition import DEFINITION, handle_request, main
from agent.negotiate.detect import detect_difference, materialize_detect_data
from agent.negotiate.rank import scored_topics
from agent.negotiate.validate import explain_detect_data, explain_detect_input, validate_detect_data
from agent.negotiate.view import build_detect_view

FIXTURES = Path(__file__).resolve().parents[1] / "interfaces" / "fixtures"


def load_pair(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


DIFFERENCE = load_pair("negotiate-difference.json")
CLARIFICATION = load_pair("negotiate-clarification.json")


def item(source_id, text, category, basis="member_statement", confidence="high"):
    return {
        "item_id": source_id,
        "category": category,
        "text": text,
        "basis": basis,
        "confidence": confidence,
        "source_id": source_id,
    }


def profile(member_id, items, unknowns=None):
    return {
        "profile_ref": {"id": f"profile-{member_id}", "version": 1},
        "member_id": member_id,
        "items": items,
        "unknowns": unknowns or [],
    }


def payload_from(profiles, round_index=1, history=None, extra_sources=None, constraints=None):
    sources = []
    for entry in profiles:
        for profile_item in entry["items"]:
            sources.append({
                "source_id": profile_item["source_id"],
                "kind": "profile_item",
                "object_ref": entry["profile_ref"],
                "member_id": entry["member_id"],
                "discussion_round": round_index,
                "text": profile_item["text"],
            })
    sources.extend(extra_sources or [])
    return {
        "contract_version": "2.0",
        "discussion_round": round_index,
        "room_context": {
            "member_ids": ["member-a", "member-b", "member-c", "member-d"],
            "hackathon_context": "test",
            "deadline_at": None,
            "constraints": constraints or [],
        },
        "shared_context": {
            "profiles": profiles,
            "discussion_history": history or [],
            "sources": sources,
        },
    }


class NegotiatorContractTest(unittest.TestCase):
    def test_definition_registers_only_detect(self):
        self.assertEqual(DEFINITION["name"], "negotiate")
        self.assertEqual(list(DEFINITION["operations"]), ["negotiate.detect"])
        self.assertIn("negotiate.detect", DEFINITION["system_prompt"])
        self.assertNotIn("三个候选", DEFINITION["system_prompt"])

    def test_official_fixtures_pass_validators(self):
        for pair in (DIFFERENCE, CLARIFICATION):
            self.assertIsNone(explain_detect_input(pair["request"]["payload"]))
            self.assertTrue(validate_detect_data(pair["response"]["data"], pair["request"]["payload"]))

    def test_rejects_contract_negatives(self):
        payload = DIFFERENCE["request"]["payload"]
        outsider = json.loads(json.dumps(DIFFERENCE["response"]["data"]))
        outsider["difference"]["affected_member_ids"] = ["outsider"]
        self.assertRegex(explain_detect_data(outsider, payload), "Unknown affected member")

        missing = json.loads(json.dumps(DIFFERENCE["response"]["data"]))
        missing["difference"]["source_ids"] = ["not-authorized"]
        self.assertRegex(explain_detect_data(missing, payload), "Unresolved output source")

        old = json.loads(json.dumps(payload))
        old["contract_version"] = "1.0"
        self.assertRegex(explain_detect_input(old), "2.0")

    def test_rejects_answer_shapes_and_authority_fields(self):
        opened = json.loads(json.dumps(CLARIFICATION["response"]["data"]))
        opened["difference"]["options"] = [{"key": "yes", "label": "是"}]
        self.assertRegex(
            explain_detect_data(opened, CLARIFICATION["request"]["payload"]),
            "open questions",
        )

        payload = DIFFERENCE["request"]["payload"]
        one_option = json.loads(json.dumps(DIFFERENCE["response"]["data"]))
        one_option["difference"]["options"] = [{"key": "yes", "label": "是"}]
        self.assertRegex(explain_detect_data(one_option, payload), "exactly two")

        duplicate = json.loads(json.dumps(DIFFERENCE["response"]["data"]))
        duplicate["difference"]["options"] = [
            {"key": "yes", "label": "是"},
            {"key": "yes", "label": "否"},
        ]
        self.assertRegex(explain_detect_data(duplicate, payload), "Duplicate answer option keys")

        invented = json.loads(json.dumps(DIFFERENCE["response"]["data"]))
        invented["difference"]["source_ids"] = []
        self.assertRegex(explain_detect_data(invented, payload), "source_ids")

        extra = json.loads(json.dumps(DIFFERENCE["response"]["data"]))
        extra["difference"]["actions"] = ["generate"]
        self.assertRegex(explain_detect_data(extra, payload), "unexpected fields")

    def test_materialize_rejects_forged_member(self):
        payload = DIFFERENCE["request"]["payload"]
        data = materialize_detect_data(DIFFERENCE["response"]["data"]["difference"], payload)
        self.assertEqual(data["difference"]["question"], DIFFERENCE["response"]["data"]["difference"]["question"])
        forged = dict(DIFFERENCE["response"]["data"]["difference"])
        forged["affected_member_ids"] = ["member-z"]
        with self.assertRaises(Exception):
            materialize_detect_data(forged, payload)


class NegotiatorRankingTest(unittest.TestCase):
    def test_first_round_fixture_finds_product_form_split(self):
        payload = DIFFERENCE["request"]["payload"]
        result = detect_difference(payload)
        difference = result["data"]["difference"]
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["warnings"], [])
        self.assertEqual(difference["kind"], "difference")
        self.assertEqual(difference["category"], "product_form")
        self.assertEqual(difference["answer_type"], "binary")
        self.assertEqual(
            [option["label"] for option in difference["options"]],
            ["保留用户对重要决定的控制。", "通过 AI 减少规划中的重复操作。"],
        )
        self.assertEqual(difference["affected_member_ids"], ["member-a", "member-b", "member-c", "member-d"])
        self.assertEqual(len(difference["source_ids"]), 4)

    def test_settled_answers_become_clarification(self):
        payload = CLARIFICATION["request"]["payload"]
        result = detect_difference(payload)
        difference = result["data"]["difference"]
        self.assertEqual(difference["kind"], "clarification")
        self.assertEqual(difference["answer_type"], "open")
        self.assertEqual(difference["options"], [])
        self.assertTrue(result["warnings"])
        self.assertNotIn("是否让 AI 自动执行", difference["question"])

    def test_two_person_user_split_outranks_four_person_participation(self):
        profiles = [
            profile("member-a", [
                item("a-user", "大学生", "target_user"),
                item("a-part", "只做后端", "participation_condition"),
            ]),
            profile("member-b", [
                item("b-user", "社区医生", "target_user"),
                item("b-part", "只做前端", "participation_condition"),
            ]),
            profile("member-c", [item("c-part", "只做设计", "participation_condition")]),
            profile("member-d", [item("d-part", "只做演示", "participation_condition")]),
        ]
        payload = payload_from(profiles)
        ranked = scored_topics(build_detect_view(payload))
        self.assertEqual(ranked[0][1]["category"], "target_user")
        self.assertEqual(ranked[0][1]["affected_member_ids"], ["member-a", "member-b"])
        self.assertGreater(ranked[0][0], ranked[1][0])
        self.assertEqual(ranked[1][1]["category"], "participation")

    def test_many_positions_stay_open(self):
        profiles = [
            profile("member-a", [item("a-part", "只做后端", "participation_condition")]),
            profile("member-b", [item("b-part", "只做前端", "participation_condition")]),
            profile("member-c", [item("c-part", "只做设计", "participation_condition")]),
            profile("member-d", [item("d-part", "只做演示", "participation_condition")]),
        ]
        difference = detect_difference(payload_from(profiles))["data"]["difference"]
        self.assertEqual(difference["kind"], "difference")
        self.assertEqual(difference["answer_type"], "open")
        self.assertEqual(difference["options"], [])
        self.assertEqual(len(difference["affected_member_ids"]), 4)

    def test_unresolved_answers_ask_what_would_change(self):
        profiles = [
            profile("member-a", [item("profile-a", "保留用户对重要决定的控制。", "desired_experience")]),
            profile("member-b", [item("profile-b", "通过 AI 减少规划中的重复操作。", "desired_experience")]),
        ]
        extra = [
            source("difference-1", "difference", None, "在产品形态上，团队更接近哪一边？"),
            source("answer-a", "difference_answer", "member-a", "必须由用户最后确认。"),
            source("answer-b", "difference_answer", "member-b", "希望系统直接执行重复步骤。"),
        ]
        history = [{
            "discussion_round": 1,
            "profile_source_ids": ["profile-a", "profile-b"],
            "difference_source_ids": ["difference-1"],
            "answer_source_ids": ["answer-a", "answer-b"],
            "convergence_source_ids": [],
            "review_source_ids": [],
        }]
        difference = detect_difference(payload_from(profiles, round_index=2, history=history, extra_sources=extra))["data"]["difference"]
        self.assertEqual(difference["kind"], "difference")
        self.assertEqual(difference["answer_type"], "open")
        self.assertEqual(difference["category"], "product_form")
        self.assertIn("什么条件会让你改变", difference["question"])
        self.assertEqual(difference["source_ids"], ["answer-a", "answer-b"])

    def test_inference_is_not_a_team_difference(self):
        profiles = [
            profile("member-a", [item("a-inf", "应该做自动化", "desired_experience", basis="agent_inference")]),
            profile("member-b", [item("b-inf", "应该完全手动", "desired_experience", basis="agent_inference")]),
        ]
        difference = detect_difference(payload_from(profiles))["data"]["difference"]
        self.assertEqual(difference["kind"], "clarification")
        self.assertIn("推断", difference["question"])

    def test_one_member_conflict_stays_with_that_member(self):
        profiles = [
            profile("member-a", [
                item("a-1", "只想解决宿舍报修", "problem"),
                item("a-2", "只想解决论文阅读", "problem"),
            ]),
        ]
        difference = detect_difference(payload_from(profiles))["data"]["difference"]
        self.assertEqual(difference["kind"], "clarification")
        self.assertEqual(difference["affected_member_ids"], ["member-a"])

    def test_disputed_constraint_is_a_clarification(self):
        profiles = [profile("member-a", [item("a-user", "大学生", "target_user")])]
        constraint = {
            "constraint_id": "c1",
            "text": "必须在 24 小时内做出 demo",
            "verification": "team_claim",
            "acceptance": "disputed",
        }
        extra = [source("constraint-1", "constraint", None, constraint["text"])]
        difference = detect_difference(payload_from(
            profiles, extra_sources=extra, constraints=[constraint],
        ))["data"]["difference"]
        self.assertEqual(difference["kind"], "clarification")
        self.assertEqual(difference["answer_type"], "binary")
        self.assertEqual(difference["source_ids"], ["constraint-1"])
        self.assertIn("必须在 24 小时内", difference["question"])

    def test_english_split_uses_english_question(self):
        profiles = [
            profile("member-a", [item("a-user", "college students", "target_user")]),
            profile("member-b", [item("b-user", "clinic nurses", "target_user")]),
        ]
        difference = detect_difference(payload_from(profiles))["data"]["difference"]
        self.assertEqual(difference["category"], "target_user")
        self.assertIn("Which target user", difference["question"])

    def test_model_hook_must_return_contract_data(self):
        payload = DIFFERENCE["request"]["payload"]
        request = dict(DIFFERENCE["request"])

        def complete(_prompt, _payload):
            self.assertIn("negotiate.detect", _prompt)
            return DIFFERENCE["response"]["data"]

        response = handle_request(request, complete=complete)
        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["data"]["difference"]["question"], "是否让 AI 自动执行重要决定？")
        self.assertEqual(response["request_id"], request["request_id"])
        self.assertIsNone(response["error"])

        def invalid(_prompt, _payload):
            return {"contract_version": "2.0", "difference": {"actions": []}}

        rejected = handle_request(request, complete=invalid)
        self.assertEqual(rejected["status"], "error")
        self.assertEqual(rejected["error"]["code"], "INVALID_OUTPUT")
        self.assertEqual(rejected["data"], {})


class NegotiatorEnvelopeTest(unittest.TestCase):
    def test_handle_request_copies_headers(self):
        response = handle_request(DIFFERENCE["request"])
        for key in ("schema_version", "request_id", "room_id", "operation", "input_revision"):
            self.assertEqual(response[key], DIFFERENCE["request"][key])
        self.assertEqual(response["status"], "ok")
        self.assertIsNone(response["error"])
        self.assertEqual(response["data"]["difference"]["kind"], "difference")

    def test_old_operation_and_version_are_input_errors(self):
        request = json.loads(json.dumps(DIFFERENCE["request"]))
        request["operation"] = "negotiate.generate"
        response = handle_request(request)
        self.assertEqual(response["error"]["code"], "INVALID_INPUT")

        request = json.loads(json.dumps(DIFFERENCE["request"]))
        request["payload"]["contract_version"] = "1.0"
        response = handle_request(request)
        self.assertEqual(response["status"], "error")
        self.assertEqual(response["error"]["code"], "INVALID_INPUT")

    def test_jsonl_loop(self):
        from io import StringIO

        incoming = json.dumps(DIFFERENCE["request"], ensure_ascii=False) + "\n\nnot-json\n"
        outgoing = StringIO()
        main(StringIO(incoming), outgoing)
        lines = [json.loads(line) for line in outgoing.getvalue().splitlines()]
        self.assertEqual(lines[0]["status"], "ok")
        self.assertEqual(lines[0]["operation"], "negotiate.detect")
        self.assertEqual(lines[1]["status"], "error")
        self.assertEqual(lines[1]["error"]["code"], "INVALID_INPUT")


def source(source_id, kind, member_id, text, round_index=1):
    return {
        "source_id": source_id,
        "kind": kind,
        "object_ref": {"id": source_id, "version": 1},
        "member_id": member_id,
        "discussion_round": round_index,
        "text": text,
    }


if __name__ == "__main__":
    unittest.main()
