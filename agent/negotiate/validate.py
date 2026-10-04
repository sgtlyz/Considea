import re

from .constants import (
    ANSWER_TYPES,
    BASIS,
    CONFIDENCE,
    CONSTRAINT_ACCEPTANCE,
    CONSTRAINT_VERIFICATION,
    CONTRACT_VERSION,
    DATA_KEYS,
    DIFFERENCE_CATEGORIES,
    DIFFERENCE_KEYS,
    DIFFERENCE_KINDS,
    DISCUSSION_RECORD_KEYS,
    ENVELOPE_KEYS,
    PAYLOAD_KEYS,
    PROFILE_CATEGORIES,
    SOURCE_KINDS,
)

DATE_TIME = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)


class ContractError(Exception):
    """Raised when a payload or difference breaks the v2 contract."""


def fail(message):
    raise ContractError(message)


def is_object(value):
    return isinstance(value, dict)


def exact_keys(value, keys, label):
    if not is_object(value):
        fail(f"{label} must be an object")
    if set(value) != set(keys):
        fail(f"{label} has unexpected fields")


def non_empty_string(value, label):
    if not isinstance(value, str) or value == "":
        fail(f"{label} must be a non-empty string")


def visible_text(value, label):
    if not isinstance(value, str) or value.strip() == "":
        fail(f"{label} must contain text")


def string_list(value, label, minimum=0, unique=False):
    if not isinstance(value, list):
        fail(f"{label} must be an array")
    if len(value) < minimum:
        fail(f"{label} is too short")
    for item in value:
        non_empty_string(item, label)
    if unique and len(set(value)) != len(value):
        fail(f"{label} contains duplicates")


def one_of(value, allowed, label):
    if value not in allowed:
        fail(f"{label} is not allowed")


def positive_int(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        fail(f"{label} must be a positive integer")


def assert_ref(value, label):
    exact_keys(value, ("id", "version"), label)
    non_empty_string(value["id"], f"{label}.id")
    positive_int(value["version"], f"{label}.version")


def assert_room(room):
    exact_keys(room, ("member_ids", "hackathon_context", "deadline_at", "constraints"), "room_context")
    string_list(room["member_ids"], "member_ids", minimum=1, unique=True)
    if not isinstance(room["hackathon_context"], str):
        fail("hackathon_context must be a string")
    deadline = room["deadline_at"]
    if deadline is not None and (not isinstance(deadline, str) or DATE_TIME.fullmatch(deadline) is None):
        fail("deadline_at must be null or an RFC3339 date-time")
    if not isinstance(room["constraints"], list):
        fail("constraints must be an array")
    for constraint in room["constraints"]:
        exact_keys(constraint, ("constraint_id", "text", "verification", "acceptance"), "constraint")
        non_empty_string(constraint["constraint_id"], "constraint_id")
        non_empty_string(constraint["text"], "constraint.text")
        one_of(constraint["verification"], CONSTRAINT_VERIFICATION, "constraint.verification")
        one_of(constraint["acceptance"], CONSTRAINT_ACCEPTANCE, "constraint.acceptance")


def assert_source(source):
    exact_keys(source, ("source_id", "kind", "object_ref", "member_id", "discussion_round", "text"), "source")
    non_empty_string(source["source_id"], "source_id")
    one_of(source["kind"], SOURCE_KINDS, "source.kind")
    assert_ref(source["object_ref"], "source.object_ref")
    if source["member_id"] is not None:
        non_empty_string(source["member_id"], "source.member_id")
    if source["discussion_round"] is not None:
        positive_int(source["discussion_round"], "source.discussion_round")
    non_empty_string(source["text"], "source.text")


def assert_profile_item(item):
    exact_keys(item, ("item_id", "category", "text", "basis", "confidence", "source_id"), "profile item")
    non_empty_string(item["item_id"], "item_id")
    one_of(item["category"], PROFILE_CATEGORIES, "profile item category")
    non_empty_string(item["text"], "profile item text")
    one_of(item["basis"], BASIS, "basis")
    one_of(item["confidence"], CONFIDENCE, "confidence")
    non_empty_string(item["source_id"], "profile item source_id")


def assert_shared(shared, members):
    exact_keys(shared, ("profiles", "discussion_history", "sources"), "shared_context")
    for name in ("profiles", "discussion_history", "sources"):
        if not isinstance(shared[name], list):
            fail("shared_context collections must be arrays")
    source_ids = []
    for source in shared["sources"]:
        assert_source(source)
        source_ids.append(source["source_id"])
    if len(set(source_ids)) != len(source_ids):
        fail("Duplicate source IDs")
    allowed = set(source_ids)
    for profile in shared["profiles"]:
        exact_keys(profile, ("profile_ref", "member_id", "items", "unknowns"), "profile")
        assert_ref(profile["profile_ref"], "profile_ref")
        non_empty_string(profile["member_id"], "profile.member_id")
        if profile["member_id"] not in members:
            fail("Profile belongs to unknown member")
        if not isinstance(profile["items"], list) or not isinstance(profile["unknowns"], list):
            fail("profile collections must be arrays")
        for item in profile["items"]:
            assert_profile_item(item)
            if item["source_id"] not in allowed:
                fail(f"Unresolved input source: {item['source_id']}")
        for unknown in profile["unknowns"]:
            non_empty_string(unknown, "unknown")
    for record in shared["discussion_history"]:
        exact_keys(record, DISCUSSION_RECORD_KEYS, "discussion record")
        positive_int(record["discussion_round"], "discussion record round")
        for field in DISCUSSION_RECORD_KEYS[1:]:
            string_list(record[field], field, unique=True)
            for source_id in record[field]:
                if source_id not in allowed:
                    fail(f"Unresolved input source: {source_id}")


def assert_detect_input(payload):
    if not is_object(payload):
        fail("payload must be an object")
    exact_keys(payload, PAYLOAD_KEYS, "payload")
    if payload["contract_version"] != CONTRACT_VERSION:
        fail("payload.contract_version must be 2.0")
    positive_int(payload["discussion_round"], "discussion_round")
    assert_room(payload["room_context"])
    assert_shared(payload["shared_context"], set(payload["room_context"]["member_ids"]))


def assert_options(difference):
    options = difference["options"]
    if not isinstance(options, list) or len(options) > 2:
        fail("options must contain at most 2 entries")
    keys = []
    for option in options:
        exact_keys(option, ("key", "label"), "option")
        visible_text(option["key"], "option.key")
        visible_text(option["label"], "option.label")
        keys.append(option["key"])
    if len(set(keys)) != len(keys):
        fail("Duplicate answer option keys")
    if difference["answer_type"] == "binary" and len(options) != 2:
        fail("binary questions need exactly two options")
    if difference["answer_type"] == "open" and len(options) != 0:
        fail("open questions cannot include options")


def assert_detect_data(data, payload):
    assert_detect_input(payload)
    if not is_object(data):
        fail("data must be an object")
    exact_keys(data, DATA_KEYS, "data")
    if data["contract_version"] != CONTRACT_VERSION:
        fail("data.contract_version must be 2.0")
    difference = data["difference"]
    exact_keys(difference, DIFFERENCE_KEYS, "difference")
    one_of(difference["kind"], DIFFERENCE_KINDS, "kind")
    one_of(difference["category"], DIFFERENCE_CATEGORIES, "category")
    visible_text(difference["question"], "question")
    one_of(difference["answer_type"], ANSWER_TYPES, "answer_type")
    assert_options(difference)
    string_list(difference["affected_member_ids"], "affected_member_ids", minimum=1, unique=True)
    members = set(payload["room_context"]["member_ids"])
    for member_id in difference["affected_member_ids"]:
        if member_id not in members:
            fail("Unknown affected member")
    visible_text(difference["why_it_matters"], "why_it_matters")
    minimum = 1 if difference["kind"] == "difference" else 0
    string_list(difference["source_ids"], "source_ids", minimum=minimum, unique=True)
    allowed = {source["source_id"] for source in payload["shared_context"]["sources"]}
    for source_id in difference["source_ids"]:
        if source_id not in allowed:
            fail(f"Unresolved output source: {source_id}")


def explain(assert_fn):
    def wrapped(*args):
        try:
            assert_fn(*args)
        except ContractError as error:
            return str(error)
        return None

    return wrapped


explain_detect_input = explain(assert_detect_input)
explain_detect_data = explain(assert_detect_data)


def validate_detect_input(payload):
    return explain_detect_input(payload) is None


def validate_detect_data(data, payload):
    return explain_detect_data(data, payload) is None


def assert_envelope(request):
    if not is_object(request):
        fail("request must be an object")
    if request.get("schema_version") != "1.0":
        fail("schema_version must be 1.0")
    for key in ("request_id", "room_id", "operation"):
        non_empty_string(request.get(key), key)
    revision = request.get("input_revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        fail("input_revision must be a non-negative integer")
    if request["operation"] != "negotiate.detect":
        fail("Operation is not registered for this role")
    if not is_object(request.get("payload")):
        fail("payload must be an object")


def envelope_headers(request):
    if not is_object(request):
        return {key: None for key in ENVELOPE_KEYS}
    return {key: request.get(key) for key in ENVELOPE_KEYS}
