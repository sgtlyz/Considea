// Real HTTP responses for a personal clarification; synthetic state, no live model calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const worker = spawn(process.env.PYTHON || "python", ["-u", "-c", `
import json
from workflow.tests.test_privacy import PrivacyTests
from workflow.server import make_server
fixture = PrivacyTests()
fixture.setUp()
fixture.prepare()
for _ in range(3):
    fixture.answer()
    fixture.complete_interviews()
server = make_server(fixture.engine, port=0)
print(json.dumps({"base": "http://127.0.0.1:" + str(server.server_port),
    "room_id": fixture.room, "tokens": {**fixture.tokens, "admin": fixture.created["admin_token"]}}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
    fixture.tearDown()
`], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
let browser, stderr = "";
worker.stderr.on("data", b => stderr += b.toString());
try {
  const fixture = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Privacy fixture startup timed out")), 20000);
    worker.stdout.on("data", b => {
      output += b.toString();
      if (output.includes("\n")) { clearTimeout(timer); resolve(JSON.parse(output.split("\n")[0])); }
    });
    worker.on("error", reject);
    worker.on("exit", code => { clearTimeout(timer); reject(Error("Fixture exited " + code + " " + stderr)); });
  });
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "chrome" : "chromium" }); }
  const pages = {}, errors = [];
  const markers = ["PERSONAL-CONFLICT-ONLY-ALICE", "PERSONAL-ANSWER-ONLY-ALICE", "Approved public goal for alice"];
  const observerResponses = [];
  for (const member of ["alice", "bob", "admin"]) {
    const context = await browser.newContext({ viewport: { width: member === "bob" ? 390 : 1440, height: 950 }, reducedMotion: "reduce" });
    await context.addInitScript(auth => sessionStorage.setItem("conclave-auth", JSON.stringify(auth)),
      { room_id: fixture.room_id, token: fixture.tokens[member] });
    const page = pages[member] = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    if (member !== "alice") page.on("response", response => {
      if (response.url().endsWith("/api/rooms/" + fixture.room_id))
        observerResponses.push(response.text().then(text => {
          for (const marker of markers) assert.ok(!text.includes(marker), "Private content leaked in HTTP response");
        }));
    });
    await page.goto(fixture.base);
    await page.locator("#app").waitFor({ state: "visible" });
    await page.locator('[data-view="studio"]').click();
    await page.locator("#discussion h2").waitFor();
  }
  const a = pages.alice, b = pages.bob, admin = pages.admin;
  assert.match(await a.locator("#discussion").innerText(), /your confirmation/);
  assert.match(await a.locator("#discussion").innerText(), /Your answer or context \(private\)/);
  await a.getByRole("button", { name: "Confirm my statements", exact: true }).waitFor();
  for (const p of [b, admin]) {
    assert.match(await p.locator("#discussion").innerText(), /No action is needed from you yet/);
    assert.equal(await p.locator("#discussion textarea").count(), 0);
    for (const marker of markers) assert.ok(!(await p.locator("body").innerText()).includes(marker));
  }
  await b.locator('[data-language="zh"]').click();
  assert.match(await b.locator("#discussion").innerText(), /你暂时无需操作/);
  await b.locator('[data-language="en"]').click();
  const updated = a.waitForResponse(r => r.url().endsWith("/events") && r.request().method() === "POST");
  await a.locator("#discussion textarea").fill("PERSONAL-ANSWER-ONLY-ALICE");
  await a.getByRole("button", { name: "Confirm my statements", exact: true }).click();
  assert.equal((await (await updated).json()).status, "accepted");
  await a.getByRole("button", { name: "Generate directions", exact: true }).waitFor();
  for (const p of [b, admin]) {
    await p.locator("#refresh").click();
    await p.getByText("The member has answered privately. Their clarification is not a team split.", { exact: true }).waitFor();
    for (const marker of markers) assert.ok(!(await p.locator("body").innerText()).includes(marker));
  }
  // A hidden personal question must not hide the later team convergence controls.
  const vote = b.waitForResponse(r => r.url().endsWith("/events") && r.request().method() === "POST");
  await b.locator("#discussion textarea").fill("Ready based on the shared team goals");
  await b.getByRole("button", { name: "Generate directions", exact: true }).click();
  assert.equal((await (await vote).json()).status, "accepted");
  const response = await fetch(fixture.base + "/api/rooms/" + fixture.room_id,
    { headers: { Authorization: "Bearer " + fixture.tokens.bob } });
  assert.equal((await response.json()).phase, "awaiting_convergence_decision");
  await Promise.all(observerResponses);
  assert.deepEqual(errors, []);
  console.log("PASS: personal confirmation, private HTTP payloads, observer/admin waiting, Chinese/mobile UI, team convergence gate");
} finally {
  await browser?.close();
  worker.kill();
}
