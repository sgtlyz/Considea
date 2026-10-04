from .constants import PROFILE_CATEGORY_TO_DIFFERENCE
from .validate import assert_detect_input


def build_detect_view(payload):
    """Read-only index of one negotiate.detect payload. Does not invent answers."""
    assert_detect_input(payload)
    room = payload["room_context"]
    shared = payload["shared_context"]
    source_index = {source["source_id"]: index for index, source in enumerate(shared["sources"])}
    items_by_category = {}
    for profile in shared["profiles"]:
        for item in profile["items"]:
            bucket = items_by_category.setdefault(item["category"], [])
            bucket.append({
                "member_id": profile["member_id"],
                "profile_ref": profile["profile_ref"],
                "item_id": item["item_id"],
                "category": item["category"],
                "difference_category": PROFILE_CATEGORY_TO_DIFFERENCE[item["category"]],
                "text": item["text"],
                "basis": item["basis"],
                "confidence": item["confidence"],
                "source_id": item["source_id"],
                "source_index": source_index[item["source_id"]],
            })
    sources = shared["sources"]

    def by_kind(kind):
        return [source for source in sources if source["kind"] == kind]

    return {
        "discussion_round": payload["discussion_round"],
        "member_ids": room["member_ids"],
        "hackathon_context": room["hackathon_context"],
        "constraints": room["constraints"],
        "profiles": shared["profiles"],
        "items_by_category": items_by_category,
        "history": shared["discussion_history"],
        "sources": sources,
        "source_index": source_index,
        "prior_differences": by_kind("difference"),
        "prior_answers": by_kind("difference_answer"),
        "convergence": by_kind("convergence_decision"),
        "reviews": by_kind("human_review"),
        "unknowns": [
            {"member_id": profile["member_id"], "text": text}
            for profile in shared["profiles"]
            for text in profile["unknowns"]
        ],
    }


def ordered_members(view, member_ids):
    wanted = set(member_ids)
    return [member_id for member_id in view["member_ids"] if member_id in wanted]


def ordered_source_ids(view, source_ids):
    wanted = set(source_ids)
    return [source["source_id"] for source in view["sources"] if source["source_id"] in wanted]


def source_ids_for_round(payload, kind):
    return [
        source["source_id"]
        for source in payload["shared_context"]["sources"]
        if source["kind"] == kind and source["discussion_round"] == payload["discussion_round"]
    ]


def fallback_clarification(payload):
    """Legal clarification used when no evidenced divergence is selected."""
    assert_detect_input(payload)
    answer_ids = source_ids_for_round(payload, "difference_answer")
    profile_ids = [
        source["source_id"]
        for source in payload["shared_context"]["sources"]
        if source["kind"] == "profile_item"
    ]
    return {
        "contract_version": "2.0",
        "difference": {
            "kind": "clarification",
            "category": "unknown",
            "question": "目前的共享资料还不足以确定一个会改变方向的分歧。哪一个条件是你仍然不能接受的？",
            "answer_type": "open",
            "options": [],
            "affected_member_ids": list(payload["room_context"]["member_ids"]),
            "why_it_matters": "没有充分证据时不能编造冲突，需要成员自己核实未知条件。",
            "source_ids": answer_ids or profile_ids,
        },
    }
