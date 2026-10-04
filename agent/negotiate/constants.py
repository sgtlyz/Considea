"""Wire enums from protocol.schema.json. Do not invent aliases."""

CONTRACT_VERSION = "2.0"

DIFFERENCE_KINDS = ("difference", "clarification")

DIFFERENCE_CATEGORIES = (
    "target_user",
    "problem",
    "product_form",
    "technical",
    "novelty_vs_utility",
    "scope",
    "risk",
    "participation",
    "unknown",
)

ANSWER_TYPES = ("binary", "open")

PROFILE_CATEGORIES = (
    "problem",
    "target_user",
    "interest",
    "skill",
    "resource",
    "desired_experience",
    "constraint",
    "tradeoff",
    "goal",
    "idea",
    "participation_condition",
)

SOURCE_KINDS = (
    "profile_item",
    "difference",
    "difference_answer",
    "convergence_decision",
    "human_review",
    "evaluation",
    "constraint",
)

BASIS = ("member_statement", "agent_inference")
CONFIDENCE = ("high", "medium", "low")
CONSTRAINT_VERIFICATION = ("supported_by_source", "team_claim", "unknown")
CONSTRAINT_ACCEPTANCE = ("proposed", "confirmed", "disputed")

PAYLOAD_KEYS = ("contract_version", "discussion_round", "room_context", "shared_context")
DATA_KEYS = ("contract_version", "difference")
DIFFERENCE_KEYS = (
    "kind",
    "category",
    "question",
    "answer_type",
    "options",
    "affected_member_ids",
    "why_it_matters",
    "source_ids",
)
DISCUSSION_RECORD_KEYS = (
    "discussion_round",
    "profile_source_ids",
    "difference_source_ids",
    "answer_source_ids",
    "convergence_source_ids",
    "review_source_ids",
)
ENVELOPE_KEYS = ("schema_version", "request_id", "room_id", "operation", "input_revision")

# Profile categories are finer than the difference question categories.
# constraint / tradeoff can be scope or risk; the ranker still reads the text.
PROFILE_CATEGORY_TO_DIFFERENCE = {
    "problem": "problem",
    "target_user": "target_user",
    "interest": "novelty_vs_utility",
    "skill": "technical",
    "resource": "technical",
    "desired_experience": "product_form",
    "constraint": "scope",
    "tradeoff": "scope",
    "goal": "novelty_vs_utility",
    "idea": "product_form",
    "participation_condition": "participation",
}

# Direction impact, not a headcount weight. A two-person user split outranks
# a four-person participation split because the category gap is larger than
# any evidence bonus the ranker is allowed to add.
IMPACT = {
    "target_user": 50,
    "problem": 48,
    "product_form": 42,
    "technical": 32,
    "novelty_vs_utility": 30,
    "risk": 28,
    "scope": 22,
    "participation": 20,
    "unknown": 16,
}

CATEGORY_LABEL = {
    "zh": {
        "target_user": "目标用户",
        "problem": "要解决的问题",
        "product_form": "产品形态",
        "technical": "技术路线",
        "novelty_vs_utility": "创新和实用性",
        "scope": "范围和复杂度",
        "risk": "风险",
        "participation": "参与条件",
        "unknown": "尚未确认的条件",
    },
    "en": {
        "target_user": "target user",
        "problem": "problem",
        "product_form": "product form",
        "technical": "technical approach",
        "novelty_vs_utility": "novelty versus utility",
        "scope": "scope",
        "risk": "risk",
        "participation": "participation",
        "unknown": "unconfirmed condition",
    },
}
