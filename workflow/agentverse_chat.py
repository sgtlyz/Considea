"""Chat commands over the same workflow and privacy projections as the website.

This module does not run models, approve drafts, or bypass room access controls.
ACP transport supplies a verified sender/session key and an idempotent message ID.
"""
import copy
import json
import re

from .engine import WorkflowError
from .store import digest, encode


ROLES = {
    "interview": ("Considea Interview", "Private interviews and member-approved preference summaries."),
    "negotiate": ("Considea Negotiator", "Evidence-linked differences and human convergence decisions."),
    "idea": ("Considea Idea Generator", "Project candidates grounded in approved team preferences."),
    "evaluator": ("Considea Evaluator", "Feasibility and novelty checks with bounded web research."),
}

HELP = """Considea turns a team's preferences into a reviewed project brief.
Every participant should use a private ASI conversation. Your answers are processed by the configured model provider; only summaries you approve are shared with your team.

Create a room: /create DEMO_CODE | your-name,teammate-name | project context | hours
Join a room: /join ROOM_ID INVITATION
The room creator receives a separate invitation for each teammate. Keep your own recovery code private.

/status — current questions, draft, team decision, candidates or final brief
/answer answer one | answer two | answer three — answer the displayed questions in order
/approve DRAFT_ID:VERSION — explicitly share the displayed summary
/edit ITEM_NUMBER replacement text — correct a draft before approving
/drop ITEM_NUMBER — remove a draft item before approving
/difference your answer — answer the current team question
/choose OPTION_KEY | optional context — answer a multiple-choice difference
/disagree your explanation — flag an inaccurate question
/vote converge or /vote diverge — decide after round 4's required answers
/accept CANDIDATE_ID:VERSION — accept a candidate after evaluation
/revise CANDIDATE_ID:VERSION | changes — request a small revision
/discuss CANDIDATE_ID:VERSION | reason — return to interviews
/recover ROOM_ID MEMBER_NAME RECOVERY_CODE — restore your membership in a new chat
/help — these instructions

The same workflow, database, model configuration and human gates are used by the website and these agents. Model advice never counts as your approval. Agent roles become active when the workflow reaches their phase."""


def tag(ref):
    return f"{ref['id']}:{ref['version']}"


class ChatWorkflow:
    def __init__(self, workflow, security):
        self.workflow, self.security = workflow, security
        if security.live and not security.cipher:
            raise ValueError("Agentverse live sessions require encrypted credential storage")
        with workflow.store.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS agentverse_sessions (session_key TEXT PRIMARY KEY, data TEXT NOT NULL)")

    def seal(self, value):
        text = encode(value)
        return self.security.cipher.encrypt(text.encode()).decode() if self.security.cipher else text

    def unseal(self, text):
        return json.loads(self.security.cipher.decrypt(text.encode()) if self.security.cipher else text)

    def binding(self, key):
        with self.workflow.store.transaction() as db:
            row = db.execute("SELECT data FROM agentverse_sessions WHERE session_key=?", (key,)).fetchone()
        return self.unseal(row["data"]) if row else None

    def save(self, key, binding):
        with self.workflow.store.transaction() as db:
            db.execute("INSERT INTO agentverse_sessions VALUES(?,?) ON CONFLICT(session_key) DO UPDATE SET data=excluded.data",
                       (key, self.seal(binding)))

    def view(self, binding):
        return self.workflow.view(binding["token"], binding["room_id"])

    @staticmethod
    def gate(view):
        """Only the displayed human decision can be acted upon, even after a web edit."""
        p = view.get("private") or {}
        return {"phase": view["phase"], "round": view["discussion_round"],
                "revisions": view["event_revisions"], "session": p.get("session_ref"),
                "batch": (p.get("question_batch") or {}).get("question_batch_ref"),
                "draft": (p.get("draft") or {}).get("draft_ref"),
                "difference": (view.get("difference") or {}).get("difference_ref"),
                "candidates": {k: c["candidate_ref"] for k, c in view["candidates"].items()},
                "evaluations": {k: e["evaluation_ref"] for k, e in view["evaluations"].items()}}

    def show(self, key, binding, view=None):
        view = view if view is not None else self.view(binding)
        binding["seen"] = self.gate(view)
        self.save(key, binding)
        return self.render(view, binding)

    def handle(self, role, key, message_id, text):
        if role not in ROLES:
            raise WorkflowError("NOT_FOUND", "Unknown agent", 404)
        text = text.strip()
        if not text or len(text) > 16000:
            raise WorkflowError("INVALID_INPUT", "Send between 1 and 16000 characters")
        command, _, argument = text.partition(" ")
        command, argument = command.lower(), argument.strip()
        binding = self.binding(key)
        if command in ("/help", "help") or not binding and command not in ("/create", "/join", "/recover"):
            return ROLES[role][0] + "\n\n" + HELP
        if command in ("/create", "/join", "/recover"):
            if binding:
                return "This chat is already connected to a room. Use /status, or start a new private chat for another room."
            if command == "/create":
                parts = [v.strip() for v in argument.split("|")]
                if len(parts) != 4:
                    return "Use /create DEMO_CODE | your-name,teammate-name | project context | hours. Put yourself first."
                code, members, context, hours = parts
                names = [v.strip() for v in members.split(",")]
                if not 1 <= len(names) <= 12 or len(set(names)) != len(names) or any(not re.fullmatch(r"[\w-]{1,60}", n) for n in names):
                    return "Use 1–12 distinct member names containing letters, numbers, underscores or hyphens."
                try:
                    hours = float(hours)
                except ValueError:
                    return "Hours must be a positive number."
                if not 0 < hours <= 87600 or not context:
                    return "Provide a project context and a positive time limit."
                prepared = self.security.prepare(None, code)
                self.security.limit("agentverse:create:" + key, 2, 3600)
                self.security.limit("agentverse:create-global", 10, 86400)
                created = self.workflow.create_room({"member_ids": names, "hackathon_context": context,
                    "deadline_at": None, "constraints": []}, {
                    "max_agent_calls": self.security.room_limit, "max_task_retries": 0,
                    "search_enabled": bool(self.security.env.get("TAVILY_API_KEY")),
                    "max_search_queries": 2 if self.security.env.get("TAVILY_API_KEY") else 0,
                    "project_time_limit": {"kind": "duration", "hours": hours},
                }, provision=self.security.provision(prepared))
                joined = self.workflow.join(created["room_id"], created["invitations"][names[0]])
                binding = {"room_id": joined["room_id"], "member_id": joined["member_id"], "token": joined["token"]}
                binding["admin_token"] = created["admin_token"]
                self.save(key, binding)
                invites = "\n".join(f"{name}: /join {created['room_id']} {invite}"
                                    for name, invite in created["invitations"].items() if name != names[0])
                return (f"Created room {created['room_id']}. You are {names[0]}.\n"
                        f"Send each teammate only their own invitation:\n{invites}\n\n"
                        f"Keep this recovery command private:\n/recover {joined['room_id']} {joined['member_id']} {joined['recovery_code']}\n\n"
                        f"Room operator recovery code (keep private): {created['admin_recovery_code']}\n\n"
                        "Your interview is being prepared. Send /status to see your questions.")
            pieces = argument.split()
            self.security.limit("agentverse:join:" + key, 12, 3600)
            if command == "/join" and len(pieces) == 2:
                joined = self.workflow.join(*pieces)
            elif command == "/recover" and len(pieces) == 3:
                joined = self.workflow.recover(pieces[0], "member", pieces[1], pieces[2])
            else:
                return "Use /join ROOM_ID INVITATION or /recover ROOM_ID MEMBER_NAME RECOVERY_CODE."
            binding = {"room_id": joined["room_id"], "member_id": joined["member_id"], "token": joined["token"]}
            self.save(key, binding)
            note = (f"Keep this recovery command private:\n/recover {joined['room_id']} {joined['member_id']} {joined['recovery_code']}\n\n"
                    if joined.get("recovery_code") else "")
            return "Connected to your membership.\n" + note + self.show(key, binding)
        view = self.view(binding)
        private = view["private"]
        if command in ("/status", "/profile", "/brief", "status"):
            return self.show(key, binding, view)
        if not private:
            return "A participant membership is required. Join using your own invitation."
        if binding.get("seen") != self.gate(view):
            return "The workflow changed since the last result shown in this chat. Review the current step before acting.\n\n" + self.show(key, binding, view)
        if command in ("/edit", "/drop"):
            if private["stage"] != "awaiting_profile_approval":
                return "There is no draft awaiting your review."
            draft = private["draft"]
            local = binding.get("draft")
            if not local or local["ref"] != draft["draft_ref"]:
                local = {"ref": draft["draft_ref"], "items": copy.deepcopy(draft["content"]["items"])}
            index, _, replacement = argument.partition(" ")
            if not index.isdigit() or not 1 <= int(index) <= len(local["items"]) or command == "/edit" and not replacement.strip():
                return "Choose an item number from the displayed draft; /edit also needs replacement text."
            if command == "/drop":
                local["items"].pop(int(index) - 1)
            else:
                local["items"][int(index) - 1]["text"] = replacement.strip()
            binding["draft"] = local
            self.save(key, binding)
            return "Your draft was edited privately; nothing was approved or shared.\n\n" + self.show(key, binding, view)
        if not command.startswith("/") and private["stage"] == "awaiting_answers":
            command, argument = "/answer", text
        payload = None
        if command == "/answer" and private["stage"] == "awaiting_answers":
            questions = private["question_batch"]["questions"]
            answers = [v.strip() for v in argument.split("|")]
            if len(answers) != len(questions) or any(not a for a in answers):
                return f"Answer all {len(questions)} questions in order, separated by |. Use /answer before your answers."
            kind = "interview.answer"
            payload = {"session_ref": private["session_ref"], "question_batch_ref": private["question_batch"]["question_batch_ref"],
                       "answers": [{"question_key": q["question_key"], "text": a, "declined": False} for q, a in zip(questions, answers)]}
        elif command == "/approve" and private["stage"] == "awaiting_profile_approval":
            draft = private["draft"]
            if argument != tag(draft["draft_ref"]):
                return "Use the exact /approve command shown below, after reviewing your current draft.\n\n" + self.render(view, binding)
            local = binding.get("draft")
            items = local["items"] if local and local["ref"] == draft["draft_ref"] else draft["content"]["items"]
            kind = "profile.approve"
            approved = [{k: item[k] for k in ("item_key", "category", "text", "basis", "confidence")} for item in items]
            payload = {"draft_ref": draft["draft_ref"], "items": approved, "unknowns": draft["content"].get("unknowns", [])}
        elif command in ("/difference", "/disagree", "/choose") and view["phase"] == "awaiting_difference_answers" and argument:
            kind = "difference.answer"
            option = None
            if command == "/choose":
                option, _, argument = argument.partition("|")
                option, argument = option.strip(), argument.strip()
            if view["difference"]["content"]["answer_type"] == "binary" and command == "/difference":
                return "Choose one of the displayed options with /choose OPTION_KEY | context, or use /disagree to correct the framing."
            payload = {"difference_ref": view["difference"]["difference_ref"], "selected_option_key": option,
                       "text": argument, "disagrees_with_framing": command == "/disagree"}
        elif command == "/vote" and argument in ("converge", "diverge") and view["phase"] == "awaiting_convergence_decision":
            kind = "convergence.vote"
            payload = {"difference_ref": view["difference"]["difference_ref"], "discussion_round": view["discussion_round"],
                       "decision": argument, "reason": "Explicit participant command in ASI:One"}
        elif command in ("/accept", "/revise", "/discuss") and view["phase"] == "awaiting_review":
            candidate_tag, _, instruction = argument.partition("|")
            candidate = next((c for c in view["candidates"].values() if tag(c["candidate_ref"]) == candidate_tag.strip()), None)
            if not candidate or command != "/accept" and not instruction.strip():
                return "Use a current candidate ID:VERSION from /status, followed by | and your instructions for /revise or /discuss."
            cid = candidate["candidate_ref"]["id"]
            report = view["evaluations"].get(cid)
            if not report:
                return "This candidate is still waiting for evaluation."
            kind = "candidate.review"
            payload = {"candidate_ref": candidate["candidate_ref"], "evaluation_ref": report["evaluation_ref"],
                       "decision": {"/accept": "accept", "/revise": "minor_revision", "/discuss": "more_discussion"}[command],
                       "instructions": instruction.strip()}
        if payload is None:
            return "That action is not available at the current human decision step.\n\n" + self.render(view, binding)
        scope = {"interview.answer": "interview", "profile.approve": "interview",
                 "difference.answer": "difference", "convergence.vote": "convergence"}.get(kind)
        revision = view["event_revisions"][scope] if scope else view["event_revisions"]["review"][payload["candidate_ref"]["id"]]
        result = self.workflow.submit(binding["token"], {"contract_version": "2.0", "event_id": "asi-" + digest([key, message_id]),
            "room_id": binding["room_id"], "expected_revision": revision, "type": kind, "payload": payload})
        if result["status"] != "accepted":
            return "The workflow did not apply that action. Refresh with /status and review the current version."
        return "Your action was saved.\n\n" + self.show(key, binding)

    @staticmethod
    def render(view, binding):
        lines = [f"Considea · round {view['discussion_round']} · {view['phase']}"]
        if view.get("paused_reason"):
            lines.append("The workflow is paused: " + view["paused_reason"] + ". No approval has been inferred.")
        p = view.get("private")
        if view["phase"] == "interviewing" and p:
            if p["stage"] == "awaiting_answers":
                lines += ["Your private interview:"] + [f"{i}. {q['text']}" for i, q in enumerate(p["question_batch"]["questions"], 1)]
                lines.append("Reply with /answer and your answers in order, separated by |.")
            elif p["stage"] == "awaiting_profile_approval":
                draft = p["draft"]
                local = binding.get("draft")
                items = local["items"] if local and local["ref"] == draft["draft_ref"] else draft["content"]["items"]
                lines += ["Review before sharing with teammates:"] + [f"{i}. {item['text']}" for i, item in enumerate(items, 1)]
                lines.extend("Unknown (also shared on approval): " + u for u in draft["content"].get("unknowns", []))
                lines += ["Correct with /edit or /drop. To share exactly this draft:", "/approve " + tag(draft["draft_ref"])]
            else:
                lines.append("Waiting for the next interview result or the other members. Send /status shortly.")
        elif view["phase"] in ("awaiting_difference_answers", "awaiting_convergence_decision"):
            difference = view["difference"]["content"]
            lines += [difference["question"], difference["why_it_matters"]]
            lines.extend(f"{o['key']}: {o['label']}" for o in difference.get("options", []))
            if view["phase"] == "awaiting_difference_answers":
                if binding["member_id"] in difference["affected_member_ids"]:
                    lines.append("Answer with /choose OPTION_KEY | context." if difference["answer_type"] == "binary" else "Answer with /difference your answer.")
                    lines.append("If the question is inaccurate, use /disagree your explanation.")
                else:
                    lines.append("Waiting for the affected member(s) to answer.")
            else:
                for member, answer in view.get("answers", {}).items():
                    lines.append(f"{member}: " + (answer.get("text") or answer.get("selected_option_key") or "Answered"))
                lines.append("Every required answer has been received. Each member now chooses /vote converge or /vote diverge.")
        elif view["phase"] in ("awaiting_review", "completed"):
            selected = (view.get("selected_candidate_ref") or {}).get("id")
            for cid, c in view["candidates"].items():
                if selected and cid != selected:
                    continue
                content = c["content"]
                lines += ["", content["title"], "Candidate " + tag(c["candidate_ref"]), content["problem"], content["solution"],
                          "MVP: " + "; ".join(content["mvp_scope"])]
                lines += ["For: " + "; ".join(content.get("target_users", [])),
                          "User flow: " + " → ".join(content.get("core_flow", [])),
                          "Out of scope: " + "; ".join(content.get("out_of_scope", []))]
                lines.extend("Dependency: " + d["description"] for d in content.get("critical_dependencies", []))
                lines.extend("Tradeoff: " + t for t in content.get("tradeoffs", []))
                lines.extend("Unknown: " + u for u in content.get("unknowns", []))
                if content.get("change_summary"):
                    lines.append("Changes: " + content["change_summary"])
                report = view["evaluations"].get(cid, {}).get("content", {})
                lines.append("Evaluation: " + report.get("summary", "Pending"))
                lines.extend("Risk: " + risk for risk in report.get("risks", []))
                lines.extend("Evaluation unknown: " + u for u in report.get("unknowns", []))
                lines.extend("Suggested change: " + c for c in report.get("recommended_changes", []))
                for evidence in report.get("evidence", []):
                    if evidence.get("url"):
                        lines.append("Source: " + evidence["url"])
                if not selected:
                    lines.append("Choose /accept " + tag(c["candidate_ref"]) + ", or /revise /discuss with this reference and | instructions.")
            if selected:
                lines.append("All members accepted this version. This is the agreed project brief.")
        else:
            lines.append("The workflow is processing agent tasks. Send /status shortly to retrieve the result.")
        failed = [t for t in view.get("tasks", []) if t["status"] == "failed"]
        if failed:
            lines.append("An agent task failed. No result or agreement was fabricated; ask the room operator to inspect it.")
        return "\n".join(lines)
