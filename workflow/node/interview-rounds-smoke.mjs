// Real browser -> local HTTP -> SQLite -> mock interviews. Never calls a live model.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const folder = await mkdtemp(join(tmpdir(), "considea-rounds-"));
const worker = spawn(process.env.PYTHON || "python", ["-m", "workflow", "--mode", "mock", "--port", "0", "--db", join(folder, "test.sqlite3")], {
  cwd: root, env: { ...process.env, CONCLAVE_SECRET_KEY: Buffer.alloc(32, 1).toString("base64") }, stdio: ["ignore", "pipe", "pipe"],
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error("Timed out waiting for interview state");
}
let browser, stderr = "";
worker.stderr.on("data", data => { stderr += data; });
try {
  const base = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Server startup timed out: " + stderr)), 15000);
    worker.stdout.on("data", data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    worker.on("error", reject);
    worker.on("exit", code => { clearTimeout(timer); reject(Error(`Server exited ${code}: ${stderr}`)); });
  });
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "chrome" : "chromium" }); }
  const errors = [];
  async function page() {
    const context = await browser.newContext();
    const p = await context.newPage();
    p.on("pageerror", error => errors.push(error.message));
    await p.goto(base);
    await p.locator(".cover-login").click();
    return p;
  }
  async function view(room, token) {
    const response = await fetch(`${base}/api/rooms/${room}`, { headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function sync(p) {
    await p.locator("#refresh").click();
    await until(() => p.locator("#refresh").isEnabled());
    assert.equal(await p.locator("#error").isVisible(), false);
  }
  for (const cap of [3, 1, 7]) {
    const creator = await page();
    const input = creator.locator("#interviewRounds");
    assert.equal(await input.inputValue(), "3");
    assert.equal(await input.getAttribute("min"), "1");
    assert.equal(await input.getAttribute("max"), "7");
    assert.equal(await input.getAttribute("step"), "1");
    await creator.locator("#memberIds").fill("alice,bob");
    await creator.locator("#context").fill("Synthetic interview cap regression");
    await until(async () => !(await creator.locator("#connection-status").innerText()).includes("Connecting"));
    let createRequests = 0;
    creator.on("request", request => {
      if (request.url().endsWith("/api/rooms") && request.method() === "POST") createRequests++;
    });
    if (cap === 3) {
      for (const invalid of ["", "0", "8", "1.5"]) {
        await input.fill(invalid);
        await creator.locator("#create").click();
        await delay(150);
        assert.equal(createRequests, 0, `Invalid value ${JSON.stringify(invalid)} must not create a room`);
      }
    }
    await input.fill(String(cap));
    for (const language of ["zh", "en"]) {
      await creator.locator(`#workspace [data-language="${language}"]`).click();
      assert.equal(await input.inputValue(), String(cap));
      assert.ok((await creator.locator("#interview-rounds-help").innerText()).length > 10);
    }
    if (cap === 3) {
      await creator.setViewportSize({ width: 375, height: 900 });
      assert.ok(await creator.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await mkdir(join(root, "workflow", "data"), { recursive: true });
      await creator.screenshot({ path: join(root, "workflow", "data", "interview-rounds-settings.png"), fullPage: true });
    }
    const responsePromise = creator.waitForResponse(response => response.url().endsWith("/api/rooms") && response.request().method() === "POST");
    await creator.locator("#create").click();
    const response = await responsePromise;
    assert.equal(response.status(), 201);
    assert.equal(response.request().postDataJSON().config.question_batches_per_round, cap);
    assert.equal(createRequests, 1);
    const room = await response.json();
    assert.equal((await view(room.room_id, room.admin_token)).config.question_batches_per_round, cap);

    const member = await page();
    await member.goto(base + "/#" + new URLSearchParams({ room: room.room_id, invitation: room.invitations.alice }));
    await until(async () => new URL(member.url()).hash === "");
    await member.locator("#join").click();
    await member.locator("#app").waitFor({ state: "visible" });
    const token = JSON.parse(await member.evaluate(() => sessionStorage.getItem("conclave-auth"))).token;
    const current = () => view(room.room_id, token);
    const batchRefs = new Set();
    for (let round = 1; round <= cap; round++) {
      await until(async () => (await current()).private.stage === "awaiting_answers");
      const state = await current();
      assert.equal(state.config.question_batches_per_round, cap);
      assert.equal(state.private.batches_asked, round);
      const batchRef = JSON.stringify(state.private.question_batch.question_batch_ref);
      assert.equal(batchRefs.has(batchRef), false);
      batchRefs.add(batchRef);
      await sync(member);
      assert.equal(await member.locator("#interview-progress").innerText(), `Interview round ${round} of ${cap}`);
      await member.locator('#workspace [data-language="zh"]').click();
      assert.equal(await member.locator("#interview-progress").innerText(), `访谈第 ${round} / ${cap} 轮`);
      await member.locator('#workspace [data-language="en"]').click();
      await member.reload();
      await member.locator("#interview-progress").waitFor({ state: "visible" });
      assert.equal(await member.locator("#interview-progress").innerText(), `Interview round ${round} of ${cap}`);
      assert.equal((await current()).config.question_batches_per_round, cap);
      for (const field of await member.locator("#private textarea").all()) await field.fill(`Synthetic answer ${round}`);
      await member.getByRole("button", { name: "Submit private answers", exact: true }).click();
      await until(async () => {
        const next = (await current()).private;
        return round === cap ? next.stage === "awaiting_profile_approval" : next.stage === "awaiting_answers" && next.batches_asked === round + 1;
      });
    }
    const completed = (await current()).private;
    assert.equal(completed.batches_asked, cap);
    assert.equal(completed.question_batch, null);
    assert.equal(batchRefs.size, cap);
    await sync(member);
    await member.getByRole("button", { name: "Approve and share this summary", exact: true }).waitFor();
    assert.equal(await member.getByRole("button", { name: "Submit private answers", exact: true }).count(), 0);
    await member.reload();
    await member.getByRole("button", { name: "Approve and share this summary", exact: true }).waitFor();
    assert.equal((await current()).private.batches_asked, cap);
    await creator.context().close();
    await member.context().close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS: interview default 3, custom 1/7 persisted, invalid inputs blocked before HTTP, language-preserved configuration, bilingual progress and reload, exact cap reaches summary without extra questions; mock only.");
} finally {
  if (browser) await browser.close();
  const exited = new Promise(resolve => worker.once("exit", resolve));
  worker.kill();
  await Promise.race([exited, delay(3000)]);
  await rm(folder, { recursive: true, force: true, maxRetries: 3 });
}
