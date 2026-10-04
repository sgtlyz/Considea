"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    $$ = (s) => [...document.querySelectorAll(s)];
  const storage = {
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        sessionStorage.setItem(k, v);
      } catch {}
    },
    remove(k) {
      try {
        sessionStorage.removeItem(k);
      } catch {}
    },
  };
  const preference = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };
  function parse(value, fallback) {
    try {
      return JSON.parse(value) ?? fallback;
    } catch {
      return fallback;
    }
  }
  let lang = preference.get("considea-study-lang") === "zh" ? "zh" : "en";
  let auth = parse(storage.get("conclave-auth"), null),
    snapshot = null,
    currentView = "studio",
    selectedCandidate = null;
  if (!auth?.room_id || !auth?.token) auth = null;
  let draft = Object.create(null),
    busy = false,
    refreshSequence = 0,
    streamController = null,
    streamKey = null;
  const tr = (en, zh) => (lang === "zh" ? zh : en);
  const stateNames = {
    interviewing: ["Private interviews", "私人访谈"],
    detecting_difference: ["Finding the difference", "梳理分歧"],
    awaiting_difference_answers: ["Waiting for answers", "等待分歧回答"],
    awaiting_convergence_decision: ["Your team decides", "等待成员选择"],
    idea_generating: ["Generating directions", "生成候选"],
    evaluating: ["Evaluating directions", "评估候选"],
    awaiting_review: ["Ready for your review", "等待审阅"],
    revising: ["Revising the direction", "修改候选"],
    completed: ["Agreed by the team", "已完成"],
    ended: ["Session ended", "已结束"],
    queued_turn: ["Preparing questions", "准备问题"],
    awaiting_answers: ["Answer privately", "等待回答"],
    queued_summary: ["Preparing summary", "整理画像"],
    awaiting_profile_approval: ["Review your summary", "等待批准共享"],
    approved: ["Summary shared", "已确认"],
    queued: ["Queued", "排队中"],
    running: ["Running", "进行中"],
    failed: ["Needs attention", "失败"],
    stale: ["Superseded", "已过期"],
    cancelled: ["Cancelled", "已取消"],
    done: ["Done", "已完成"],
    accept: ["Accept", "接受"],
    minor_revision: ["Small revision", "小改"],
    more_discussion: ["Another discussion round", "加一轮"],
    converge: ["Ready to generate", "同意进入生成"],
    diverge: ["Keep exploring", "继续讨论"],
  };
  Object.assign(stateNames, {"problem": ["Problem", "问题"], "target_user": ["Target users", "目标用户"], "interest": ["Interest", "兴趣"], "skill": ["Skill", "技能"], "resource": ["Resource", "资源"], "desired_experience": ["Desired experience", "希望获得的体验"], "constraint": ["Constraint", "限制条件"], "tradeoff": ["Trade-off", "取舍"], "goal": ["Goal", "目标"], "idea": ["Idea", "想法"], "participation_condition": ["Participation conditions", "参与条件"], "high": ["High confidence", "把握较高"], "medium": ["Medium confidence", "把握一般"], "low": ["Low confidence", "有待确认"], "interview.turn": ["Preparing interview questions", "准备访谈问题"], "interview.summarize": ["Preparing your summary", "整理访谈总结"], "negotiate.detect": ["Finding a topic to discuss", "梳理待讨论问题"], "idea.generate": ["Developing project directions", "生成项目方向"], "idea.revise": ["Revising the project", "修改项目方案"], "evaluator.evaluate": ["Checking evidence and feasibility", "查证与评估可行性"], "verified": ["Tested", "已经测试"], "supported_by_source": ["Supported by a source", "有资料支持"], "documented_support": ["Supported by documentation", "有文档支持"], "team_claim": ["Reported by the team", "团队提供的信息"], "needs_test": ["Needs a test", "仍需测试"], "unknown": ["Not yet known", "尚不明确"], "self_reported_implemented": ["Implementation reported by its authors", "作者表示已实现"], "planned": ["Planned", "计划中"], "results": ["Sources found", "找到资料"], "no_results": ["No sources found", "未找到资料"], "disabled": ["Research disabled", "未开启检索"], "profile_item": ["Approved summary", "已确认的总结"], "difference": ["Discussion topic", "讨论问题"], "difference_answer": ["Member answer", "成员回答"], "convergence_decision": ["Team decision", "团队决定"], "human_review": ["Member review", "成员审阅"], "evaluation": ["Evaluation", "评估记录"]});
  const label = (key) => (stateNames[key] ? tr(...stateNames[key]) : tr(key || "Unspecified", "未说明"));
  function el(tag, text, parent, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    if (parent) parent.append(n);
    return n;
  }
  function note(text, parent) {
    return el("p", text, parent, "notice");
  }
  const translationCache = new Map(), translationQueue = new Set(), translationFailures = new Set();
  let translationRunning = false, translationTimer = null, missingTranslation = false;
  function displayText(value) {
    const text = typeof value === "string" ? value : "";
    if (!(lang === "zh" ? /[A-Za-z]/ : /[\u3400-\u9fff]/u).test(text)) return text;
    const key = JSON.stringify([lang, text]);
    if (translationCache.has(key)) return translationCache.get(key);
    missingTranslation = true;
    if (!translationFailures.has(key)) translationQueue.add(key);
    return translationFailures.has(key) ? tr("English content is temporarily unavailable", "中文内容暂时无法加载") : tr("Preparing English content…", "正在准备中文内容……");
  }
  function applyTranslationState() {
    const view=$(currentView+"-view");
    if (!view || !snapshot) return;
    for (const input of view.querySelectorAll("textarea, select, [data-action]"))
      input.disabled = busy || missingTranslation;
    $("translation-status")?.remove();
    if (missingTranslation) {
      const status=el("div",undefined,$("status"),"notice");status.id="translation-status";status.setAttribute("role","status");
      el("p",translationFailures.size ? tr("Some content could not be translated. Your original content and drafts are preserved.", "部分中文内容未能加载，原始内容和已填答案仍然保留。") : tr("Preparing English content, please wait…", "正在准备中文内容，请稍候……"),status);
      if (translationFailures.size) action(tr("Retry translation", "重新加载中文内容"),status,async()=>{
        translationFailures.clear();render(snapshot);
      },"quiet-button");
    }
  }
  function scheduleTranslations() {
    applyTranslationState();
    if (!auth || translationRunning || translationTimer || !translationQueue.size) return;
    translationTimer=setTimeout(async()=>{
      translationTimer=null;
      if(!auth || translationRunning) return;
      const language=lang, texts=[];let size=0;
      for(const key of translationQueue){
        const [target,text]=JSON.parse(key);
        if(target!==language){translationQueue.delete(key);continue;}
        if(texts.length && (size+text.length>3200 || texts.length===8)) break;
        texts.push(text);size+=text.length;translationQueue.delete(key);
      }
      if(!texts.length)return;
      const actor={...auth};translationRunning=true;
      try {
        const result=await api("/rooms/"+actor.room_id+"/translations",{texts,language},actor.token,100000);
        if(auth?.token===actor.token) for(const item of result.translations) translationCache.set(JSON.stringify([language,item.source]),item.text);
      } catch {
        if(auth?.token===actor.token) for(const text of texts) translationFailures.add(JSON.stringify([language,text]));
      } finally {
        translationRunning=false;
        if(auth?.token===actor.token && snapshot) render(snapshot);
        scheduleTranslations();
      }
    },80);
  }
  function listSection(title, items, parent) {
    if (!items?.length) return;
    el("h3", title, parent);
    const list = el("ul", undefined, parent, "record-list");
    for (const item of items) el("li", displayText(item), list);
  }
  function textLine(text, parent) { if (text) el("p", displayText(text), parent); }
  function reviewRecord(review, parent) {
    const card = el("article", undefined, parent, "record-card");
    el("strong", review.member_id + " · " + label(review.decision), card);
    textLine(review.instructions || review.reason, card);
  }
  function candidateRecord(c, parent) {
    listSection(tr("How it works", "使用流程"), c.core_flow, parent);
    listSection(tr("Outside the first version", "首版暂不包含"), c.out_of_scope, parent);
    listSection(tr("Dependencies", "所需条件"), (c.critical_dependencies || []).map(x => x.description), parent);
    listSection(tr("Contributions", "方案来源与贡献"), (c.contributions || []).map(x => x.description), parent);
    listSection(tr("Trade-offs", "取舍"), c.tradeoffs, parent);
    listSection(tr("Still to clarify", "待确认事项"), c.unknowns, parent);
    if (c.change_summary) { el("h3", tr("What changed", "本次修改"), parent); textLine(c.change_summary, parent); }
  }
  function evaluationRecord(report, parent) {
    for (const finding of report.findings || report.technical_checks || []) {
      const card = el("article", undefined, parent, "record-card");
      el("strong", label(finding.conclusion), card);
      textLine(finding.finding, card);
      if (finding.next_check) { el("small", tr("Next check", "下一步验证"), card); textLine(finding.next_check, card); }
    }
    for (const project of report.similar_projects || report.competitors || []) {
      const card = el("article", undefined, parent, "record-card");
      el("h3", displayText(project.name), card);
      listSection(tr("Similarities", "相似之处"), [].concat(project.overlap || []), card);
      listSection(tr("Differences", "不同之处"), [].concat(project.differences || []), card);
      el("small", label(project.maturity), card);
      renderSources([{title:project.name,url:project.url}],card);
    }
    for (const item of report.evidence || []) {
      const card = el("article", undefined, parent, "record-card");
      el("strong", displayText(item.title), card);
      textLine(item.claim || item.excerpt, card);
      textLine(item.limitation, card);
      renderSources([item],card);
    }
    for (const search of report.search_log || []) {
      const card = el("article", undefined, parent, "record-card");
      textLine(search.query,card);el("small",label(search.result_status),card);
    }
    for (const check of Object.values(report.tests || {})) {
      listSection(tr("Required changes", "需要调整"),check.required_changes,parent);
      listSection(tr("Missing information", "需要补充的信息"),check.missing_information,parent);
    }
    listSection(tr("Unverified assumptions", "尚未验证的假设"), report.unverified_assumptions, parent);
  }
  function sourceRecord(source, parent, sources = []) {
    const card = el("article", undefined, parent, "record-card");
    el("strong", [source.member_id, label(source.kind)].filter(Boolean).join(" · "),card);
    const value = parse(source.text, null);
    if (source.kind === "difference" && value) {
      textLine(value.question,card);textLine(value.why_it_matters,card);
      listSection(tr("Perspectives", "不同选项"),(value.options||[]).map(o=>o.label),card);
    } else if (source.kind === "difference_answer" && value) {
      const topic = sources.find(x => x.kind === "difference" && x.object_ref?.id === value.difference_ref?.id && x.object_ref?.version === value.difference_ref?.version);
      const option = parse(topic?.text,null)?.options?.find(x => x.key === value.selected_option_key);
      if (option) textLine(option.label,card);
      textLine(value.text,card);
      if (value.disagrees_with_framing) el("small",tr("The member questioned the wording.","该成员认为问题表述不准确。"),card);
    } else if (source.kind === "convergence_decision" && value) {
      for (const vote of Object.values(value)) reviewRecord(vote,card);
    } else if (source.kind === "human_review" && value) reviewRecord({member_id:source.member_id,...value},card);
    else if (source.kind === "evaluation" && value) textLine(value.summary,card);
    else if (value && typeof value === "object") {
      // Unknown structured records must not expose storage JSON in the conversation.
      for (const key of ["text","summary","description","reason"]) if (typeof value[key] === "string") textLine(value[key],card);
      if (card.children.length === 1) el("p",tr("Saved team record.","已保存的团队记录。"),card);
    } else textLine(source.text,card);
  }
  function renderDetail(value, parent, key) {
    if (key === "private-history" || key === "access-private-history") {
      const messages = el("div",undefined,parent,"conversation-history");
      for (const m of value) {
        const item=el("article",undefined,messages,"conversation-message");item.dataset.role=m.role;
        el("strong",m.role === "user" ? tr("You","你") : tr("Interview guide","访谈助手"),item);
        const answer=m.role === "user" && m.content.includes("\nAnswer: ") ? m.content.split("\nAnswer: ").slice(1).join("\nAnswer: ") : m.content;
        if(answer === "[declined]") el("p",tr("You chose not to answer this question.","你选择暂不回答这个问题。"),item);
        else textLine(answer,item);
      }
    } else if (key === "shared-history") {
      const rounds=[...new Set(value.sources.map(x=>x.discussion_round))];
      for (const round of rounds) {
        el("h3", round ? tr("Round "+round,"第 "+round+" 轮") : tr("Team context","团队背景"),parent);
        for (const source of value.sources.filter(x=>x.discussion_round===round)) sourceRecord(source,parent,value.sources);
      }
    } else if (key === "candidate-history") {
      for (const history of value) for (const [id,c] of Object.entries(history.candidates)) {
        const card=el("article",undefined,parent,"record-card");
        el("h3",displayText(c.content.title),card);el("small",tr("Version ","版本 ")+c.candidate_ref.version,card);
        textLine(c.content.solution,card);candidateRecord(c.content,card);
        if(history.evaluations[id]) evaluationRecord(history.evaluations[id].content,card);
        for(const r of Object.values(history.reviews[id]||{})) reviewRecord(r,card);
      }
    } else if (key === "final-output") {
      candidateRecord(value.candidate.content,parent);
      evaluationRecord(value.evaluation.content,parent);
      for(const r of value.human_reviews || [])reviewRecord(r,parent);
    } else if (key.startsWith("candidate-")) candidateRecord(value,parent);
    else if (key.startsWith("report-") || key.startsWith("native-report-")) evaluationRecord(value,parent);
    if (!parent.children.length) el("p",tr("No additional records yet.","暂时没有更多记录。"),parent,"muted");
  }
  function detail(title, value, parent, key = title) {
    const d=el("details",undefined,parent);d.dataset.detail=key;
    el("summary",title,d);
    const body=el("div",undefined,d,"readable-details");
    d.addEventListener("toggle",()=>{
      if(d.open && !body.children.length) {renderDetail(value,body,key);scheduleTranslations();}
    });
    return d;
  }
  function showError(e) {
    const errors = {UNAUTHORIZED:"请使用你自己的邀请或恢复码重新加入房间。", INVALID_INPUT:"请检查填写的信息后重试。", STALE_INPUT:"房间已进入新的阶段，请刷新后重试。", ACCESS_CODE_REQUIRED:"请输入团队访问码，或选择使用自己的服务密钥。", RATE_LIMITED:"操作较频繁，请稍后重试。", ROOM_KEYS_REQUIRED:"请管理员补充房间密钥后继续。", TRANSLATION_UNAVAILABLE:"中文内容暂时无法加载，请稍后重试。", BUDGET_LIMIT:"当前调用额度不足，请管理员检查房间额度。"};
    const message=e?.message || String(e);
    $("error").textContent = lang === "zh" && /[a-z]/i.test(message) && !/[\u3400-\u9fff]/u.test(message)
      ? errors[e?.code] || "操作暂未完成。你的进度仍然保留，请检查连接后重试。" : message;
    $("error").hidden = false;
  }
  function clearError() {
    $("error").hidden = true;
    $("error").textContent = "";
  }
  function action(text, parent, fn, cls = "primary-button") {
    const b = el("button", text, parent, cls);
    b.type = "button";
    b.dataset.action = "true";
    b.disabled = busy;
    b.onclick = () => run(fn);
    return b;
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    $$("[data-action]").forEach((b) => (b.disabled = true));
    clearError();
    try {
      await fn();
    } catch (e) {
      showError(e);
    } finally {
      busy = false;
      $$("[data-action]").forEach((b) => (b.disabled = false));
      applyTranslationState();
    }
  }
  function bind(id, fn) {
    const b = $(id);
    b.dataset.action = "true";
    b.onclick = () => run(fn);
  }
  const draftKey = () =>
    auth ? "considea-drafts:" + auth.room_id + ":" + auth.token : null;
  function persist() {
    if (auth) storage.set(draftKey(), JSON.stringify(draft));
  }
  const group = (kind, ref) => JSON.stringify([kind, ref]);
  function field(tag, title, parent, key, value = "", type) {
    const wrapper = el("label", title, parent);
    const n = el(tag, undefined, wrapper);
    if (type) n.type = type;
    n.dataset.field = key;
    n.value = Object.hasOwn(draft, key) ? draft[key] : value;
    return n;
  }
  function remember(e) {
    const n = e.target;
    if (!n.dataset.field) return;
    draft[n.dataset.field] = n.type === "checkbox" ? n.checked : n.value;
    persist();
  }
  document.addEventListener("input", remember);
  document.addEventListener("change", remember);
  function clearDraft(prefix) {
    for (const k of Object.keys(draft))
      if (k.startsWith(prefix + "|")) delete draft[k];
    persist();
  }
  function timeLimitInput(parent, allowLater = false, key = "project-time") {
    const select = field(
      "select",
      tr("Project time limit", "项目时限"),
      parent,
      key + "|kind",
    );
    select.setAttribute("aria-label", tr("Project time limit", "项目时限"));
    const values = [
      [
        "",
        allowLater
          ? tr("Administrator will add it later", "稍后由管理员补充")
          : tr("Choose a time limit", "请选择"),
      ],
      ["none", tr("No time limit", "无时间限制")],
      ["duration", tr("Available hours", "可用小时数")],
      ["deadline", tr("Deadline", "截止时间")],
    ];
    for (const [value, text] of values)
      el("option", text, select).value = value;
    select.value = draft[key + "|kind"] || "";
    const hours = field(
      "input",
      tr("Available hours", "可用小时数"),
      parent,
      key + "|hours",
      "",
      "number",
    );
    hours.min = "0.1";
    hours.max = "87600";
    hours.step = "any";
    const deadline = field(
      "input",
      tr("Deadline (your local time)", "截止时间（本地时区）"),
      parent,
      key + "|deadline",
      "",
      "datetime-local",
    );
    function visibility() {
      hours.parentElement.hidden = select.value !== "duration";
      deadline.parentElement.hidden = select.value !== "deadline";
    }
    select.addEventListener("change", visibility);
    visibility();
    return () => {
      if (!select.value) {
        if (allowLater) return null;
        throw Error(tr("Choose a project time limit.", "请选择项目时限。"));
      }
      if (select.value === "none") return { kind: "none" };
      if (select.value === "duration") {
        const h = Number(hours.value);
        if (!(h > 0 && h <= 87600))
          throw Error(
            tr("Enter valid available hours.", "请输入有效的可用小时数。"),
          );
        return { kind: "duration", hours: h };
      }
      if (
        !deadline.value ||
        !Number.isFinite(new Date(deadline.value).getTime())
      )
        throw Error(tr("Choose a valid deadline.", "请选择有效截止时间。"));
      return {
        kind: "deadline",
        deadline_at: new Date(deadline.value).toISOString(),
      };
    };
  }
  async function api(path, body, token = auth?.token, timeoutMs = 30000) {
    const r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data;
    try {
      data = await r.json();
    } catch {
      throw Error(
        tr(
          "The server did not respond normally. Try again.",
          "服务器未正常响应，请重试。",
        ),
      );
    }
    if (!r.ok) {
      const e = Error(
        (data.error?.code ? data.error.code + ": " : "") +
          (data.error?.message ||
            tr("Could not complete this action.", "操作未完成。")),
      );
      e.status = r.status; e.code = data.error?.code;
      throw e;
    }
    return data;
  }
  function openHome() {
    persist();
    $("workspace").hidden = true;
    $("landing").hidden = false;
    $("cover-about").hidden = false;
    window.consideaAtmosphere?.home();
    history.replaceState(null,"",location.pathname+location.search+"#home");
    scrollTo(0,0);
    $("cover-title").focus({preventScroll:true});
  }
  $$("[data-home]").forEach(link=>link.onclick=event=>{event.preventDefault();openHome();});
  function openWorkspace() {
    storage.set("considea-test-login", "1");
    $("landing").hidden = true;
    $("cover-about").hidden = true;
    $("workspace").hidden = false;
    window.consideaAtmosphere?.enter();
    if (location.hash)
      history.replaceState(null, "", location.pathname + location.search);
  }
  $$("[data-demo-login]").forEach(
    (b) =>
      (b.onclick = () => {
        openWorkspace();
        $("desk").focus();
        scrollTo(0, 0);
      }),
  );
  function needsInterview(v = snapshot) {
    return !!(v?.actor.member_id && v.phase === "interviewing" && v.private?.stage !== "approved");
  }
  function nextView(v = snapshot) {
    return v?.final_output ? "brief" : needsInterview(v) ? "interview" : "studio";
  }
  function setView(next) {
    if (snapshot && next !== currentView && next !== nextView()) return;
    currentView = next;
    for (const id of ["interview", "studio", "brief"])
      $(id + "-view").hidden = id !== next;
    document.querySelector(".primary-nav").hidden = !snapshot;
    $$("[data-view]").forEach((item) => {
      if (item.dataset.view === next) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }
  function openWorkflowStep(next) {
    if (!snapshot || next !== nextView()) return;
    setView(next);
    render(snapshot);
    const view = $(next + "-view");
    view.focus({ preventScroll: true });
    view.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function openPrivateInterview() { openWorkflowStep("interview"); }
  function setEntryMode(mode, focus = false) {
    const join = mode === "join";
    $("start-panel").hidden = join;
    $("join-panel").hidden = !join;
    storage.set("considea-entry-mode", join ? "join" : "start");
    if (focus) {
      $(join ? "roomId" : "memberIds").focus();
      $("entry").scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  $("show-join").onclick = () => setEntryMode("join", true);
  $("show-start").onclick = () => setEntryMode("start", true);
  function theme(value) {
    document.documentElement.dataset.theme = value;
    preference.set("considea-study-theme", value);
    $$("[data-theme-choice]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.themeChoice === value)),
    );
    window.consideaAtmosphere?.theme();
  }
  $$("[data-theme-choice]").forEach(
    (b) => (b.onclick = () => theme(b.dataset.themeChoice)),
  );
  let createTimeLimit;
  function translate() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = tr("considea — Find a shared direction", "considea · 一起找到方向");
    $$("[data-aria-en]").forEach(n => n.setAttribute("aria-label",lang === "zh" ? n.dataset.ariaZh : n.dataset.ariaEn));
    $$("[data-en]").forEach(
      (n) => (n.textContent = lang === "zh" ? n.dataset.zh : n.dataset.en),
    );
    $$("[data-language]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.language === lang)),
    );
    window.consideaAtmosphere?.language(lang);
    $("projectTime").replaceChildren();
    createTimeLimit = timeLimitInput($("projectTime"), true, "create-time");
    renderConnection();
    renderCreateAccess();
    if (snapshot) render(snapshot);
    if (createdRoom) renderCredentials(createdRoom);
  }
  $$("[data-language]").forEach(
    (b) =>
      (b.onclick = () => {
        lang = b.dataset.language;
        preference.set("considea-study-lang", lang);
        translate();
      }),
  );
  let capabilities = null;
  function passwordInput(parent, title, id) {
    const wrapper = el("label", title, parent);
    const input = el("input", undefined, wrapper);
    input.type = "password";
    input.autocomplete = "off";
    input.id = id;
    return input;
  }
  function downloadText(name, text) {
    const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
    const a=el("a");a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function accessCard(parent, title, fields, fileName, introduction) {
    const card=el("section",undefined,parent,"access-card");
    el("h3",title,card);el("p",introduction,card,"muted");
    const data=el("dl",undefined,card);
    for(const [name,value] of fields){el("dt",name,data);el("dd",value,data);}
    const text=[title,introduction,"",...fields.map(([name,value])=>name+": "+value)].join("\n");
    const row=el("div",undefined,card,"card-actions");
    action(tr("Copy card","复制卡片内容"),row,()=>copyText(text,card),"quiet-button");
    action(tr("Save a text copy","保存文字副本"),row,()=>downloadText(fileName,text),"quiet-button");
    return card;
  }
  function modelKeyFields(parent, prefix) {
    const provider = el("select", undefined, el("label", tr("Model provider", "模型供应商"), parent));
    provider.id = prefix + "-provider";
    el("option", "DeepSeek", provider).value = "deepseek";
    el("option", "OpenAI", provider).value = "openai";
    const deepseek = passwordInput(parent, tr("DeepSeek API key", "深度求索服务密钥"), prefix + "-deepseek");
    const openai = passwordInput(parent, tr("OpenAI API key", "OpenAI 服务密钥"), prefix + "-openai");
    const model = el("input", undefined, el("label", tr("OpenAI model", "OpenAI 模型"), parent));
    model.id = prefix + "-model";
    model.autocomplete = "off";
    model.placeholder = "e.g. gpt-4.1-mini";
    model.value = capabilities?.openai_model || "";
    provider.onchange = () => {
      const useOpenAI = provider.value === "openai";
      deepseek.parentElement.hidden = useOpenAI;
      openai.parentElement.hidden = !useOpenAI;
      model.parentElement.hidden = !useOpenAI;
      // Clear inactive credentials when switching providers.
      if (useOpenAI) deepseek.value = ""; else openai.value = "";
    };
    provider.onchange();
  }
  function modelCredentials(prefix) {
    const provider = $(prefix + "-provider").value;
    const credentials = {provider, tavily_api_key: $(prefix + "-tavily").value.trim()};
    credentials[provider + "_api_key"] = $(prefix + "-" + provider).value.trim();
    if (provider === "openai") credentials.model = $(prefix + "-model").value.trim();
    return credentials;
  }
  function clearModelKeys(prefix) {
    for (const suffix of ["deepseek", "openai", "tavily"]) $(prefix + "-" + suffix).value = "";
  }
  function invitationUrl(room, invitation) {
    const url = new URL(location.origin + location.pathname);
    url.hash = new URLSearchParams({room, invitation}).toString();
    return url.href;
  }
  async function copyText(text, parent) {
    try { await navigator.clipboard.writeText(text); note(tr("Copied. Share privately.", "已复制，请私下分享。"), parent); }
    catch { const input = el("textarea", text, parent); input.readOnly = true; input.select(); }
  }
  function renderCreateAccess() {
    const saved=Object.fromEntries(["funding","demo-code","create-provider","create-model","create-deepseek","create-openai","create-tavily"].map(id=>[id,$(id)?.value]));
    const out = $("create-access"); out.replaceChildren();
    if (!capabilities?.live) return;
    const select = el("select", undefined, el("label", tr("How will this room use AI?", "房间如何调用智能助手？"), out));
    select.id = "funding";
    el("option", tr("Team demo access code", "团队演示访问码"), select).value = "team";
    const own = el("option", tr("My API keys", "使用我的服务密钥"), select); own.value = "own";
    own.disabled = !capabilities.own_keys_supported;
    const code = passwordInput(out, tr("Demo access code", "演示访问码"), "demo-code");
    const keys = el("div", undefined, out); keys.id = "create-key-fields";
    modelKeyFields(keys, "create");
    passwordInput(keys,tr("Tavily API key (required for web research)","网页检索服务密钥（检索时必填）"),"create-tavily");
    note(tr("Your keys pay for this room. They are encrypted on the server and are not saved in browser storage. You can replace or remove them later.","你的密钥为此房间付费，在服务器加密保存，不写入浏览器存储，可随时替换或删除。"),keys);
    select.onchange = () => { keys.hidden = select.value !== "own"; code.parentElement.hidden = select.value !== "team"; };
    if (!capabilities.shared_demo_available && capabilities.own_keys_supported) select.value = "own";
    for(const [id,value] of Object.entries(saved)) if(value !== undefined && $(id)) $(id).value=value;
    $("create-provider").onchange();
    select.onchange();
  }
  function creationAccess() {
    if (!capabilities) throw Error(tr("The workspace is connecting. Wait a moment and try again.","工作区正在连接，请稍后重试。"));
    if (!capabilities.live) return {};
    return $("funding").value === "own"
      ? {credentials:modelCredentials("create")}
      : {access_code:$("demo-code").value.trim()};
  }
  function renderConnection() {
    if (!capabilities) { $("connection-status").textContent=tr("Connecting to the workspace…","正在连接工作区，请稍候……"); return; }
      $("connection-status").textContent = capabilities.live
        ? tr("Live workspace · AI responses use real API calls. Start with a demo access code or your own keys.","真实运行 · 将调用真实模型服务。使用演示访问码或自己的密钥开始。")
        : tr("Practice workspace · Responses are simulated; no API usage.","练习模式 · 回答为模拟数据，不消耗模型服务。");
  }
  async function loadCapabilities() {
    try {
      capabilities = await api("/capabilities",undefined,null);
      renderConnection();
      renderCreateAccess();
    } catch {
      const out = $("connection-status"); out.textContent = tr("The server is waking up or unavailable. Your saved session is kept.","服务器正在唤醒或暂时不可用，已保存的会话仍然保留。");
      action(tr("Try connecting again","重新连接"),out,loadCapabilities,"quiet-button");
    }
  }
  async function showRecoveryCard() {
    if(!auth.recovery_code){const r=await api("/rooms/"+auth.room_id+"/recovery-code",{});auth.recovery_code=r.recovery_code;storage.set("conclave-auth",JSON.stringify(auth));}
    const out=$("recovery-card");out.replaceChildren();out.hidden=false;
    accessCard(out,tr("Your private recovery card","你的私人恢复卡"),[
      [tr("Room","房间编号"),auth.room_id],
      [tr("Role","身份"),snapshot.actor.role === "admin" ? tr("Administrator","管理员") : tr("Participant","成员")],
      ...(snapshot.actor.member_id ? [[tr("Member","成员代号"),snapshot.actor.member_id]] : []),
      [tr("Recovery code","恢复码"),auth.recovery_code],
    ],"considea-recovery.txt",tr("Keep this card private. Use its room and recovery code under Join your team to restore access. A new code replaces the previous one.","请私下保管。在“加入你的团队”中输入房间编号和恢复码即可恢复访问。新恢复码会替代旧码。"));
  }
  function renderRoomAccess(v) {
    const out = $("room-access"), identity = v.room_id + ":" + v.actor.role + ":" + (v.actor.member_id || "") + ":" + lang;
    if (out.dataset.identity !== identity) {
      const keyDraft=Object.fromEntries(["provider","model","deepseek","openai","tavily"].map(key=>[key,$("room-"+key)?.value]));
      out.dataset.identity = identity; out.replaceChildren();
      el("p",tr("Your access","你的访问权限"),out,"tag");
      note(tr("Keep a private recovery card so you can return to this room.","保存私人恢复卡，方便之后回到这个房间。"),out);
      action(tr("View my recovery card","查看我的恢复卡"),out,showRecoveryCard,"quiet-button");
      const recovery=el("div",undefined,out);recovery.id="recovery-card";recovery.hidden=true;
      const history=el("div",undefined,out);history.id="access-history";
      if (v.actor.role === "admin") {
        el("h3",tr("Invite your team","邀请团队"),out);
        const invites=el("div",undefined,out);invites.id="invite-members";
        el("h3",tr("Room API keys","房间服务密钥"),out);
        el("p","",out).id="key-status";
        if (v.access?.own_keys_supported) {
          modelKeyFields(out, "room");
          passwordInput(out,tr("Tavily API key","网页检索服务密钥"),"room-tavily");
          for(const [key,value] of Object.entries(keyDraft)) if(value !== undefined) $("room-"+key).value=value;
          $("room-provider").onchange();
          note(tr("Saved keys are never shown again. These keys fund the whole room.","已保存的密钥不再显示，将用于整个房间。"),out);
          action(tr("Save room keys","保存房间密钥"),out,async()=>{
            await api("/rooms/"+auth.room_id+"/keys",{credentials:modelCredentials("room")});
            clearModelKeys("room");await refresh(true);
          });
          action(tr("Remove room keys and pause","删除房间密钥并暂停"),out,async()=>{
            if (!confirm(tr("Remove the saved keys? New AI calls will pause until replacement keys are entered.","删除已保存的密钥？新的调用会暂停，直到输入替换密钥。"))) return;
            await api("/rooms/"+auth.room_id+"/keys",{credentials:null});clearModelKeys("room");await refresh(true);
          },"quiet-button");
        }
      }
    }
    const history=$("access-history");history.replaceChildren();
    if(v.private) detail(tr("Your private conversation history","查看自己的私人问答"),v.private.messages,history,"access-private-history");
    if (v.actor.role === "admin") {
      $("key-status").textContent = v.access?.funding === "own"
        ? (v.access.keys_configured ? tr("Using your room keys · encrypted","正在使用房间密钥，已加密保存") : tr("Room keys removed · add keys to continue","房间密钥已删除，请补充后继续"))
        : tr("Team demo · no cumulative request limit", "团队演示 · 无累计请求次数上限");
      const invites=$("invite-members");invites.replaceChildren();
      for (const [id,m] of Object.entries(v.members)) {
        const row=el("div",undefined,invites,"invite-row");el("span",id + (m.joined ? tr(" · Joined"," · 已加入") : tr(" · Not joined"," · 尚未加入")),row);
        if (!m.joined) action(tr("Create a new invitation link","生成新的邀请链接"),row,async()=>{
          const r=await api("/rooms/"+auth.room_id+"/invitation",{member_id:id});
          await copyText(invitationUrl(r.room_id,r.invitation),row);
        },"quiet-button");
      }
      note(tr("New links replace older unused invitations. Joined participants use their own recovery card.","新链接会替代尚未使用的旧邀请。已经加入的成员使用各自的恢复卡重新进入。"),invites);
    }
  }
  let createdRoom = null;
  function renderCredentials(room) {
    const out = $("credentials");
    out.hidden = false;
    out.replaceChildren();
    note(
      tr(
        "Save these credentials. Give each person only their own invitation. The administrator cannot read private interviews.",
        "请保存凭据，将对应邀请码私下发给本人。管理员无法查看私人访谈。",
      ),
      out,
    );
    const card=el("section",undefined,out,"access-card");
    el("h3",tr("Your room is ready","房间已准备好"),card);
    const info=el("dl",undefined,card);el("dt",tr("Room","房间编号"),info);el("dd",room.room_id,info);
    const backup=el("details",undefined,card);el("summary",tr("Administrator recovery card","管理员恢复卡"),backup);
    accessCard(backup,tr("Private administrator access","管理员私人访问凭据"),[
      [tr("Room","房间编号"),room.room_id],
      [tr("Role","身份"),tr("Administrator","管理员")],
      [tr("Recovery code","恢复码"),room.admin_recovery_code],
    ],"considea-room.txt",tr("Keep this private. Share only each member's invitation link with that person.","请私下保管。只将每位成员对应的邀请链接发给本人。"));
    action(tr("Open administrator view", "打开管理员视图"), out, () =>
      establish({ room_id: room.room_id, token: room.admin_token, recovery_code:room.admin_recovery_code }),
    );
    for (const [member, invitation] of Object.entries(room.invitations)) {
      const row = el("article", undefined, out, "access-card");
      el("h3", member, row);
      action(tr("Copy private invitation link","复制私人邀请链接"),row,()=>copyText(invitationUrl(room.room_id,invitation),row),"quiet-button");
      action(
        tr("Use this invitation", "用此邀请码加入"),
        row,
        async () => {
          const joined = await api(
            "/rooms/" + encodeURIComponent(room.room_id) + "/join",
            { invitation },
            null,
          );
          await establish({ room_id: joined.room_id, token: joined.token, recovery_code:joined.recovery_code });
        },
        "quiet-button",
      );
    }
  }
  bind("create", async () => {
    const interviewRounds = Number($("interviewRounds").value);
    if (!Number.isInteger(interviewRounds) || interviewRounds < 1 || interviewRounds > 7) {
      $("interviewRounds").focus();
      throw Error(tr("Choose a whole number of interview rounds from 1 to 7.", "访谈轮数请填写 1–7 之间的整数。"));
    }
    const member_ids = $("memberIds")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    createdRoom = await api(
      "/rooms",
      {
        ...creationAccess(),
        room_context: {
          member_ids,
          hackathon_context: $("context").value,
          deadline_at: null,
          constraints: [],
        },
        config: {
          question_batches_per_round: interviewRounds,
          project_time_limit: createTimeLimit(),
          search_enabled: $("searchEnabled").checked,
          max_search_queries: $("searchEnabled").checked ? 2 : 0,
        },
      },
      null,
    );
    for (const id of ["demo-code","create-deepseek","create-openai","create-tavily"]) if ($(id)) $(id).value="";
    renderCredentials(createdRoom);
    $("roomId").value = createdRoom.room_id;
  });
  bind("join", async () => {
    const room = $("roomId").value.trim();
    const joined = await api(
      "/rooms/" + encodeURIComponent(room) + "/join",
      { invitation: $("invitation").value.trim() },
      null,
    );
    await establish({ room_id: joined.room_id, token: joined.token, recovery_code:joined.recovery_code });
  });
  bind("recover",async()=>{
    const r=await api("/rooms/"+encodeURIComponent($("roomId").value.trim())+"/recover",{
      role:$("recover-role").value,member_id:$("recover-member").value.trim(),recovery_code:$("recover-code").value.trim()
    },null);
    $("recover-code").value="";await establish(r);
    $("account-panel").open = true;
    await showRecoveryCard();
  });
  bind("resume", () =>
    establish({
      room_id: $("roomId").value.trim(),
      token: $("token").value.trim(),
    }),
  );
  async function establish(next, showWorkspace = true) {
    if (!next.room_id || !next.token)
      throw Error(
        tr("Enter a room ID and credential.", "请填写房间编号和凭据。"),
      );
    const v = await api(
      "/rooms/" + encodeURIComponent(next.room_id),
      undefined,
      next.token,
    );
    streamController?.abort();
    streamKey = null;
    ++refreshSequence;
    if(auth?.token!==next.token){translationCache.clear();translationQueue.clear();translationFailures.clear();}
    auth = next;
    storage.set("conclave-auth", JSON.stringify(auth));
    draft = parse(storage.get(draftKey()), Object.create(null));
    snapshot = v;
    selectedCandidate = null;
    if (showWorkspace) openWorkspace();
    setView(nextView(v));
    render(v);
    if (v.realtime?.enabled) startUpdates();
    $("invitation").value = "";
    $("token").value = "";
    createdRoom = null;
    $("credentials").replaceChildren();
    $("credentials").hidden = true;
  }
  bind("logout", async () => {
    streamController?.abort();
    ++refreshSequence;
    storage.remove(draftKey());
    storage.remove("conclave-auth");
    auth = null;
    snapshot = null;
    draft = Object.create(null);
    storage.set("considea-entry-mode", "join");
    location.reload();
  });
  bind("refresh", () => refresh(true));
  async function refresh(force = false) {
    if (!auth) return;
    const saved = { ...auth },
      sequence = ++refreshSequence;
    const v = await api(
      "/rooms/" + encodeURIComponent(saved.room_id),
      undefined,
      saved.token,
    );
    if (
      sequence !== refreshSequence ||
      auth?.token !== saved.token ||
      auth?.room_id !== saved.room_id
    )
      return;
    if (force || JSON.stringify(v) !== JSON.stringify(snapshot)) {
      snapshot = v;
      render(v);
    }
    if (v.realtime?.enabled) startUpdates();
  }
  async function event(type, payload, revision, prefix) {
    try {
      const result = await api(
        "/rooms/" + encodeURIComponent(auth.room_id) + "/events",
        {
          contract_version: "2.0",
          event_id: crypto.randomUUID(),
          room_id: auth.room_id,
          expected_revision: revision,
          type,
          payload,
        },
      );
      if (result.status !== "accepted") throw Object.assign(Error(result.error.message),{code:result.error.code});
      if (prefix) clearDraft(prefix);
      await refresh(true);
    } catch (e) {
      if (e.status === 409) {
        await refresh(true);
        throw Error(
          tr(
            "The room changed. Your unsubmitted text is kept for the same question or version. Review the latest state and submit again.",
            "房间状态已改变。同一问题或版本的未提交文字已保留，请检查最新状态后重新提交。",
          ),
        );
      }
      throw e;
    }
  }
  function render(v) {
    missingTranslation=false;
    translationQueue.clear();
    const focused = document.activeElement?.dataset.field,
      selection = focused
        ? [
            document.activeElement.selectionStart,
            document.activeElement.selectionEnd,
          ]
        : null;
    const expanded = new Set(
      $$("#app details[open]")
        .map((d) => d.dataset.detail)
        .filter(Boolean),
    );
    for (const id of [
      "status",
      "private",
      "sources",
      "team-members",
      "reviews",
      "discussion",
      "candidates",
      "tasks",
      "brief",
      "people-orbit",
    ])
      $(id).replaceChildren();
    $("entry").hidden = true;
    $("app").hidden = false;
    $("session-title").textContent =
      v.actor.member_id || tr("Administrator", "管理员");
    $("runtime-label").textContent =
      v.mode === "mock"
        ? tr("Mock agents", "模拟助手")
        : v.agent_runtime?.model === "fixture"
          ? tr("Offline agent test", "助手离线测试")
          : tr("Connected workflow", "已连接讨论流程");
    renderStatus(v);
    renderRoomAccess(v);
    if (currentView === "interview") renderPrivate(v);
    if (currentView === "studio") { renderStudio(v); renderCandidates(v); }
    if (currentView === "brief") renderBrief(v);
    renderTasks(v);
    setView(currentView);
    for (const d of $$("#app details[data-detail]"))
      if (expanded.has(d.dataset.detail)) d.open = true;
    if (focused) {
      const input = $$("[data-field]").find((n) => n.dataset.field === focused);
      if (input) {
        input.focus({ preventScroll: true });
        try {
          input.setSelectionRange(...selection);
        } catch {}
      }
    }
    scheduleTranslations();
  }
  function renderStatus(v) {
    const out = $("status");
    el(
      "h2",
      tr(
        "Round " + v.discussion_round + " · ",
        "第 " + v.discussion_round + " 轮 · ",
      ) + label(v.phase),
      out,
    );
    el("p", tr("Room ", "房间 ") + v.room_id, out);
    el("p", tr(
      "Private interviews: up to " + v.config.question_batches_per_round + " rounds per person in each discussion.",
      "每次讨论的私人访谈：每人最多 " + v.config.question_batches_per_round + " 轮。",
    ), out, "muted");
    const steps = el("ol",undefined,out,"workflow-steps");
    const phaseIndex = v.phase === "completed" ? 4 : ["idea_generating","evaluating","awaiting_review","revising"].includes(v.phase) ? 3 : v.phase === "awaiting_convergence_decision" ? 2 : v.phase === "interviewing" ? 0 : 1;
    for (const [i,name] of [tr("Private interview","私人访谈"),tr("Answer differences","回答分歧"),tr("Choose together","共同决定"),tr("Review directions","审阅方案"),tr("Shared brief","项目简报")].entries()) {
      const item=el("li",name,steps); if(i===phaseIndex)item.setAttribute("aria-current","step");
    }
    const next = v.actor.role === "admin" ? tr("Share each invitation privately. Participants complete their own interview and decisions.","请私下分享每位成员的邀请。访谈和决定由成员本人完成。")
      : v.phase === "interviewing" && v.private?.stage === "awaiting_answers" ? tr("Your next step: answer your private questions.","下一步：回答你的私人访谈问题。")
      : v.phase === "interviewing" && v.private?.stage === "awaiting_profile_approval" ? tr("Your next step: review what you want to share with the team.","下一步：检查并确认要与团队共享的总结。")
      : v.phase === "awaiting_difference_answers" ? (v.difference?.content.affected_member_ids.includes(v.actor.member_id) && !v.answers[v.actor.member_id]
        ? tr("Your next step: answer the question below.","下一步：回答下面的问题。") : tr("Waiting for the required members to answer.","正在等待相关成员回答，你暂时无需操作。"))
      : v.phase === "awaiting_convergence_decision" ? tr("Choose whether to generate ideas or keep discussing.","请选择进入方案生成，或继续讨论。")
      : v.phase === "awaiting_review" ? tr("Review a direction and its evidence with your team.","请与团队一起审阅方案及其证据。")
      : v.phase === "completed" ? tr("Your accepted project brief is ready.","团队确认的项目简报已准备好。")
      : tr("Your progress is saved. Waiting for the team or the next response.","进度已保存，正在等待队友或助手的下一步回应。");
    el("p",next,out,"next-step");
    if (v.actor.member_id) {
      const available = v.members[v.actor.member_id].available !== false;
      action(available ? tr("Mark myself away","暂时离开") : tr("I'm back","我回来了"),out,async()=>{
        await api("/rooms/"+auth.room_id+"/presence",{available:!available});await refresh(true);
      },"quiet-button");
    }
    if (Object.values(v.members).some(m=>m.available===false)) note(tr("A participant is away. Their answers and approvals are still required. Resume when everyone returns; if the team changes, end this room and create another.","有成员暂时离开，仍需等其回答和确认。人员到齐后继续；如果团队成员发生变化，请结束本房间并重新创建。"),out);
    if (!["completed", "ended"].includes(v.phase)) el("p",tr("After each round's answers, your team chooses whether to generate directions or keep discussing.","每轮回答完成后，由团队选择生成方向或继续讨论。"),out,"muted");
    if (v.tasks.some(t=>t.status==="failed")) {
      note(tr("A step needs attention. Your answers are saved. Open Activity & recovery to retry it.","有一步需要处理，回答已保存。请展开“运行进度与恢复”后重试。"),out);
      document.querySelector(".activity-panel:has(#tasks)").open=true;
    }
    if (v.mode === "mock")
      note(
        tr(
          "Mock mode: interviews, directions and reports are simulated. No live model or search is running.",
          "离线演示模式：访谈、候选和评估为模拟数据，未调用真实模型或搜索。",
        ),
        out,
      );
    if (v.agent_runtime?.model === "fixture")
      note(
        tr(
          "Offline integration test: teammate agents use simulated model responses and search results.",
          "整合测试：使用队友的助手代码，模型回答和搜索结果为模拟数据。",
        ),
        out,
      );
    if (v.agent_runtime?.evaluator === "stub")
      note(
        tr(
          "Evaluator placeholder: this report does not establish feasibility or novelty.",
          "评估助手占位报告，不代表可行性或创新性结论。",
        ),
        out,
      );
    if (v.realtime?.enabled)
      el(
        "p",
        v.realtime.connected
          ? tr("Shared progress is connected.", "共享进度已连接实时同步。")
          : tr(
              "Reconnecting shared progress; saved answers are retained.",
              "共享同步待恢复；已保存的回答不会丢失。",
            ),
        out,
      );
    if (v.evaluation_input_required) {
      note(
        tr(
          "Evaluation needs a project time limit. The administrator can add it below.",
          "评估需要项目时限；请管理员补充后继续。",
        ),
        out,
      );
      if (v.actor.role === "admin") {
        const read = timeLimitInput(out, false, "evaluation-time");
        action(
          tr("Save time limit and evaluate", "保存时限并继续评估"),
          out,
          async () => {
            await api("/rooms/" + auth.room_id + "/project-time-limit", {
              time_limit: read(),
            });
            clearDraft("evaluation-time");
            await refresh(true);
          },
        );
      }
    }
    if (v.paused_reason) note(v.paused_reason === "credentials"
      ? tr("AI work is paused. The administrator can add replacement keys under Access, invitations & API keys.","智能助手已暂停，请管理员在“访问、邀请与服务密钥”中补充密钥。")
      : tr("AI work is paused. Saved answers and results are still available.","智能助手已暂停，已保存的回答和结果仍可查看。"),out);
    if (v.actor.role === "admin") {
      const d = el("details", undefined, out);
      d.dataset.detail = "admin-controls";
      el("summary", tr("Room controls", "房间管理"), d);
      el("p", tr("No cumulative request limit.", "无累计请求次数上限。"), d, "muted");
      action(
        tr("End room", "结束房间"),
        d,
        async () => {
          if (
            !confirm(
              tr(
                "End this room and stop its pending work?",
                "结束此房间并停止待办任务？",
              ),
            )
          )
            return;
          await api("/rooms/" + auth.room_id + "/stop", {});
          await refresh(true);
        },
        "primary-button secondary",
      );
    }
  }
  function renderPrivate(v) {
    const out = $("private");
    el("span", tr("Only visible to you", "仅自己可见"), out, "private-tag");
    el("h2", tr("Your perspective.", "我的想法。"), out);
    if (!v.private) {
      el(
        "p",
        tr(
          "Administrators see shared content only. Join with your own invitation to participate.",
          "管理员只能看到共享内容。请使用成员身份参与访谈。",
        ),
        out,
      );
      return;
    }
    const p = v.private;
    if (v.phase === "interviewing" && p.stage === "awaiting_answers") {
      const progress = el("p", tr(
        "Interview round " + p.batches_asked + " of " + v.config.question_batches_per_round,
        "访谈第 " + p.batches_asked + " / " + v.config.question_batches_per_round + " 轮",
      ), out, "muted");
      progress.id = "interview-progress";
      const batch = p.question_batch,
        prefix = group("answer", batch.question_batch_ref);
      const fields = batch.questions.map((q) => ({
        q,
        a: field("textarea", displayText(q.text), out, prefix + "|" + q.question_key),
      }));
      el(
        "p",
        tr(
          "You may leave a question blank to decline. These answers stay private.",
          "不想回答的题目可留空，提交时将记为拒答。回答保持私密。",
        ),
        out,
        "muted",
      );
      action(tr("Submit private answers", "提交私人回答"), out, () =>
        event(
          "interview.answer",
          {
            session_ref: p.session_ref,
            question_batch_ref: batch.question_batch_ref,
            answers: fields.map(({ q, a }) => ({
              question_key: q.question_key,
              text: a.value,
              declined: !a.value.trim(),
            })),
          },
          v.event_revisions.interview,
          prefix,
        ),
      );
    } else if (
      v.phase === "interviewing" &&
      p.stage === "awaiting_profile_approval"
    ) {
      note(
        tr(
          "Review every item. Edit or clear anything you do not want to share. Only this approved summary will reach your team.",
          "逐项检查，可改写或清空不想共享的内容。只有你确认的摘要会共享给团队。",
        ),
        out,
      );
      const prefix = group("profile", p.draft.draft_ref);
      const fields = p.draft.content.items.map((item) => ({
        item,
        a: field(
          "textarea",
          label(item.category) +
            " · " +
            (item.basis === "member_statement"
              ? tr("Your statement", "成员陈述")
              : tr("AI inference", "助手推断")) +
            " · " +
            label(item.confidence),
          out,
          prefix + "|" + item.item_key,
          displayText(item.text),
        ),
      }));
      const unknowns = field(
        "textarea",
        tr(
          "Open questions (one per line; these are also shared)",
          "尚不确定的事项（每行一条；确认后也会共享）",
        ),
        out,
        prefix + "|unknowns",
        p.draft.content.unknowns.map(displayText).join("\n"),
      );
      action(
        tr("Approve and share this summary", "确认并共享这些内容"),
        out,
        () =>
          event(
            "profile.approve",
            {
              draft_ref: p.draft.draft_ref,
              items: fields
                .filter((x) => x.a.value.trim())
                .map(({ item, a }) => ({
                  item_key: item.item_key,
                  category: item.category,
                  text: a.value,
                  basis: item.basis,
                  confidence: item.confidence,
                })),
              unknowns: unknowns.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            },
            v.event_revisions.interview,
            prefix,
          ),
      );
    } else {
      el(
        "p",
        p.stage === "approved"
          ? tr(
              "Your summary is shared. Continue in the team studio.",
              "画像已确认，请进入团队工作室继续讨论。",
            )
          : ["ended", "completed"].includes(v.phase)
            ? tr(
                "This session has finished. Your earlier answers are below.",
                "本次会话已结束，可在下方查看之前的问答。",
              )
            : tr("Preparing your questions or summary…", "正在准备访谈或画像…"),
        out,
      );
      if (nextView(v) !== "interview") action(
        nextView(v) === "brief" ? tr("View project brief", "查看项目简报") : tr("Go to team studio", "前往团队工作室"),
        out, () => openWorkflowStep(nextView(v)), "primary-button secondary",
      );
    }
    detail(
      tr("Your private conversation history", "查看自己的私人问答"),
      p.messages,
      out,
      "private-history",
    );
  }
  function renderStudio(v) {
    const sources = $("sources");
    if (!v.shared_context.profiles.length)
      el(
        "p",
        tr(
          "Your team’s approved summaries will appear here.",
          "成员确认共享后，摘要会出现在这里。",
        ),
        sources,
        "empty-state",
      );
    for (const [i, profile] of v.shared_context.profiles.entries()) {
      const card = el("article", undefined, sources, "source");
      card.dataset.member = String(i % 4);
      el("h3", profile.member_id, card);
      for (const item of profile.items) {
        el(
          "small",
          label(item.category) +
            " · " +
            (item.basis === "member_statement"
              ? tr("Member statement", "成员陈述")
              : tr("AI inference, approved by member", "经成员确认的智能助手 推断")),
          card,
        );
        el("p", displayText(item.text), card);
      }
      if (profile.unknowns.length) {
        el("small", tr("Still unknown", "尚不确定"), card);
        el("p", profile.unknowns.map(displayText).join("\n"), card);
      }
    }
    for (const [i, [id, m]] of Object.entries(v.members).entries()) {
      const avatarClass = "avatar " + ["", "b", "c", "d"][i % 4];
      el("span", id.slice(0, 1).toUpperCase(), $("people-orbit"), avatarClass);
      const row = el("div", undefined, $("team-members"), "member");
      el("span", id.slice(0, 1).toUpperCase(), row, avatarClass);
      const body = el("div", undefined, row),
        name = el("div", undefined, body, "member-name");
      el(
        "span",
        id + (id === v.actor.member_id ? tr(" (you)", "（你）") : ""),
        name,
      );
      el("span", m.available===false ? tr("Away","暂时离开") : m.joined===false ? tr("Not joined","尚未加入") : label(m.stage), name, "member-state");
      if (v.answers[id]) el("p", tr("Difference answered", "已回答分歧"), body);
      if (v.votes[id])
        el(
          "p",
          label(v.votes[id].decision) +
            (v.votes[id].reason ? " · " + displayText(v.votes[id].reason) : ""),
          body,
        );
    }
    let out = $("discussion");
    if (Object.keys(v.candidates).length) {
      out = el("details", undefined, out);
      out.dataset.detail = "previous-difference";
      el("summary", tr("Discussion that led here", "形成方向前的讨论"), out);
    }
    el(
      "span",
      tr("Round " + v.discussion_round, "第 " + v.discussion_round + " 轮"),
      out,
      "tag",
    );
    if (needsInterview(v)) {
      el("h2", tr("Your next private interview is ready.", "新一轮私人访谈已开始。"), out);
      el("p", tr("Continue your interview before the team discusses the next difference.", "请先完成本轮访谈，再一起讨论新的分歧。"), out);
    } else if (v.difference) {
      const d = v.difference,
        c = d.content,
        personal = d.visibility === "private" ||
          (c.kind === "clarification" && c.affected_member_ids.length === 1),
        ownConfirmation = personal && c.affected_member_ids.includes(v.actor.member_id),
        hiddenConfirmation = personal && !ownConfirmation;
      el("h2", hiddenConfirmation
        ? (v.phase === "awaiting_difference_answers"
          ? tr("A member is confirming their statements", "一位成员正在确认自己的陈述")
          : tr("A member's private clarification", "成员的私人澄清"))
        : displayText(c.question), out);
      el("p", hiddenConfirmation
        ? (v.phase === "awaiting_difference_answers"
          ? tr("One member needs to confirm their own statements before the team can continue.",
            "需要由该成员本人确认陈述，团队才能继续。")
          : tr("The member has answered privately. Their clarification is not a team split.",
            "该成员已私下回答。这项个人澄清不属于团队分歧。"))
        : displayText(c.why_it_matters), out, "candidate-lead");
      if (ownConfirmation)
        note(tr("Your clarification and answer stay private. Only the profile you approve is shared with the team.",
          "澄清内容和回答仅你可见。只有你批准的访谈总结才会共享给团队。"), out);
      for (const [id, a] of Object.entries(hiddenConfirmation ? {} : v.answers)) {
        const p = el("p", undefined, out);
        el("strong", id + " · ", p);
        const option = c.options.find((o) => o.key === a.selected_option_key);
        p.append(
          (option ? displayText(option.label) + ". " : "") +
            displayText(a.text) +
            (a.disagrees_with_framing
              ? tr(" (questions the framing)", "（认为题意不准确）")
              : ""),
        );
      }
      if (
        v.phase === "awaiting_difference_answers" &&
        c.affected_member_ids.includes(v.actor.member_id) &&
        !v.answers[v.actor.member_id]
      ) {
        const prefix = group("difference", d.difference_ref);
        let select = null;
        if (c.answer_type === "binary") {
          select = field(
            "select",
            tr("Choose a perspective", "分歧选项"),
            out,
            prefix + "|option",
          );
          el("option", tr("Choose…", "请选择"), select).value = "";
          for (const o of c.options)
            el("option", displayText(o.label), select).value = o.key;
          select.value = draft[prefix + "|option"] || "";
        }
        const text = field(
          "textarea",
          ownConfirmation
            ? tr("Your answer or context (private)", "回答或补充说明（仅自己可见）")
            : tr("Your answer or context (shared with the team)", "回答或补充说明（共享给团队）"),
          out,
          prefix + "|text",
        );
        const wrap = el("label", undefined, out, "check"),
          reject = el("input", undefined, wrap);
        reject.type = "checkbox";
        reject.dataset.field = prefix + "|framing";
        reject.checked = !!draft[reject.dataset.field];
        el(
          "span",
          ownConfirmation
            ? tr("This question does not describe my statements accurately.", "这个问题没有准确表达我的陈述。")
            : tr("This question does not describe the difference accurately.", "这个问题没有准确表达分歧。"),
          wrap,
        );
        action(ownConfirmation
          ? tr("Confirm my statements", "确认我的陈述")
          : tr("Submit difference answer", "提交分歧回答"), out, () =>
          event(
            "difference.answer",
            {
              difference_ref: d.difference_ref,
              selected_option_key: select?.value || null,
              text: text.value,
              disagrees_with_framing: reject.checked,
            },
            v.event_revisions.difference,
            prefix,
          ),
        );
      } else if (v.phase === "awaiting_difference_answers")
        el(
          "p",
          hiddenConfirmation
            ? tr("Waiting for that member's private confirmation. No action is needed from you yet.",
              "正在等待该成员私下确认，你暂时无需操作。")
            : tr("Waiting for every affected member to answer.", "等待所有相关成员回答分歧。"),
          out,
          "muted",
        );
      if (v.phase === "awaiting_convergence_decision") {
        note(
          tr(
            "Your team decides after every round. Everyone must choose Generate directions to proceed; Keep exploring starts another discussion round.",
            "每轮结束都由团队决定。全员选择“进入生成”才生成方向；任何人选择“继续深挖”则开始下一轮讨论。",
          ),
          out,
        );
        if (v.actor.member_id) {
          const prefix = group("vote", d.difference_ref),
            reason = field(
              "textarea",
              tr("Your reason (shared with the team)", "理由（共享给团队）"),
              out,
              prefix + "|reason",
            );
          const row = el("div", undefined, out, "action-row");
          for (const decision of ["diverge", "converge"]) {
            const b = action(
              decision === "diverge"
                ? tr("Keep exploring", "继续深挖")
                : tr("Generate directions", "进入生成"),
              row,
              () =>
                event(
                  "convergence.vote",
                  {
                    difference_ref: d.difference_ref,
                    discussion_round: v.discussion_round,
                    decision,
                    reason: reason.value,
                  },
                  v.event_revisions.convergence,
                  prefix,
                ),
            );
            b.setAttribute(
              "aria-pressed",
              String(v.votes[v.actor.member_id]?.decision === decision),
            );
          }
        }
      } else if (
        v.phase === "awaiting_difference_answers"
      )
        el(
          "p",
          tr(
            "Once the required answers are in, everyone can choose to generate directions or keep exploring.",
            "收齐本轮必要回答后，每位成员都可以选择进入生成或继续深挖。",
          ),
          out,
          "muted",
        );
    } else {
      el(
        "h2",
        v.phase === "interviewing"
          ? tr("Hear every perspective.", "听见每个人的想法。")
          : label(v.phase),
        out,
      );
      el(
        "p",
        v.phase === "interviewing"
          ? tr(
              "Start with your private interview. The team’s difference will appear after everyone approves a summary.",
              "先完成私人访谈，全员确认摘要后将展示团队分歧。",
            )
          : tr(
              "Shared progress updates automatically.",
              "共享进度会自动更新。",
            ),
        out,
        "candidate-lead",
      );

    }
    detail(
      tr("Shared discussion history & sources", "共享讨论历史与来源"),
      v.shared_context,
      out,
      "shared-history",
    );
  }
  function renderSources(evidence, parent) {
    const sources=(evidence||[]).filter(item=>{try{return ["https:","http:"].includes(new URL(item.url).protocol);}catch{return false;}});
    if (!sources.length) return;
    el("h3",tr("Sources checked","已查阅来源"),parent);
    const list=el("ul",undefined,parent,"evidence-links");
    for (const source of sources) {
      const item=el("li",undefined,list),link=el("a",displayText(source.title)||new URL(source.url).hostname,item);
      link.href=source.url;link.target="_blank";link.rel="noopener noreferrer";
      if (source.limitation) el("small",displayText(source.limitation),item);
    }
  }
  function renderCandidates(v) {
    const out = $("candidates"),
      reviews = $("reviews"),
      entries = Object.entries(v.candidates);
    if (v.final_output) action(tr("View project brief", "查看项目简报"), out, () => openWorkflowStep("brief"));
    if (!entries.length) {
      const generationFailed = v.phase === "idea_generating" &&
        v.tasks.some(task => task.operation === "idea.generate" && task.status === "failed");
      if (generationFailed) {
        el("h3", tr("Direction generation needs attention.", "候选生成需要处理。"), out);
        el("p", tr(
          "Your answers and the team’s convergence decision are saved. Open Activity & recovery to retry generation.",
          "你的回答和团队的收敛决定已保存。请打开“运行进度与恢复”重试生成。",
        ), out, "muted");
        action(tr("Open Activity & recovery", "打开运行进度与恢复"), out, () => {
          const panel = $("tasks").closest("details");
          panel.open = true;
          panel.scrollIntoView({ block: "start", behavior: "instant" });
          panel.querySelector("summary").focus();
        });
        return;
      }
      el(
        "h3",
        tr("Directions come after the discussion.", "讨论之后，再形成候选。"),
        out,
      );
      el(
        "p",
        tr(
          "No candidates yet. Every round includes human answers; generation also needs the team’s convergence decision.",
          "暂无候选。每轮必须由人回答分歧，生成还需团队主动决定收敛。",
        ),
        out,
        "muted",
      );
      if (needsInterview(v)) action(
        tr("Go to private interview", "前往私人访谈"), out, openPrivateInterview,
      );
      return;
    }
    if (!v.candidates[selectedCandidate]) selectedCandidate = entries[0][0];
    const tabs = el("div", undefined, out, "direction-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", tr("Candidate directions", "候选方向"));
    for (const [id, c] of entries) {
      const tab = el("button", displayText(c.content.title), tabs);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.id = "tab-" + id;
      tab.setAttribute("aria-controls", "candidate-panel");
      tab.setAttribute("aria-selected", String(id === selectedCandidate));
      tab.tabIndex = id === selectedCandidate ? 0 : -1;
      tab.onclick = () => {
        selectedCandidate = id;
        render(snapshot);
        $("tab-" + id).focus();
      };
      tab.onkeydown = (e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const index = entries.findIndex(([x]) => x === id),
          next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? entries.length - 1
                : (index + (e.key === "ArrowRight" ? 1 : -1) + entries.length) %
                  entries.length;
        selectedCandidate = entries[next][0];
        render(snapshot);
        $("tab-" + selectedCandidate).focus();
      };
    }
    const id = selectedCandidate,
      candidate = v.candidates[id],
      c = candidate.content,
      panel = el("article", undefined, out);
    panel.id = "candidate-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "tab-" + id);
    el(
      "p",
      tr("Candidate version ", "候选版本 ") + candidate.candidate_ref.version,
      panel,
      "tag",
    );
    el("h2", displayText(c.title), panel);
    el("p", displayText(c.problem), panel, "candidate-lead");
    el("p", tr("For: ", "目标用户：") + c.target_users.map(displayText).join(tr(", ","、")), panel);
    el("p", displayText(c.solution), panel);
    el("h3", tr("The smallest useful demo", "最小可用演示"), panel);
    const list = el("ul", undefined, panel);
    for (const item of c.mvp_scope) el("li", displayText(item), list);
    detail(
      tr("Full direction, sources & trade-offs", "完整方案、来源与取舍"),
      c,
      panel,
      "candidate-" + JSON.stringify(candidate.candidate_ref),
    );
    const report = v.evaluations[id],
      full = v.evaluation_details?.[id];
    if (report) {
      const card = el("div", undefined, panel, "candidate-report");
      el("h3", tr("Evidence & feasibility", "证据与可行性"), card);
      el(
        "p",
        (report.content.report_status === "partial"
          ? tr("Incomplete evaluation · ", "评估尚不完整 · ")
          : tr("Evaluation complete · ", "评估完成 · ")) +
          displayText(report.content.summary),
        card,
      );
      for (const [en, zh, key] of [
        ["Risks", "风险", "risks"],
        ["Unknowns", "未知项", "unknowns"],
        ["Recommendations", "建议", "recommended_changes"],
      ])
        if (report.content[key]?.length) {
          el("h3", tr(en, zh), card);
          const ul = el("ul", undefined, card);
          for (const item of report.content[key]) el("li", displayText(item), ul);
        }
      detail(
        tr("Evaluation details", "完整评估与证据"),
        report.content,
        card,
        "report-" + id,
      );
    } else
      el(
        "p",
        tr(
          "Waiting for evaluation. Review will open when reports are ready.",
          "等待评估，报告准备好后才开放人工审阅。",
        ),
        panel,
        "muted",
      );
    renderSources(full?.evidence || report?.content?.evidence,panel);
    if (full) {
      const verdict = {
        pass: tr("Pass", "通过"),
        fail: tr("Fail", "未通过"),
        insufficient_evidence: tr("Insufficient evidence", "证据不足"),
      };
      for (const [key, en, zh] of [
        ["novelty", "Novelty", "创新性"],
        ["feasibility", "Feasibility", "可行性"],
      ])
        el(
          "p",
          tr(en, zh) +
            ": " +
            (verdict[full.tests[key].result] || full.tests[key].result) +
            " · " +
            displayText(full.tests[key].reason),
          panel,
        );
      if (full.fixture)
        note(
          tr(
            "Simulated report; no live API was used.",
            "离线模拟报告，未调用真实模型服务。",
          ),
          panel,
        );
      detail(
        tr(
          "Full report, sources & search records",
          "完整评估报告（含来源和搜索记录）",
        ),
        full,
        panel,
        "native-report-" + id,
      );
    }
    el("h3", tr("Review this version", "审阅此版本"), reviews);
    el(
      "p",
      displayText(c.title) + tr(" · version ", " · 版本 ") + candidate.candidate_ref.version,
      reviews,
      "muted",
    );
    for (const member of Object.keys(v.members)) {
      const review = v.reviews[id]?.[member];
      const row = el("p", undefined, reviews);
      el("strong", member + " · ", row);
      row.append(
        review
          ? label(review.decision) +
              (review.instructions ? " · " + displayText(review.instructions) : "")
          : tr("Not reviewed", "尚未审阅"),
      );
    }
    if (v.phase === "awaiting_review" && v.actor.member_id && report) {
      const prefix = group("review", [
          candidate.candidate_ref,
          report.evaluation_ref,
        ]),
        instructions = field(
          "textarea",
          tr(
            "Revision request / topic to revisit (shared)",
            "修改意见／继续讨论的问题（共享）",
          ),
          reviews,
          prefix + "|instructions",
          displayText(v.reviews[id]?.[v.actor.member_id]?.instructions || ""),
        );
      for (const [decision, en, zh] of [
        ["accept", "Accept this version", "接受此版本"],
        ["minor_revision", "Request a small revision", "小改"],
        ["more_discussion", "Discuss another round", "加一轮"],
      ]) {
        const b = action(tr(en, zh), reviews, () =>
          event(
            "candidate.review",
            {
              candidate_ref: candidate.candidate_ref,
              evaluation_ref: report.evaluation_ref,
              decision,
              instructions: instructions.value,
            },
            v.event_revisions.review[id],
            prefix,
          ),
        );
        b.setAttribute(
          "aria-pressed",
          String(v.reviews[id]?.[v.actor.member_id]?.decision === decision),
        );
      }
      el(
        "p",
        tr(
          "Everyone must choose the same action. A small revision needs identical agreed instructions. You can update your review while the team is deciding.",
          "全员同一动作才继续；小改需先协商成相同修改文字。意见不一致时可重新提交。",
        ),
        reviews,
        "stance-note",
      );
    } else
      el(
        "p",
        v.actor.role === "admin"
          ? tr("Only members can review.", "只有成员可提交审阅。")
          : tr(
              "Review opens after evaluation; a revised version needs new approval.",
              "评估后才开放审阅；修订版本需要重新确认。",
            ),
        reviews,
        "stance-note",
      );
    if (v.candidate_history.length)
      detail(
        tr(
          "Earlier candidates, evaluations & reviews",
          "历史候选、评估与人工意见",
        ),
        v.candidate_history,
        out,
        "candidate-history",
      );
  }
  function renderBrief(v) {
    const out = $("brief");
    el("span", tr("Project brief", "项目简报"), out, "private-tag");
    if (!v.final_output) {
      el(
        "h2",
        tr("A shared direction is still taking shape.", "共同方向仍在形成。"),
        out,
      );
      el(
        "p",
        tr(
          "The final brief appears only after every member accepts the same candidate version.",
          "全员接受同一候选版本后，才会生成最终简报。",
        ),
        out,
      );

      return;
    }
    el("h2", tr("Agreed by your team.", "团队已达成一致。"), out);
    el(
      "p",
      tr(
        "Every member accepted this candidate and evaluation version.",
        "全员已接受这个候选及其评估版本。",
      ),
      out,
    );
    // The persisted final output is authoritative; never export a selected, unapproved candidate.
    const candidate =
      v.final_output.candidate?.content || v.final_output.candidate;
    if (candidate?.title) {
      el("h3", displayText(candidate.title), out);
      if (candidate.problem) el("p", displayText(candidate.problem), out);
      if (candidate.solution) el("p", displayText(candidate.solution), out);
      if (candidate.mvp_scope) {
        const ul = el("ul", undefined, out);
        for (const item of candidate.mvp_scope) el("li", displayText(item), ul);
      }
    }
    const acceptedReport=v.final_output.evaluation?.content;
    if (acceptedReport) {
      el("h3",tr("Evidence & feasibility","证据与可行性"),out);
      el("p",displayText(acceptedReport.summary),out);
      const risks=el("ul",undefined,out);for(const risk of acceptedReport.risks||[])el("li",displayText(risk),risks);
      renderSources(acceptedReport.evidence,out);
    }
    detail(
      tr(
        "Accepted project, evaluation & decisions",
        "已接受的项目、评估与决定",
      ),
      v.final_output,
      out,
      "final-output",
    );
    // Resolve all export prose before enabling the button, including collapsed details.
    for (const text of [...(candidate.target_users||[]),...(candidate.core_flow||[]),...(candidate.tradeoffs||[]),
      ...(v.final_output.human_reviews||[]).map(r=>r.instructions||"")]) displayText(text);
    action(tr("Export accepted brief", "导出已接受的简报"), out, async () => {
      const section=(title,items)=>"\n\n"+title+"\n"+(items||[]).map(x=>"• "+displayText(x)).join("\n");
      const text = displayText(candidate.title)+"\n\n"+displayText(candidate.problem)+"\n\n"+displayText(candidate.solution)
        + section(tr("Who it helps","目标用户"),candidate.target_users)
        + section(tr("First demo","首版演示"),candidate.mvp_scope)
        + section(tr("How it works","使用流程"),candidate.core_flow)
        + section(tr("Trade-offs","取舍"),candidate.tradeoffs)
        + "\n\n"+tr("Evaluation","评估结论")+"\n"+displayText(acceptedReport?.summary||"")
        + section(tr("Risks","风险"),acceptedReport?.risks)
        + "\n\n"+tr("Team decisions","团队决定")+"\n"+(v.final_output.human_reviews||[]).map(r=>r.member_id+"："+label(r.decision)+(r.instructions ? " · "+displayText(r.instructions) : "")).join("\n");
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" }),
      );
      const a = el("a");
      a.href = url;
      a.download = "considea-accepted-brief.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function renderTasks(v) {
    const out = $("tasks");
    el(
      "p",
      tr("Agent calls: ", "智能助手调用次数：") + v.calls_started +
        tr(" · No cumulative limit", " · 无累计上限"),
      out,
    );
    const tasks = v.tasks.filter((t) => t.status !== "done");
    if (!tasks.length)
      el("p", tr("No pending agent tasks.", "暂无待处理的助手任务。"), out);
    for (const task of tasks) {
      const row = el("div", undefined, out, "task");
      el(
        "p",
        label(task.operation) +
          " · " +
          label(task.status) +
          (task.error ? tr(" · Please retry or check the room settings", " · 请重试或检查房间设置") : ""),
        row,
      );
      if (task.status === "failed")
        action(tr("Retry this task", "重试此任务"), row, async () => {
          await api(
            "/rooms/" + auth.room_id + "/tasks/" + task.task_id + "/retry",
            {},
          );
          await refresh(true);
        });
    }
  }
  function startUpdates() {
    const key = auth.room_id + auth.token;
    if (streamKey === key) return;
    streamController?.abort();
    streamController = new AbortController();
    const signal = streamController.signal;
    streamKey = key;
    const saved = { ...auth };
    (async () => {
      while (!signal.aborted) {
        try {
          const response = await fetch(
            "/api/rooms/" + encodeURIComponent(saved.room_id) + "/updates",
            { headers: { Authorization: "Bearer " + saved.token }, signal },
          );
          if (!response.ok) throw Error("Realtime unavailable");
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              if (frame.startsWith("data: ")) await refresh();
            }
          }
        } catch {
          if (signal.aborted) break;
        }
        if (!signal.aborted)
          await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
  }
  function readInvitation() {
    const invitationParams=new URLSearchParams(location.hash.slice(1));
    if (invitationParams.has("room") && invitationParams.has("invitation")) {
      $("roomId").value=invitationParams.get("room");$("invitation").value=invitationParams.get("invitation");
      persist();streamController?.abort();streamKey=null;++refreshSequence;
      auth=null;snapshot=null;translationCache.clear();translationQueue.clear();translationFailures.clear();
      openWorkspace();setEntryMode("join");$("entry").hidden=false;$("app").hidden=true;
      document.querySelector(".primary-nav").hidden=true;$("join").focus();
      return true;
    }
    return false;
  }
  setEntryMode(storage.get("considea-entry-mode") || "start");
  const homeRequested=["#home", "#cover-about"].includes(location.hash);
  const invitationPending=readInvitation();
  window.addEventListener("hashchange",readInvitation);
  void loadCapabilities();
  translate();
  theme(preference.get("considea-study-theme") === "light" ? "light" : "dark");
  setView("studio");
  if (!homeRequested && (location.hash === "#workspace" || storage.get("considea-test-login") || auth)) openWorkspace();
  if (auth && !invitationPending) {
    const saved = { ...auth };
    establish(saved,!homeRequested).catch((e) => {
      showError(e);
      $("entry").hidden = false;
      $("app").hidden = true;
      streamController?.abort();
      auth = null;
      storage.remove("conclave-auth");
    });
  }
  setInterval(() => {
    if (auth)
      refresh().catch((e) =>
        showError(
          Error(
            tr(
              "Connection interrupted. Your drafts are retained; use Refresh to retry.",
              "连接中断，草稿已保留，可点击刷新重试。",
            ),
          ),
        ),
      );
  }, 10000);
})();
