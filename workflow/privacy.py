"""Personal clarifications stay with their respondent, including historical sources."""
import copy
import json


def personal_owner(difference):
    content = (difference or {}).get("content", {})
    members = content.get("affected_member_ids", [])
    return members[0] if content.get("kind") == "clarification" and len(members) == 1 else None


def _ref_key(ref):
    return (ref or {}).get("id"), (ref or {}).get("version")


def private_sources(state):
    """Derive ownership from stored differences, including rooms created before this policy."""
    differences = {}
    sources = state["sources"]
    current = state.get("difference")
    if personal_owner(current):
        differences[_ref_key(current["difference_ref"])] = current
    for source in sources:
        if source["kind"] != "difference":
            continue
        try:
            difference = {"difference_ref": source["object_ref"], "content": json.loads(source["text"])}
        except (ValueError, TypeError):
            continue
        if personal_owner(difference):
            differences[_ref_key(source["object_ref"])] = difference
    owners = {}
    source_map = {source["source_id"]: source for source in sources}
    for difference in differences.values():
        owner = personal_owner(difference)
        for sid in difference["content"].get("source_ids", []):
            if source_map.get(sid, {}).get("member_id") == owner:
                owners[sid] = owner
    for source in sources:
        key = _ref_key(source["object_ref"])
        if source["kind"] == "difference_answer":
            try:
                key = _ref_key(json.loads(source["text"]).get("difference_ref"))
            except (ValueError, TypeError):
                continue
        elif source["kind"] != "difference":
            continue
        if key in differences:
            owners[source["source_id"]] = personal_owner(differences[key])
    return owners


def shared_context(state, member_id=None, context=None):
    context = copy.deepcopy(context if context is not None else {
        "profiles": [m["profile"] for m in state["members"].values() if m["profile"] is not None],
        "sources": state["sources"], "discussion_history": state["discussion_history"],
    })
    owners = private_sources(state)
    hidden = {sid for sid, owner in owners.items() if owner != member_id}
    context["sources"] = [s for s in context["sources"] if s["source_id"] not in hidden]
    for profile in context["profiles"]:
        profile["items"] = [item for item in profile["items"] if item["source_id"] not in hidden]
    for entry in context["discussion_history"]:
        for key in entry:
            if key.endswith("_source_ids"):
                entry[key] = [sid for sid in entry[key] if sid not in hidden]
    return context


def discussion_view(state, member_id=None):
    difference, answers = copy.deepcopy(state.get("difference")), copy.deepcopy(state["answers"])
    owner = personal_owner(difference)
    if not owner:
        return {"difference": difference, "answers": answers}
    difference["visibility"] = "private"
    if owner != member_id:
        # Keep a compatible wrapper so all members can vote using the same round/ref.
        difference["content"] = {
            "kind": "clarification", "category": "unknown", "answer_type": "open", "options": [],
            "question": "Waiting for a member's confirmation",
            "why_it_matters": "One member needs to confirm their own statements before the team can continue.",
            "affected_member_ids": [owner], "source_ids": [],
        }
        answers = {}
    else:
        content = difference["content"]
        content["why_it_matters"] = content["why_it_matters"].replace(
            "One member's conflicting statements need that member's confirmation before they become a team split.",
            "These conflicting statements need your confirmation before they become a team split.").replace(
            "同一个人的陈述互相冲突时，先由本人确认，不能把它当成团队分歧。",
            "这些相互冲突的陈述需要你先确认，才能判断是否构成团队分歧。")
    return {"difference": difference, "answers": answers}


def scope_interview(state, payload):
    """Also applied when claiming persisted tasks, so retries obey current privacy rules."""
    member_id = payload["member_id"]
    payload["shared_context"] = shared_context(state, member_id, payload["shared_context"])
    followup = payload["followup_context"]
    owner = personal_owner((followup or {}).get("difference"))
    if owner and owner != member_id:
        if payload["mode"] == "reopened":
            followup["difference"], followup["answers"] = None, []
        else:
            # Contract 2.1 requires actual answers in followup. Continue from this
            # member's own messages/profile rather than inventing a shared answer.
            payload["mode"], payload["followup_context"] = "initial", None
    return payload


def public_snapshot(state):
    shared = {key: copy.deepcopy(state[key]) for key in (
        "room_id", "revision", "discussion_round", "phase", "mode", "room_context", "config",
        "paused_reason", "calls_started", "votes", "convergence_decision", "candidates", "evaluations",
        "reviews", "candidate_history", "selected_candidate_ref")}
    shared.update(discussion_view(state))
    shared["agent_runtime"] = copy.deepcopy(state.get("agent_runtime", {}))
    shared["evaluation_details"] = copy.deepcopy(state.get("evaluation_details", {}))
    shared["shared_context"] = shared_context(state)
    shared["members"] = {mid: {"stage": m["stage"], "approved_round": m["approved_round"]}
                         for mid, m in state["members"].items()}
    return shared
