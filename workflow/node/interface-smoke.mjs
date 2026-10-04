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
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
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
  async function page() {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    contexts.push(context);
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    return p;
  }
  const admin = await page();
  await admin.getByRole("button", { name: "Enter test workspace" }).click();
  assert.equal(await admin.locator("#app").isVisible(), false);
  // The test login grants no room access.
  const unauthorized = await fetch(base + "/api/rooms/not-a-room");
  assert.equal(unauthorized.status, 401);
  await admin.locator("#memberIds").fill("alice,bob");
  await admin.locator("#context").fill("Synthetic interface regression");
  await admin.locator("#create").click();
  await admin.locator("#credentials textarea").waitFor();
  const room = JSON.parse(
    await admin.locator("#credentials textarea").inputValue(),
  );
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
    await p.getByRole("button", { name: "Enter test workspace" }).click();
    await p.locator("#roomId").fill(room.room_id);
    await p.locator("#invitation").fill(room.invitations[member]);
    await p.locator("#join").click();
    await p.locator("#app").waitFor({ state: "visible" });
    tokens[member] = JSON.parse(
      await p.evaluate(() => sessionStorage.getItem("conclave-auth")),
    ).token;
  }
  const a = pages.alice,
    b = pages.bob;
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
  assert.deepEqual(errors, []);
  console.log(
    "PASS: test login, room creation/join/admin, drafts/reload/languages/themes, four UI rounds, human gates, private data isolation, safe text rendering, real candidate tabs, mobile layout, small revision/re-evaluation, unanimous acceptance, accepted brief export, logout; no page errors.",
  );
} finally {
  if (browser) await browser.close();
  worker.kill();
  await Promise.race([new Promise((r) => worker.once("exit", r)), delay(3000)]);
  await rm(folder, { recursive: true, force: true, maxRetries: 3 });
}
