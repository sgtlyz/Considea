"""Deterministic ranking for negotiate.detect.

Pipeline, each step replaceable:

1. Group approved profile items into difference categories.
2. Cluster each category by text overlap. A difference needs two clusters
   that are each backed by a member_statement from a different member.
3. If those sources were already asked and the latest human answers agree,
   drop the split. If the answers still disagree, ask what would change the
   judgment instead of repeating the same binary question.
4. Score by category impact plus a capped evidence point. Member count is
   not a term.
5. Return every legal topic, best first. An empty list means the caller
   should ask a clarification rather than invent a conflict.
"""

from .constants import CATEGORY_LABEL, DIFFERENCE_CATEGORIES, IMPACT
from .view import ordered_members, ordered_source_ids

SIMILARITY_THRESHOLD = 0.42
FOLLOWUP_BONUS = 8
CLARIFICATION_PENALTY = 25
CONFIDENCE_POINTS = {"high": 3, "medium": 2, "low": 1}


def tokens(text):
    chars = [char.lower() for char in text if char.isalnum() or "\u4e00" <= char <= "\u9fff"]
    if len(chars) < 2:
        return set(chars) or {text.strip().lower()}
    return {"".join(chars[index:index + 2]) for index in range(len(chars) - 1)}


def jaccard(left, right):
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def cluster_records(records, text_of, threshold=SIMILARITY_THRESHOLD):
    clusters = []
    for record in records:
        record_tokens = tokens(text_of(record))
        placed = False
        for cluster in clusters:
            if jaccard(record_tokens, cluster["tokens"]) >= threshold:
                cluster["records"].append(record)
                cluster["tokens"] |= record_tokens
                placed = True
                break
        if not placed:
            clusters.append({"tokens": set(record_tokens), "records": [record]})
    return clusters


def uses_cjk(text):
    cjk = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    return cjk >= 1 and cjk >= len(text) * 0.2


def clip(text, limit=80):
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1] + "…"


def language_of(text):
    return "zh" if uses_cjk(text) else "en"


def items_by_difference_category(view):
    grouped = {category: [] for category in DIFFERENCE_CATEGORIES}
    for items in view["items_by_category"].values():
        for item in items:
            grouped[item["difference_category"]].append(item)
    for items in grouped.values():
        items.sort(key=lambda item: item["source_index"])
    return grouped


def member_ids_of(cluster):
    return {record["member_id"] for record in cluster["records"] if record.get("member_id")}


def statement_clusters(items):
    statements = [item for item in items if item["basis"] == "member_statement"]
    return cluster_records(statements, lambda item: item["text"])


def support_points(items):
    best = 0
    for item in items:
        if item.get("basis") != "member_statement":
            continue
        best = max(best, CONFIDENCE_POINTS[item["confidence"]])
    return best


def historical_profile_sources(view):
    found = set()
    for record in view["history"]:
        found.update(record["profile_source_ids"])
    return found


def already_discussed(view, source_ids):
    if not view["prior_differences"] or not source_ids:
        return False
    return set(source_ids) <= historical_profile_sources(view)


def latest_answers(view):
    dated = [source for source in view["prior_answers"] if isinstance(source["discussion_round"], int)]
    if not dated:
        return []
    latest = max(source["discussion_round"] for source in dated)
    return [source for source in dated if source["discussion_round"] == latest]


def answers_converged(view):
    latest = latest_answers(view)
    authors = {source["member_id"] for source in latest if source.get("member_id")}
    if authors != set(view["member_ids"]):
        return False
    return len(cluster_records(latest, lambda source: source["text"])) == 1


def difference(category, question, answer_type, options, member_ids, why, source_ids, view):
    return {
        "kind": "difference",
        "category": category,
        "question": question,
        "answer_type": answer_type,
        "options": options,
        "affected_member_ids": ordered_members(view, member_ids),
        "why_it_matters": why,
        "source_ids": ordered_source_ids(view, source_ids),
    }


def clarification(category, question, answer_type, options, member_ids, why, source_ids, view):
    topic = difference(category, question, answer_type, options, member_ids, why, source_ids, view)
    topic["kind"] = "clarification"
    return topic


def render_split(view, category, clusters):
    texts = [cluster["records"][0]["text"] for cluster in clusters]
    lang = language_of("".join(texts))
    label = CATEGORY_LABEL[lang][category]
    people = set()
    source_ids = []
    items = []
    for cluster in clusters:
        people |= member_ids_of(cluster)
        for record in cluster["records"]:
            source_ids.append(record["source_id"])
            items.append(record)
    if lang == "zh":
        why = f"{label}不同，后面的方案会走向不同的产品。需要先确认更接近「{clip(texts[0], 40)}」还是「{clip(texts[1], 40)}」。"
    else:
        why = (
            f"A different {label} leads to a different product. "
            f"Confirm whether the team is closer to \"{clip(texts[0], 40)}\" or \"{clip(texts[1], 40)}\"."
        )
    if len(clusters) == 2:
        if lang == "zh":
            question = f"在{label}上，团队更接近哪一边：「{clip(texts[0], 60)}」，还是「{clip(texts[1], 60)}」？"
        else:
            question = f"Which {label} is closer: \"{clip(texts[0], 60)}\" or \"{clip(texts[1], 60)}\"?"
        options = [
            {"key": "side_1", "label": clip(texts[0])},
            {"key": "side_2", "label": clip(texts[1])},
        ]
        return difference(category, question, "binary", options, people, why, source_ids, view), items
    shown = "；".join(f"「{clip(text, 40)}」" for text in texts[:4]) if lang == "zh" else "; ".join(f"\"{clip(text, 40)}\"" for text in texts[:4])
    if lang == "zh":
        question = f"在{label}上，这些说法会走向不同的产品：{shown}。你更接近哪一种？如果都不是，直接写出你的条件。"
        why = f"{label}上有多种互相分叉的说法。不先选定，后面的方案会混在一起。"
    else:
        question = f"These {label} statements lead to different products: {shown}. Which is closer? If none, write your condition."
        why = f"The {label} statements fork the product. Leaving them together would mix later proposals."
    return difference(category, question, "open", [], people, why, source_ids, view), items


def statement_split(view, category, items):
    clusters = statement_clusters(items)
    if len(clusters) < 2:
        return None
    people = set()
    for cluster in clusters:
        people |= member_ids_of(cluster)
    if len(people) < 2:
        return None
    ordered = sorted(clusters, key=lambda cluster: min(record["source_index"] for record in cluster["records"]))
    topic, used = render_split(view, category, ordered)
    return topic, used


def followup_category(view, answer_members):
    best_category = "unknown"
    best_impact = -1
    for category, items in items_by_difference_category(view).items():
        split = statement_split(view, category, items)
        if split is None:
            continue
        topic, _used = split
        if set(topic["affected_member_ids"]) & answer_members and IMPACT[category] > best_impact:
            best_category = category
            best_impact = IMPACT[category]
    return best_category


def followup_topic(view):
    if answers_converged(view):
        return None
    latest = latest_answers(view)
    groups = cluster_records(latest, lambda source: source["text"])
    if len(groups) < 2:
        return None
    ordered = sorted(groups, key=lambda group: min(view["source_index"][source["source_id"]] for source in group["records"]))
    texts = [group["records"][0]["text"] for group in ordered]
    people = set()
    source_ids = []
    for group in ordered:
        people |= member_ids_of(group)
        source_ids.extend(source["source_id"] for source in group["records"])
    if len(people) < 2:
        return None
    lang = language_of("".join(texts))
    category = followup_category(view, people)
    shown = "；".join(f"「{clip(text, 40)}」" for text in texts[:3]) if lang == "zh" else "; ".join(f"\"{clip(text, 40)}\"" for text in texts[:3])
    if lang == "zh":
        question = f"上一轮的回答还没有对齐：{shown}。什么条件会让你改变这个判断？"
        why = "这个问题还挡着共同方向。先问清改变判断的条件，再决定要不要换一条路。"
    else:
        question = f"The latest answers still disagree: {shown}. What would change your judgment?"
        why = "This split still blocks a shared direction. Ask what would change the judgment before repeating the same question."
    return difference(category, question, "open", [], people, why, source_ids, view)


def as_open_clarification(view, topic):
    lang = language_of(topic["question"])
    if lang == "zh":
        question = "这个方向已经讨论过，但回答还没有对齐。你现在不能接受的条件是什么？"
        why = "避免把上一轮没答完的问题再包装成一个新的分歧。"
    else:
        question = "This direction was already discussed, and the answers are not aligned yet. What condition can you still not accept?"
        why = "Do not repackage an unfinished round as a new conflict."
    return clarification(
        topic["category"], question, "open", [], topic["affected_member_ids"], why, topic["source_ids"], view,
    )


def single_member_clarifications(view):
    topics = []
    for category, items in items_by_difference_category(view).items():
        clusters = statement_clusters(items)
        people = set()
        for cluster in clusters:
            people |= member_ids_of(cluster)
        if len(clusters) < 2 or len(people) != 1:
            continue
        texts = [cluster["records"][0]["text"] for cluster in clusters]
        source_ids = [record["source_id"] for cluster in clusters for record in cluster["records"]]
        lang = language_of("".join(texts))
        shown = "；".join(f"「{clip(text, 40)}」" for text in texts[:3]) if lang == "zh" else "; ".join(f"\"{clip(text, 40)}\"" for text in texts[:3])
        if lang == "zh":
            question = f"你的两条陈述指向不同方向：{shown}。哪一条才算数？"
            why = "同一个人的陈述互相冲突时，先由本人确认，不能把它当成团队分歧。"
        else:
            question = f"Your statements point different ways: {shown}. Which one counts?"
            why = "One member's conflicting statements need that member's confirmation before they become a team split."
        topics.append((clarification(category, question, "open", [], people, why, source_ids, view), 0))
    return topics


def inference_clarifications(view):
    topics = []
    for category, items in items_by_difference_category(view).items():
        if any(item["basis"] == "member_statement" for item in items):
            continue
        inferences = [item for item in items if item["basis"] == "agent_inference"]
        if not inferences:
            continue
        texts = [item["text"] for item in inferences[:3]]
        lang = language_of("".join(texts))
        shown = "；".join(f"「{clip(text, 40)}」" for text in texts) if lang == "zh" else "; ".join(f"\"{clip(text, 40)}\"" for text in texts)
        if lang == "zh":
            question = f"这些是推断，还不是本人确认过的说法：{shown}。哪一条确实是你的意思？"
            why = "推断不能写成团队分歧，需要本人确认后才能进入下一轮。"
        else:
            question = f"These are inferences, not confirmed statements: {shown}. Which ones are actually yours?"
            why = "An inference is not a team split until the member confirms it."
        topics.append((
            clarification(
                category, question, "open", [],
                [item["member_id"] for item in inferences],
                why,
                [item["source_id"] for item in inferences],
                view,
            ),
            0,
        ))
    return topics


def unknown_clarifications(view):
    topics = []
    for entry in view["unknowns"]:
        source_ids = [
            item["source_id"]
            for profile in view["profiles"] if profile["member_id"] == entry["member_id"]
            for item in profile["items"]
        ]
        lang = language_of(entry["text"])
        if lang == "zh":
            question = f"画像里还有没确认的内容：「{clip(entry['text'], 80)}」。这一条是否仍然成立？"
            why = "未知项还没有对应的共享陈述，需要本人核实。"
        else:
            question = f"This profile still has an unconfirmed item: \"{clip(entry['text'], 80)}\". Does it still hold?"
            why = "An unknown has no shared statement behind it yet and needs the member to check it."
        topics.append((
            clarification("unknown", question, "open", [], [entry["member_id"]], why, source_ids, view),
            0,
        ))
    return topics


def constraint_clarifications(view):
    sources_by_text = {source["text"]: source for source in view["sources"] if source["kind"] == "constraint"}
    topics = []
    for constraint in view["constraints"]:
        if constraint["acceptance"] != "disputed":
            continue
        source = sources_by_text.get(constraint["text"])
        if source is None:
            continue
        lang = language_of(constraint["text"])
        if lang == "zh":
            question = f"这条仍有争议的约束，团队是否继续保留：「{clip(constraint['text'], 80)}」？"
            why = "有争议的约束还不能当作全队硬约束。"
            options = [{"key": "keep", "label": "保留"}, {"key": "drop", "label": "不保留"}]
        else:
            question = f"Should the team keep this disputed constraint: \"{clip(constraint['text'], 80)}\"?"
            why = "A disputed constraint is not yet a confirmed team constraint."
            options = [{"key": "keep", "label": "Keep"}, {"key": "drop", "label": "Drop"}]
        topics.append((
            clarification("scope", question, "binary", options, view["member_ids"], why, [source["source_id"]], view),
            0,
        ))
    return topics


def score_topic(topic, points, bonus):
    score = IMPACT[topic["category"]] + points + bonus
    if topic["kind"] == "clarification":
        score -= CLARIFICATION_PENALTY
    return score


def scored_topics(view):
    """Return (score, topic) pairs, best first. score is not part of the wire object."""
    ranked = []
    follow = followup_topic(view)
    settled = answers_converged(view)
    for category, items in items_by_difference_category(view).items():
        split = statement_split(view, category, items)
        if split is None:
            continue
        topic, used = split
        points = support_points(used)
        if already_discussed(view, topic["source_ids"]):
            if settled or follow is not None:
                continue
            topic = as_open_clarification(view, topic)
            ranked.append((score_topic(topic, 0, 0), topic))
            continue
        ranked.append((score_topic(topic, points, 0), topic))
    if follow is not None:
        ranked.append((score_topic(follow, CONFIDENCE_POINTS["high"], FOLLOWUP_BONUS), follow))
    for topic, points in (
        single_member_clarifications(view)
        + inference_clarifications(view)
        + unknown_clarifications(view)
        + constraint_clarifications(view)
    ):
        ranked.append((score_topic(topic, points, 0), topic))
    ranked.sort(key=lambda pair: (-pair[0], pair[1]["category"], tuple(pair[1]["source_ids"]), pair[1]["question"]))
    return ranked


def rank_topics(view):
    return [topic for _score, topic in scored_topics(view)]


def choose_topic(view):
    ranked = rank_topics(view)
    return ranked[0] if ranked else None
