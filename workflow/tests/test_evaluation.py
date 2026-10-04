import unittest
from workflow.evaluation import resources, time_limit, TIME_LIMIT
from jsonschema import ValidationError

class EvaluatorContextTests(unittest.TestCase):
    def test_only_approved_member_stated_resources_are_shared(self):
        state = {"members": {"alice": {"profile": {"profile_ref": {"id": "p1", "version": 2}, "items": [
            {"item_id": "i1", "source_id": "s1", "category": "skill", "basis": "member_statement", "text": "Approved skill"},
            {"item_id": "i2", "source_id": "s2", "category": "resource", "basis": "agent_inference", "text": "Inferred hardware"},
            {"item_id": "i3", "source_id": "s3", "category": "interest", "basis": "member_statement", "text": "Interest"},
        ]}, "messages": [{"content": "PRIVATE-secret"}]}, "bob": {"profile": None}}}
        result = resources(state)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["profile_version"], 2)
        self.assertEqual(result[0]["source_id"], "s1")
        self.assertNotIn("PRIVATE", str(result))
        self.assertNotIn("Inferred", str(result))

    def test_time_is_explicit_and_legacy_deadline_is_supported(self):
        state = {"config": {}, "room_context": {"deadline_at": None}}
        self.assertIsNone(time_limit(state))
        state["room_context"]["deadline_at"] = "2026-10-05T18:00:00Z"
        self.assertEqual(time_limit(state), {"kind": "deadline", "deadline_at": "2026-10-05T18:00:00Z"})
        for invalid in [{"kind": "duration", "hours": 0}, {"kind": "none", "hours": 3}, {"kind": "deadline", "deadline_at": "tomorrow"}]:
            with self.assertRaises(ValidationError): TIME_LIMIT.validate(invalid)

    def test_reopened_interview_uses_explicit_feasibility_not_report_status(self):
        from workflow.engine import Workflow
        state = {"candidates": {"c1": {"candidate_ref": {"id": "c1", "version": 1}}},
            "evaluations": {"c1": {"content": {"report_status": "partial"}}},
            "evaluation_details": {}, "difference": None, "answers": {}}
        review = {"candidate_ref": {"id": "c1", "version": 1}}
        workflow = Workflow.__new__(Workflow)
        for result, expected in [("pass", "feasible"), ("fail", "infeasible"), ("insufficient_evidence", "unknown")]:
            state["evaluation_details"]["c1"] = {"tests": {"feasibility": {"result": result, "reason": "Actual verdict rationale"}}}
            followup = workflow._followup(state, "review_more_discussion", review)
            self.assertEqual(followup["evaluation"]["feasibility"]["verdict"], expected)
            self.assertEqual(followup["evaluation"]["feasibility"]["rationale"], "Actual verdict rationale")
