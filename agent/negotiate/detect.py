import copy

from .prompt import OUTPUT_INSTRUCTIONS, SYSTEM_PROMPT
from .rank import choose_topic
from .validate import assert_detect_data
from .view import build_detect_view, fallback_clarification


def materialize_detect_data(difference, payload):
    """Check a Difference against this request and wrap it as negotiate.detect data."""
    data = {"contract_version": "2.0", "difference": copy.deepcopy(difference)}
    assert_detect_data(data, payload)
    return data


def model_prompt():
    return f"{SYSTEM_PROMPT}\n{OUTPUT_INSTRUCTIONS}"


def detect_difference(payload, complete=None):
    """Select one discussion item.

    complete(prompt, payload) -> data dict, when a model call is injected.
    Without it, rank_topics supplies the difference. No evidenced split
    becomes a clarification; this function does not write a human answer.
    """
    if complete is not None:
        data = complete(model_prompt(), payload)
        assert_detect_data(data, payload)
        return {"status": "ok", "data": data, "warnings": []}
    view = build_detect_view(payload)
    topic = choose_topic(view)
    if topic is None:
        data = fallback_clarification(payload)
        warnings = ["No evidenced divergence; human clarification required."]
    else:
        data = materialize_detect_data(topic, payload)
        warnings = []
    assert_detect_data(data, payload)
    return {"status": "ok", "data": data, "warnings": warnings}
