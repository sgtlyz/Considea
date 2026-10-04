// Real browser -> HTTP -> SQLite -> mock agents -> human actions. No live API calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const folder = await mkdtemp(join(tmpdir(), "considea-ui-"));
const screenshots = fileURLToPath(new URL("../data/", import.meta.url));
await mkdir(screenshots, { recursive: true });
const worker = spawn(
  process.env.PYTHON || "python",
  [
    "-m",
    "workflow",
    "--mode",
    "mock",
    "--port",
    "0",
    "--db",
    join(folder, "test.sqlite3"),
  ],
  { cwd: root, env:{...process.env, CONCLAVE_SECRET_KEY:Buffer.alloc(32,1).toString("base64")}, stdio: ["ignore", "pipe", "pipe"] },
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let browser,
  base,
  stderr = "";
worker.stderr.on("data", (b) => (stderr += b.toString()));
async function until(fn) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(100);
  }
  throw Error("Timed out waiting for UI/workflow");
}
try {
  base = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(Error("Server startup timed out")),
      15000,
    );
    worker.stdout.on("data", (b) => {
      output += b.toString();
      const m = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      clearTimeout(timer);
      reject(Error("Server exited: " + code + " " + stderr));
    });
  });
  assert.equal(new URL(base).hostname, "127.0.0.1");
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({
      headless: true,
      channel: process.platform === "win32" ? "chrome" : "chromium",
    });
  }
  const errors = [],
    contexts = [];
  async function page(configure) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    contexts.push(context);
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await configure?.(p);
    await p.goto(base);
    return p;
  }
  const admin = await page();
  await admin.locator(".cover-login").click();
  assert.equal(await admin.locator("#app").isVisible(), false);
  // The test login grants no room access.
  const unauthorized = await fetch(base + "/api/rooms/not-a-room");
  assert.equal(unauthorized.status, 401);
  await admin.locator("#memberIds").fill("alice,bob");
  await admin.locator("#context").fill("Synthetic interface regression");
  await until(async()=>!(await admin.locator("#connection-status").innerText()).includes("Connecting"));
  const created=admin.waitForResponse(r=>r.url().endsWith("/api/rooms") && r.request().method()==="POST");
  await admin.locator("#create").click();
  const room=await (await created).json();
  await admin.locator("#credentials").waitFor();
  await admin
    .getByRole("button", { name: "Open administrator view", exact: true })
    .click();
  await admin.locator("#app").waitFor({ state: "visible" });
  const pages = {},
    tokens = {};
  async function api(path, body, token) {
    const r = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(r.ok, "HTTP " + r.status);
    return r.json();
  }
  const view = (member) =>
    api("/rooms/" + room.room_id, undefined, tokens[member]);
  async function sync(p) {
    await p.locator("#refresh").click();
    await until(() => p.locator("#refresh").isEnabled());
    assert.equal(await p.locator("#error").isVisible(), false);
  }
  for (const member of ["alice", "bob"]) {
    const p = await page();
    pages[member] = p;
    await p.locator(".cover-login").click();
    await p.goto(base+"/#"+new URLSearchParams({room:room.room_id,invitation:room.invitations[member]}));
    await until(async()=>new URL(p.url()).hash === "");
    assert.equal(await p.locator("#roomId").inputValue(),room.room_id);
    await p.locator("#join").click();
    await p.locator("#app").waitFor({ state: "visible" });
    tokens[member] = JSON.parse(
      await p.evaluate(() => sessionStorage.getItem("conclave-auth")),
    ).token;
  }
  const a = pages.alice,
    b = pages.bob;
  await admin.locator("#account-panel > summary").click();
  await admin.locator("#room-deepseek").fill("test-browser-private-deepseek");
  await admin.locator("#room-tavily").fill("test-browser-private-tavily");
  await admin.getByRole("button",{name:"Save room keys",exact:true}).click();
  await until(()=>admin.locator("#key-status").innerText().then(t=>t.includes("Using your room keys")));
  assert.equal(await admin.locator("#room-deepseek").inputValue(),"");
  assert.equal(await admin.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}).includes("test-browser-private")),false);
  await admin.locator("#room-provider").selectOption("openai");
  assert.equal(await admin.locator("#room-deepseek").isVisible(), false);
  await admin.locator("#room-openai").fill("sk-test-browser-private-openai");
  await admin.locator("#room-model").fill("gpt-4.1-mini");
  await admin.locator("#room-tavily").fill("test-browser-private-tavily");
  const openaiSaved = admin.waitForResponse(r => r.url().endsWith("/keys") && r.request().method() === "POST");
  await admin.getByRole("button", {name:"Save room keys",exact:true}).click();
  assert.equal((await openaiSaved).status(), 200);
  assert.equal(await admin.locator("#room-openai").inputValue(), "");
  assert.equal(await admin.locator("#room-tavily").inputValue(), "");
  assert.equal(await admin.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}).includes("test-browser-private")),false);
  await admin.locator("#room-provider").selectOption("deepseek");
  assert.equal(await admin.locator("#room-openai").isVisible(), false);
  assert.equal(await admin.locator("#room-deepseek").isVisible(), true);
  await a.getByRole("button",{name:"Mark myself away",exact:true}).click();
  await until(async()=>!(await view("alice")).members.alice.available);
  await a.getByRole("button",{name:"I'm back",exact:true}).click();
  await until(async()=>(await view("alice")).members.alice.available);
  const oldAuth=JSON.parse(await a.evaluate(()=>sessionStorage.getItem("conclave-auth")));
  await a.locator("#logout").click();
  await a.locator("#entry").waitFor({state:"visible"});
  await a.locator("#roomId").fill(room.room_id);
  await a.locator("#recover-panel > summary").click();
  await a.locator("#recover-member").fill("alice");
  await a.locator("#recover-code").fill(oldAuth.recovery_code);
  const [recoveryDownload]=await Promise.all([a.waitForEvent("download"),a.locator("#recover").click()]);
  await recoveryDownload.saveAs(join(folder,"recovery.json"));
  const recovered=JSON.parse(await readFile(join(folder,"recovery.json"),"utf8"));
  assert.equal(recovered.role,"member");assert.notEqual(recovered.recovery_code,oldAuth.recovery_code);
  await a.locator("#app").waitFor({state:"visible"});
  tokens.alice=JSON.parse(await a.evaluate(()=>sessionStorage.getItem("conclave-auth"))).token;
  const revoked=await fetch(base+"/api/rooms/"+room.room_id,{headers:{Authorization:"Bearer "+oldAuth.token}});
  assert.equal(revoked.status,403);
  await until(
    async () => (await view("alice")).private.stage === "awaiting_answers",
  );
  await sync(a);
  await a
    .locator("#private textarea")
    .first()
    .fill("Draft retained through refresh and language changes");
  await a.getByRole("button", { name: "中文", exact: true }).click();
  assert.equal(
    await a.locator("#private textarea").first().inputValue(),
    "Draft retained through refresh and language changes",
  );
  await a.getByRole("button", { name: "EN", exact: true }).click();
  await sync(a);
  assert.equal(
    await a.locator("#private textarea").first().inputValue(),
    "Draft retained through refresh and language changes",
  );
  await a.reload();
  await a.locator("#private textarea").first().waitFor();
  assert.equal(
    await a.locator("#private textarea").first().inputValue(),
    "Draft retained through refresh and language changes",
  );
  await a.getByRole("button", { name: "Light", exact: true }).click();
  assert.equal(await a.locator("html").getAttribute("data-theme"), "light");
  await a.getByRole("button", { name: "Dark", exact: true }).click();
  for (let round = 1; round <= 4; round++) {
    for (const member of ["alice", "bob"]) {
      const p = pages[member];
      await until(
        async () => (await view(member)).private.stage === "awaiting_answers",
      );
      await sync(p);
      await p.locator('[data-view="interview"]').click();
      for (const field of await p.locator("#private textarea").all())
        await field.fill("PRIVATE-" + member + "-" + round);
      await p
        .getByRole("button", { name: "Submit private answers", exact: true })
        .click();
      await until(
        async () =>
          (await view(member)).private.stage === "awaiting_profile_approval",
      );
      await sync(p);
      const fields = await p.locator("#private textarea").all();
      for (const [index, field] of fields.entries())
        await field.fill(
          index === 0
            ? "Public " +
                member +
                ' <img src=x onerror="window.uiInjected=true">'
            : "",
        );
      await p
        .getByRole("button", {
          name: "Approve and share this summary",
          exact: true,
        })
        .click();
      await until(
        async () => (await view(member)).private.stage === "approved",
      );
    }
    await until(
      async () => (await view("alice")).phase === "awaiting_difference_answers",
    );
    const v = await view("alice");
    assert.equal(v.discussion_round, round);
    for (const member of v.difference.content.affected_member_ids) {
      const p = pages[member];
      await sync(p);
      await p.locator('[data-view="studio"]').click();
      assert.equal(
        await p
          .getByRole("button", { name: "Generate directions", exact: true })
          .count(),
        0,
      );
      if (v.difference.content.answer_type === "binary")
        await p.locator("#discussion select").selectOption({ index: 1 });
      await p.locator("#discussion textarea").fill("Public answer " + member);
      await p
        .getByRole("button", { name: "Submit difference answer", exact: true })
        .click();
      await until(() => p.locator("#refresh").isEnabled());
    }
    if (round < 4) {
      await until(
        async () => (await view("alice")).discussion_round === round + 1,
      );
      assert.deepEqual((await view("alice")).candidates, {});
    }
  }
  await until(
    async () => (await view("alice")).phase === "awaiting_convergence_decision",
  );
  for (const member of ["alice", "bob"]) {
    await sync(pages[member]);
    await pages[member]
      .getByRole("button", { name: "Generate directions", exact: true })
      .click();
    await until(() => pages[member].locator("#refresh").isEnabled());
  }
  await until(async () => (await view("alice")).phase === "awaiting_review");
  await sync(a);
  await sync(b);
  await sync(admin);
  assert.ok(!(await b.locator("body").textContent()).includes("PRIVATE-alice"));
  assert.ok(!(await a.locator("body").textContent()).includes("PRIVATE-bob"));
  assert.ok(!(await admin.locator("body").textContent()).includes("PRIVATE-"));
  assert.equal(await a.evaluate(() => !!window.uiInjected), false);
  assert.equal(await a.locator("#sources img").count(), 0);
  assert.equal(
    await admin
      .getByRole("button", { name: "Accept this version", exact: true })
      .count(),
    0,
  );
  // Candidate tabs are backed by actual IDs; switching changes the review target.
  const ids = Object.keys((await view("alice")).candidates);
  assert.ok(ids.length > 1);
  await a.locator('#candidates [role="tab"]').nth(1).click();
  assert.equal(
    await a
      .locator('#candidates [role="tab"]')
      .nth(1)
      .getAttribute("aria-selected"),
    "true",
  );
  await a.locator('#candidates [role="tab"]').first().click();
  await a.screenshot({
    path: join(screenshots, "interface-studio.png"),
    fullPage: true,
  });
  await a.setViewportSize({ width: 375, height: 812 });
  await a.getByRole("button", { name: "Light", exact: true }).click();
  await a.screenshot({
    path: join(screenshots, "interface-mobile.png"),
    fullPage: true,
  });
  assert.ok(
    await a.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Mobile must not overflow horizontally",
  );
  await a.setViewportSize({ width: 1440, height: 1000 });
  await a.getByRole("button", { name: "Dark", exact: true }).click();
  const firstVersion = (await view("alice")).candidates[ids[0]].candidate_ref
    .version;
  for (const member of ["alice", "bob"]) {
    const p = pages[member];
    await sync(p);
    await p
      .locator("#reviews textarea")
      .fill("Reduce the scope to one offline demo.");
    await p
      .getByRole("button", { name: "Request a small revision", exact: true })
      .click();
    await until(() => p.locator("#refresh").isEnabled());
  }
  await until(async () => {
    const v = await view("alice");
    return (
      v.phase === "awaiting_review" &&
      v.candidates[ids[0]].candidate_ref.version > firstVersion
    );
  });
  assert.deepEqual((await view("alice")).reviews[ids[0]] || {}, {});
  for (const member of ["alice", "bob"]) {
    const p = pages[member];
    await sync(p);
    await p
      .getByRole("button", { name: "Accept this version", exact: true })
      .click();
    await until(() => p.locator("#refresh").isEnabled());
    if (member === "alice")
      assert.equal((await view("alice")).final_output, null);
  }
  await until(async () => (await view("alice")).phase === "completed");
  await sync(a);
  await a.locator('[data-view="brief"]').click();
  const [download] = await Promise.all([
    a.waitForEvent("download"),
    a
      .getByRole("button", { name: "Export accepted brief", exact: true })
      .click(),
  ]);
  const file = join(folder, "brief.txt");
  await download.saveAs(file);
  assert.ok((await readFile(file, "utf8")).includes("Reduce the scope"));
  await a.reload();
  await a.locator("#app").waitFor({ state: "visible" });
  assert.ok(
    (await a.locator("#status").innerText()).includes("Agreed by the team"),
  );
  await a.locator("#logout").click();
  await a.locator("#entry").waitFor({ state: "visible" });
  assert.equal(
    await a.evaluate(() => sessionStorage.getItem("conclave-auth")),
    null,
  );
  assert.equal(
    await a.evaluate(() =>
      Object.keys(sessionStorage).some((k) => k.startsWith("considea-drafts:")),
    ),
    false,
  );
  // Exercise live key-entry controls against the mock backend, without paid model calls.
  const creator = await page(async p => {
    await p.route("**/api/capabilities", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), live: true, shared_demo_available: false } });
    });
  });
  await creator.locator(".cover-login").click();
  await creator.locator("#create-provider").selectOption("openai");
  assert.equal(await creator.locator("#create-deepseek").isVisible(), false);
  assert.equal(await creator.locator("#create-openai").isVisible(), true);
  await creator.locator("#create-model").fill("gpt-4.1-mini");
  await creator.setViewportSize({width:375,height:900});
  assert.ok(await creator.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await creator.screenshot({path:join(screenshots,"openai-creation-mobile.png"),fullPage:true});
  await creator.locator("#memberIds").fill("alice,bob");
  await creator.locator("#context").fill("Synthetic OpenAI room creation");
  await creator.locator("#create-openai").fill("sk-test-create-private-openai");
  await creator.locator("#create-tavily").fill("test-create-private-tavily");
  const openaiCreated = creator.waitForResponse(r => r.url().endsWith("/api/rooms") && r.request().method() === "POST");
  await creator.locator("#create").click();
  const creation = await openaiCreated;
  assert.equal(creation.status(), 201);
  const posted = creation.request().postDataJSON();
  assert.equal(posted.credentials.provider, "openai");
  assert.equal(posted.credentials.model, "gpt-4.1-mini");
  assert.equal(posted.credentials.deepseek_api_key, undefined);
  assert.equal(await creator.locator("#create-openai").inputValue(), "");
  assert.equal(await creator.locator("#create-tavily").inputValue(), "");
  assert.equal(await creator.evaluate(() => JSON.stringify({...sessionStorage,...localStorage}).includes("test-create-private")), false);
  // The saved replay must work without a room, credentials or API requests.
  const replayContext = await browser.newContext({viewport:{width:1440,height:1000}});
  contexts.push(replayContext);
  const replay = await replayContext.newPage();
  const replayErrors=[],apiRequests=[];
  replay.on("pageerror",e=>replayErrors.push(e.message));
  replay.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/api/"))apiRequests.push(r.url());});
  await replay.goto(base+"/demo.html");
  await until(async()=> (await replay.locator("#demo-status").innerText()).startsWith("Recorded "));
  await until(()=>replay.locator("video").evaluate(v=>Number.isFinite(v.duration)&&v.duration>70&&v.duration<100));
  await replay.locator("video").evaluate(v=>{v.muted=true;return v.play();});
  await until(()=>replay.locator("video").evaluate(v=>v.currentTime>0.2));
  await replay.locator("video").evaluate(v=>{v.pause();v.currentTime=71;});
  await until(()=>replay.locator("video").evaluate(v=>!v.seeking&&v.readyState>=2));
  for (const width of [1440,375]) {
    await replay.setViewportSize({width,height:900});
    while(await replay.locator("#previous").isEnabled())await replay.locator("#previous").click();
    for(let step=1;step<=8;step++) {
      assert.equal(await replay.locator("#step-position").innerText(),`${step} / 8`);
      assert.ok((await replay.locator("#step-body").innerText()).length>30);
      assert.ok(await replay.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Replay must fit the viewport");
      if(step<8){await replay.locator("#next").focus();await replay.keyboard.press("Enter");}
    }
    assert.ok(await replay.locator("#next").isDisabled());
  }
  assert.deepEqual(apiRequests,[]);
  assert.deepEqual(replayErrors,[]);
  await replay.screenshot({path:join(screenshots,"replay-mobile.png"),fullPage:true});
  assert.deepEqual(errors, []);
  console.log(
    "PASS: workspace entry, room creation/join/admin, drafts/reload/languages/themes, four UI rounds, human gates, private data isolation, safe text rendering, real candidate tabs, mobile layout, small revision/re-evaluation, unanimous acceptance, accepted brief export, logout; public replay and video, keyboard navigation, no API calls or page errors.",
  );
} finally {
  if (browser) await browser.close();
  worker.kill();
  await Promise.race([new Promise((r) => worker.once("exit", r)), delay(3000)]);
  await rm(folder, { recursive: true, force: true, maxRetries: 3 });
}
