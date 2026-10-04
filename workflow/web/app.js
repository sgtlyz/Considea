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
  const label = (key) => (stateNames[key] ? tr(...stateNames[key]) : key);
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
  function detail(title, value, parent, key = title) {
    const d = el("details", undefined, parent);
    d.dataset.detail = key;
    el("summary", title, d);
    el(
      "pre",
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
      d,
    );
    return d;
  }
  function showError(e) {
    $("error").textContent = e?.message || String(e);
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
  async function api(path, body, token = auth?.token) {
    const r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
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
      e.status = r.status;
      throw e;
    }
    return data;
  }
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
  function setView(next) {
    currentView = next;
    for (const id of ["interview", "studio", "brief"])
      $(id + "-view").hidden = id !== next;
    $$("[data-view]").forEach((b) => {
      if (b.dataset.view === next) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }
  function openPrivateInterview() {
    setView("interview");
    const view = $("interview-view");
    view.focus({ preventScroll: true });
    view.scrollIntoView({ block: "start", behavior: "instant" });
  }
  $$("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
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
    $$("[data-en]").forEach(
      (n) => (n.textContent = lang === "zh" ? n.dataset.zh : n.dataset.en),
    );
    $$("[data-language]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.language === lang)),
    );
    window.consideaAtmosphere?.language(lang);
    $("projectTime").replaceChildren();
    createTimeLimit = timeLimitInput($("projectTime"), true, "create-time");
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
  function downloadText(name, value, type = "application/json") {
    const url = URL.createObjectURL(new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], {type}));
    const a = el("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const out = $("create-access"); out.replaceChildren();
    if (!capabilities?.live) return;
    const select = el("select", undefined, el("label", tr("How will this room use AI?", "房间如何使用 AI？"), out));
    select.id = "funding";
    el("option", tr("Team demo access code", "团队演示访问码"), select).value = "team";
    const own = el("option", tr("My API keys", "使用我的 API key"), select); own.value = "own";
    own.disabled = !capabilities.own_keys_supported;
    const code = passwordInput(out, tr("Demo access code", "演示访问码"), "demo-code");
    const keys = el("div", undefined, out); keys.id = "create-key-fields";
    passwordInput(keys,"DeepSeek API key","create-deepseek");
    passwordInput(keys,"Tavily API key (required for web research)","create-tavily");
    note(tr("Your keys pay for this room. They are encrypted on the server and are not saved in browser storage. You can replace or remove them later.","你的 key 为此房间付费，在服务器加密保存，不写入浏览器存储，可随时替换或删除。"),keys);
    select.onchange = () => { keys.hidden = select.value !== "own"; code.parentElement.hidden = select.value !== "team"; };
    if (!capabilities.shared_demo_available && capabilities.own_keys_supported) select.value = "own";
    select.onchange();
  }
  function creationAccess() {
    if (!capabilities) throw Error(tr("The workspace is connecting. Wait a moment and try again.","工作区正在连接，请稍后重试。"));
    if (!capabilities.live) return {};
    return $("funding").value === "own"
      ? {credentials:{deepseek_api_key:$("create-deepseek").value.trim(),tavily_api_key:$("create-tavily").value.trim()}}
      : {access_code:$("demo-code").value.trim()};
  }
  async function loadCapabilities() {
    try {
      capabilities = await api("/capabilities",undefined,null);
      $("connection-status").textContent = capabilities.live
        ? tr("Live workspace · AI responses use real API calls. Start with a demo access code or your own keys.","真实运行 · 将调用真实 API。使用演示访问码或自己的 key 开始。")
        : tr("Practice workspace · Responses are simulated; no API usage.","练习模式 · 回答为模拟数据，不消耗 API。");
      renderCreateAccess();
    } catch {
      const out = $("connection-status"); out.textContent = tr("The server is waking up or unavailable. Your saved session is kept.","服务器正在唤醒或暂时不可用，已保存的会话仍然保留。");
      action(tr("Try connecting again","重新连接"),out,loadCapabilities,"quiet-button");
    }
  }
  function saveRecovery() {
    downloadText("considea-private-recovery.json",{room_id:auth.room_id,role:snapshot.actor.role,
      member_id:snapshot.actor.member_id,recovery_code:auth.recovery_code,
      instructions:"Keep private. Recovering rotates both the session and this code."});
  }
  function renderRoomAccess(v) {
    const out = $("room-access"), identity = v.room_id + ":" + v.actor.role + ":" + (v.actor.member_id || "");
    if (out.dataset.identity !== identity) {
      out.dataset.identity = identity; out.replaceChildren();
      el("p",tr("Your access","你的访问权限"),out,"tag");
      note(tr("Download a recovery card before leaving. It restores your identity without exposing anyone else's interview.","离开前下载恢复卡，用于恢复本人身份。"),out);
      action(tr("Download private recovery card","下载私人恢复卡"),out,async()=>{
        if (!auth.recovery_code) {
          const r=await api("/rooms/"+auth.room_id+"/recovery-code",{});
          auth.recovery_code=r.recovery_code; storage.set("conclave-auth",JSON.stringify(auth));
        }
        saveRecovery();
      },"quiet-button");
      if (v.actor.role === "admin") {
        el("h3",tr("Invite your team","邀请团队"),out);
        const invites=el("div",undefined,out);invites.id="invite-members";
        el("h3",tr("Room API keys","房间 API key"),out);
        el("p","",out).id="key-status";
        if (v.access?.own_keys_supported) {
          const deepseek=passwordInput(out,"DeepSeek API key","room-deepseek");
          const tavily=passwordInput(out,"Tavily API key","room-tavily");
          note(tr("Saved keys are never shown again. These keys fund the whole room.","已保存的 key 不再显示，将用于整个房间。"),out);
          action(tr("Save room keys","保存房间 key"),out,async()=>{
            await api("/rooms/"+auth.room_id+"/keys",{credentials:{deepseek_api_key:deepseek.value.trim(),tavily_api_key:tavily.value.trim()}});
            deepseek.value="";tavily.value="";await refresh(true);
          });
          action(tr("Remove room keys and pause","删除房间 key 并暂停"),out,async()=>{
            if (!confirm(tr("Remove the saved keys? New AI calls will pause until replacement keys are entered.","删除已保存的 key？新的调用会暂停，直到输入替换 key。"))) return;
            await api("/rooms/"+auth.room_id+"/keys",{credentials:null});deepseek.value="";tavily.value="";await refresh(true);
          },"quiet-button");
        }
      }
    }
    if (v.actor.role === "admin") {
      $("key-status").textContent = v.access?.funding === "own"
        ? (v.access.keys_configured ? "Using your room keys · encrypted" : "Room keys removed · add keys to continue")
        : "Team demo · " + (v.access?.shared_calls_remaining ?? "—") + " shared tasks remaining today";
      const invites=$("invite-members");invites.replaceChildren();
      for (const [id,m] of Object.entries(v.members)) {
        const row=el("div",undefined,invites,"invite-row");el("span",id + (m.joined ? " · Joined" : " · Not joined"),row);
        if (!m.joined) action("Create a new invitation link",row,async()=>{
          const r=await api("/rooms/"+auth.room_id+"/invitation",{member_id:id});
          await copyText(invitationUrl(r.room_id,r.invitation),row);
        },"quiet-button");
      }
      note("New links replace older unused invitations. Joined participants use their own recovery card.",invites);
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
    action(tr("Download private room card", "下载私人房间卡"),out,async()=>downloadText("considea-private-room.json",room),"quiet-button");
    const advanced=el("details",undefined,out);el("summary",tr("Private backup details","私人备份详情"),advanced);
    const data = el("textarea", undefined, advanced);
    data.readOnly = true;
    data.value = JSON.stringify(room, null, 2);
    data.setAttribute("aria-label", tr("Room credentials", "房间凭据"));
    action(tr("Open administrator view", "打开管理员视图"), out, () =>
      establish({ room_id: room.room_id, token: room.admin_token, recovery_code:room.admin_recovery_code }),
    );
    for (const [member, invitation] of Object.entries(room.invitations)) {
      const row = el("p", undefined, out);
      el("span", member + " · ", row);
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
          project_time_limit: createTimeLimit(),
          search_enabled: $("searchEnabled").checked,
          max_search_queries: $("searchEnabled").checked ? 2 : 0,
        },
      },
      null,
    );
    for (const id of ["demo-code","create-deepseek","create-tavily"]) if ($(id)) $(id).value="";
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
    $("recover-code").value="";await establish(r);saveRecovery();
  });
  bind("resume", () =>
    establish({
      room_id: $("roomId").value.trim(),
      token: $("token").value.trim(),
    }),
  );
  async function establish(next) {
    if (!next.room_id || !next.token)
      throw Error(
        tr("Enter a room ID and credential.", "请填写房间 ID 和凭据。"),
      );
    const v = await api(
      "/rooms/" + encodeURIComponent(next.room_id),
      undefined,
      next.token,
    );
    streamController?.abort();
    streamKey = null;
    ++refreshSequence;
    auth = next;
    storage.set("conclave-auth", JSON.stringify(auth));
    draft = parse(storage.get(draftKey()), Object.create(null));
    snapshot = v;
    selectedCandidate = null;
    openWorkspace();
    setView(v.private && v.phase === "interviewing" ? "interview" : "studio");
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
      if (result.status !== "accepted") throw Error(result.error.message);
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
        ? tr("Mock agents", "模拟 Agent")
        : v.agent_runtime?.model === "fixture"
          ? tr("Offline agent test", "Agent 离线测试")
          : tr("Connected workflow", "已连接 workflow");
    renderStatus(v);
    renderRoomAccess(v);
    renderPrivate(v);
    renderStudio(v);
    renderCandidates(v);
    renderBrief(v);
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
    const steps = el("ol",undefined,out,"workflow-steps");
    const phaseIndex = v.phase === "completed" ? 4 : ["idea_generating","evaluating","awaiting_review","revising"].includes(v.phase) ? 3 : v.phase === "awaiting_convergence_decision" ? 2 : v.phase === "interviewing" ? 0 : 1;
    for (const [i,name] of ["Private interview","Answer differences","Choose together","Review directions","Shared brief"].entries()) {
      const item=el("li",name,steps); if(i===phaseIndex)item.setAttribute("aria-current","step");
    }
    const next = v.private?.stage === "awaiting_answers" ? "Your next step: answer your private questions."
      : v.private?.stage === "awaiting_profile_approval" ? "Your next step: review what you want to share with the team."
      : v.phase === "awaiting_difference_answers" ? "Your next step: answer the shared difference. Every affected person must reply."
      : v.phase === "awaiting_convergence_decision" ? "Your next step: choose whether to generate ideas or keep discussing."
      : v.phase === "awaiting_review" ? "Your next step: review a direction and its evidence with your team."
      : v.phase === "completed" ? "Your accepted project brief is ready to download."
      : v.actor.role === "admin" ? "Share each invitation privately. Participants complete their own interview and decisions."
      : "Your progress is saved. Waiting for the team or the next AI response.";
    el("p",next,out,"next-step");
    if (v.actor.member_id) {
      const available = v.members[v.actor.member_id].available !== false;
      action(available ? "Mark myself away" : "I'm back",out,async()=>{
        await api("/rooms/"+auth.room_id+"/presence",{available:!available});await refresh(true);
      },"quiet-button");
    }
    if (Object.values(v.members).some(m=>m.available===false)) note("A participant is away. Their answers and approvals are still required. Resume when everyone returns; if the team changes, end this room and create another.",out);
    if (v.discussion_round < 4) el("p","Discussion " + v.discussion_round + " of at least 4. Each round includes human answers before the team decides to generate.",out,"muted");
    if (v.tasks.some(t=>t.status==="failed")) {
      note("A step needs attention. Your answers are saved. Open Activity & recovery to retry it.",out);
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
          "整合测试：使用队友 Agent 代码，模型回答和搜索结果为模拟数据。",
        ),
        out,
      );
    if (v.agent_runtime?.evaluator === "stub")
      note(
        tr(
          "Evaluator placeholder: this report does not establish feasibility or novelty.",
          "Evaluator 占位报告，不代表可行性或创新性结论。",
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
      ? "AI work is paused. The administrator can add replacement keys under Access, invitations & API keys."
      : v.paused_reason === "daily_limit" ? "The shared demo allowance is used for today. Wait until UTC midnight or let the administrator add room keys."
      : "This room reached its AI task allowance. Saved answers and results are still available.",out);
    if (v.actor.role === "admin") {
      const d = el("details", undefined, out);
      d.dataset.detail = "admin-controls";
      el("summary", tr("Room controls", "房间管理"), d);
      const budget = field(
        "input",
        tr("Agent call limit", "Agent 调用上限"),
        d,
        "budget",
        Math.min(v.config.max_agent_calls + 10, v.access?.room_call_limit || 10000),
        "number",
      );
      budget.min = v.config.max_agent_calls + 1;
      budget.max = v.access?.room_call_limit || 10000;
      action(tr("Increase call limit", "提高调用额度"), d, async () => {
        await api("/rooms/" + auth.room_id + "/budget", {
          max_agent_calls: Number(budget.value),
        });
        await refresh(true);
      });
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
      const batch = p.question_batch,
        prefix = group("answer", batch.question_batch_ref);
      const fields = batch.questions.map((q) => ({
        q,
        a: field("textarea", q.text, out, prefix + "|" + q.question_key),
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
          item.category +
            " · " +
            (item.basis === "member_statement"
              ? tr("Your statement", "成员陈述")
              : tr("AI inference", "AI 推断")) +
            " · " +
            item.confidence,
          out,
          prefix + "|" + item.item_key,
          item.text,
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
        p.draft.content.unknowns.join("\n"),
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
      action(
        tr("Open team studio", "进入团队工作室"),
        out,
        async () => setView("studio"),
        "primary-button secondary",
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
          item.category +
            " · " +
            (item.basis === "member_statement"
              ? tr("Member statement", "成员陈述")
              : tr("AI inference, approved by member", "经成员确认的 AI 推断")),
          card,
        );
        el("p", item.text, card);
      }
      if (profile.unknowns.length) {
        el("small", tr("Still unknown", "尚不确定"), card);
        el("p", profile.unknowns.join("\n"), card);
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
      el("span", m.available===false ? "Away" : m.joined===false ? "Not joined" : label(m.stage), name, "member-state");
      if (v.answers[id]) el("p", tr("Difference answered", "已回答分歧"), body);
      if (v.votes[id])
        el(
          "p",
          label(v.votes[id].decision) +
            (v.votes[id].reason ? " · " + v.votes[id].reason : ""),
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
    if (v.difference) {
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
        : c.question, out);
      el("p", hiddenConfirmation
        ? (v.phase === "awaiting_difference_answers"
          ? tr("One member needs to confirm their own statements before the team can continue.",
            "需要由该成员本人确认陈述，团队才能继续。")
          : tr("The member has answered privately. Their clarification is not a team split.",
            "该成员已私下回答。这项个人澄清不属于团队分歧。"))
        : c.why_it_matters, out, "candidate-lead");
      if (ownConfirmation)
        note(tr("Your clarification and answer stay private. Only the profile you approve is shared with the team.",
          "澄清内容和回答仅你可见。只有你批准的访谈总结才会共享给团队。"), out);
      for (const [id, a] of Object.entries(hiddenConfirmation ? {} : v.answers)) {
        const p = el("p", undefined, out);
        el("strong", id + " · ", p);
        const option = c.options.find((o) => o.key === a.selected_option_key);
        p.append(
          (option ? option.label + ". " : "") +
            a.text +
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
            el("option", o.label, select).value = o.key;
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
            "From round 4, everyone must choose to converge before generation. One diverge starts another discussion round.",
            "从第 4 轮起，全员 converge 才生成；任何人 diverge 则继续一轮讨论。",
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
        v.discussion_round <= 3 &&
        !["completed", "ended"].includes(v.phase)
      )
        el(
          "p",
          tr(
            "This round returns to private interviews after the required human answers. Generation opens from round 4.",
            "本轮收齐人工回答后回到私人访谈。第 4 轮起才开放收敛选择。",
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
      if (v.phase === "interviewing" && v.private)
        action(tr("Open my interview", "打开我的访谈"), out, openPrivateInterview);
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
      const item=el("li",undefined,list),link=el("a",source.title||new URL(source.url).hostname,item);
      link.href=source.url;link.target="_blank";link.rel="noopener noreferrer";
      if (source.limitation) el("small",source.limitation,item);
    }
  }
  function renderCandidates(v) {
    const out = $("candidates"),
      reviews = $("reviews"),
      entries = Object.entries(v.candidates);
    if (!entries.length) {
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
      action(
        tr("Go to private interview", "前往私人访谈"),
        out,
        openPrivateInterview,
      );
      return;
    }
    if (!v.candidates[selectedCandidate]) selectedCandidate = entries[0][0];
    const tabs = el("div", undefined, out, "direction-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", tr("Candidate directions", "候选方向"));
    for (const [id, c] of entries) {
      const tab = el("button", c.content.title, tabs);
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
    el("h2", c.title, panel);
    el("p", c.problem, panel, "candidate-lead");
    el("p", tr("For: ", "目标用户：") + c.target_users.join(", "), panel);
    el("p", c.solution, panel);
    el("h3", tr("The smallest useful demo", "最小可用演示"), panel);
    const list = el("ul", undefined, panel);
    for (const item of c.mvp_scope) el("li", item, list);
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
          report.content.summary,
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
          for (const item of report.content[key]) el("li", item, ul);
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
            full.tests[key].reason,
          panel,
        );
      if (full.fixture)
        note(
          tr(
            "Simulated report; no live API was used.",
            "离线模拟报告，未调用真实 API。",
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
      c.title + " · v" + candidate.candidate_ref.version,
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
              (review.instructions ? " · " + review.instructions : "")
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
          v.reviews[id]?.[v.actor.member_id]?.instructions || "",
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
      action(tr("Back to team studio", "返回团队工作室"), out, async () =>
        setView("studio"),
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
      el("h3", candidate.title, out);
      if (candidate.problem) el("p", candidate.problem, out);
      if (candidate.solution) el("p", candidate.solution, out);
      if (candidate.mvp_scope) {
        const ul = el("ul", undefined, out);
        for (const item of candidate.mvp_scope) el("li", item, ul);
      }
    }
    const acceptedReport=v.final_output.evaluation?.content;
    if (acceptedReport) {
      el("h3",tr("Evidence & feasibility","证据与可行性"),out);
      el("p",acceptedReport.summary,out);
      const risks=el("ul",undefined,out);for(const risk of acceptedReport.risks||[])el("li",risk,risks);
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
    action(tr("Export accepted brief", "导出已接受的简报"), out, async () => {
      const text = "# " + candidate.title + "\n\n" + candidate.problem + "\n\n" + candidate.solution
        + "\n\n## Who it helps\n" + (candidate.target_users||[]).join(", ")
        + "\n\n## First demo\n" + (candidate.mvp_scope||[]).map(x=>"- "+x).join("\n")
        + "\n\n## Evaluation\n" + (v.final_output.evaluation?.content?.summary||"")
        + "\n\n## Accepted record\n" + JSON.stringify(v.final_output,null,2);
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
      tr("Agent calls: ", "Agent 调用次数：") +
        v.calls_started +
        " / " +
        v.config.max_agent_calls,
      out,
    );
    const tasks = v.tasks.filter((t) => t.status !== "done");
    if (!tasks.length)
      el("p", tr("No pending agent tasks.", "暂无待处理的 Agent 任务。"), out);
    for (const task of tasks) {
      const row = el("div", undefined, out, "task");
      el(
        "p",
        task.operation +
          " · " +
          label(task.status) +
          (task.error ? " · " + task.error.code : ""),
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
      openWorkspace();$("entry").hidden=false;$("app").hidden=true;$("join").focus();
      return true;
    }
    return false;
  }
  const invitationPending=readInvitation();
  window.addEventListener("hashchange",readInvitation);
  void loadCapabilities();
  translate();
  theme(preference.get("considea-study-theme") === "light" ? "light" : "dark");
  setView("studio");
  if (storage.get("considea-test-login") || auth) openWorkspace();
  if (auth && !invitationPending) {
    const saved = { ...auth };
    establish(saved).catch((e) => {
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
