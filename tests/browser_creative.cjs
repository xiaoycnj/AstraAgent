/* Desktop interaction regression using an isolated server and profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = path.resolve(__dirname, "..");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "astra-shared-ui-"));
  const data = path.join(folder, "data");
  const python = path.join(root, "runtimes/python/python.exe");
  const server = spawn(
    python,
    ["-u", "server.py", "--port", "0", "--data-dir", data],
    {
      cwd: root,
      env: { ...process.env, PYTHONUTF8: "1" },
      windowsHide: true,
    },
  );
  let log = "",
    browser;
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));
  try {
    for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+/.test(log); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, log);
    const token = execFileSync(
      python,
      [
        "-c",
        "import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))",
        data,
      ],
      { cwd: root, windowsHide: true },
    )
      .toString()
      .trim();
    browser = await chromium.launch({
      headless: true,
      executablePath:
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url + "/#access=" + token);
    await page.waitForFunction(
      () =>
        state.token &&
        state.settings &&
        document.querySelector(".command-launcher"),
    );

    const ids = await page.evaluate(async () => {
      await newSession();
      const session = state.session;
      const creation = await api("/api/creations", "POST", {
        session_id: session.id,
        name: "index.html",
        content:
          '<html><head><title>Static title</title></head><body><h1>Preview title</h1><script>document.body.innerHTML="UNSAFE"</script></body></html>',
      });
      const story = await api("/api/stories", "POST", {
        title: "Browser Novel",
      });
      const entry = await api("/api/stories/" + story.id + "/entries", "PUT", {
        kind: "chapter",
        title: "First chapter",
        content: "Initial content",
        position: 0,
      });
      const task = await api("/api/evaluations", "PUT", {
        name: "Scheduled fixture",
        prompt: "Reply fixture",
        category: "story",
        expected_files: [],
        expected_outputs: [],
        require_checks: false,
        manual_review: true,
        project_id: "",
      });
      return {
        session: session.id,
        creation: creation.id,
        story: story.id,
        entry: entry.id,
        task: task.id,
      };
    });
    await page.evaluate(() => navigatePage("creator"));
    await page
      .getByRole("heading", { name: "作品工作台", exact: true })
      .waitFor();
    await page.locator(".creative-frame").waitFor();
    assert.equal(
      await page.locator(".creative-frame").getAttribute("sandbox"),
      "",
    );
    const frame = page.frameLocator(".creative-frame");
    await frame.getByRole("heading", { name: "Preview title" }).waitFor();
    assert.equal(await frame.locator("script").count(), 0);
    await page.getByText("编辑源文件", { exact: true }).click();
    await page
      .locator(".creative-editor")
      .fill("<html><body><h1>Saved version</h1></body></html>");
    await page.getByRole("button", { name: "保存新版本", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".creative-frame")?.contentWindow !== null &&
        document.querySelector(".creative-detail select")?.options.length === 2,
    );
    await page
      .getByRole("button", { name: "浏览器检查与 PDF", exact: true })
      .click();
    await page
      .locator(".creative-report a")
      .first()
      .waitFor({ timeout: 45000 });
    assert.equal(await page.locator(".creative-report a").count(), 2);
    await page.screenshot({
      path: path.join(root, "work/ui-creator-studio.png"),
    });
    await page.evaluate(() => navigatePage("story"));
    await page.getByRole("heading", { name: "Browser Novel" }).waitFor();
    await page
      .locator(".story-editor textarea")
      .fill("Revised through normal editor");
    await page.getByRole("button", { name: "保存条目", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".story-editor")?.dataset.revision === "2",
    );
    await page.getByRole("button", { name: "历史版本", exact: true }).click();
    await page.getByRole("button", { name: "V1", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "绑定当前会话", exact: true })
      .click();
    await page.waitForFunction(() => state.session.story_id);
    const revised = await page.evaluate(
      async (ids) => ({
        story: await api("/api/stories/" + ids.story),
        sessions: await api("/api/sessions"),
      }),
      ids,
    );
    assert.equal(revised.story.entries[0].revision, 2);
    assert.equal(
      revised.sessions.find((s) => s.id === ids.session).story_id,
      ids.story,
    );
    const exported = await page.evaluate(async (id) => {
      const r = await fetch("/api/stories/" + id + "/export/docx", {
        headers: { "X-App-Token": state.token },
      });
      return { status: r.status, size: (await r.arrayBuffer()).byteLength };
    }, ids.story);
    assert.equal(exported.status, 200);
    assert.ok(exported.size > 1000);
    await page.screenshot({
      path: path.join(root, "work/ui-story-studio.png"),
    });
    await page.evaluate(() => navigatePage("schedule"));
    await page
      .getByRole("heading", { name: "定时任务", exact: true })
      .waitFor();
    await page
      .locator(".destination-body")
      .getByLabel("任务名称", { exact: true })
      .fill("UI schedule");
    await page
      .getByRole("button", { name: "保存定时任务", exact: true })
      .click();
    await page.getByRole("heading", { name: "UI schedule" }).waitFor();
    const schedules = await page.evaluate(() => api("/api/schedules"));
    assert.equal(schedules[0].enabled, false);
    await page.evaluate(async (job) => {
      await api("/api/schedules", "PUT", { ...job, enabled: true });
      await navigatePage("schedule");
    }, schedules[0]);
    await page
      .getByRole("button", { name: "暂停后续触发", exact: true })
      .click();
    await page.waitForFunction(
      async () => !(await api("/api/schedules"))[0].enabled,
    );
    for (const view of ["creator", "story", "schedule"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((view) => navigatePage(view), view);
      const overflow = await page
        .locator(".destination-page")
        .evaluate((e) => e.scrollWidth - e.clientWidth);
      assert.ok(overflow <= 1, view + " overflows " + overflow);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const pixels = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const c = canvas.getContext("2d");
      c.fillStyle = "orange";
      c.fillRect(0, 0, 128, 128);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    execFileSync(
      python,
      [
        "-c",
        'import sys,json;from pathlib import Path;import backend,attachments,creation_store;backend.DATA=Path(sys.argv[1]);item=attachments.upload(backend.DATA,{"name":"fixture.png","data":sys.argv[3]});\nwith backend.database() as db:\n db.execute("INSERT INTO session_outputs(session_id,attachment_id) VALUES(?,?)",(sys.argv[2],item["id"]));creation_store.register(db,sys.argv[2],item)',
        data,
        ids.session,
        pixels,
      ],
      { cwd: root, windowsHide: true },
    );
    await page.evaluate(() => navigatePage("creator"));
    await page
      .getByRole("button", { name: "绘制编辑蒙版", exact: true })
      .click();
    const canvas = page.locator(".mask-canvas");
    await canvas.waitFor();
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 10,
      bounds.y + bounds.height / 2 + 10,
    );
    await page.mouse.up();
    await page
      .getByRole("button", { name: "准备编辑请求", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        appPage === "home" &&
        pendingAttachments.some((item) => item.name === "edit-mask.png"),
    );
    const prepared = await page.evaluate(async () => {
      const mask = pendingAttachments.find(
        (item) => item.name === "edit-mask.png",
      );
      const image = new Image();
      image.src = "/api/attachments/" + mask.id + "/content";
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const c = canvas.getContext("2d");
      c.drawImage(image, 0, 0);
      return {
        alpha: c.getImageData(64, 64, 1, 1).data[3],
        prompt: $("#chat-input").value,
        plugins: runtimePlugins,
        attachments: pendingAttachments.length,
      };
    });
    assert.equal(prepared.alpha, 0);
    assert.ok(prepared.prompt.includes("mask="));
    assert.ok(prepared.plugins.includes("image-generation"));
    assert.equal(prepared.attachments, 2);
    for (const [language, title] of [
      ["en", "Writing projects"],
      ["ja", "執筆プロジェクト"],
      ["zh-CN", "写作项目"],
    ]) {
      await page.evaluate(async (language) => {
        selectedLanguage = language;
        applyUiLanguage();
        await navigatePage("story");
      }, language);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.equal(
        await page.locator(".creative-detail h2").textContent(),
        "Browser Novel",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        creator_versions: true,
        sandbox_preview: true,
        browser_png_pdf: true,
        story_revisions: true,
        story_binding: true,
        docx_download: true,
        schedule_saved: true,
        responsive: true,
        mask_paint_and_stage: true,
        page_errors: errors,
      }),
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((resolve) =>
      server.exitCode !== null ? resolve() : server.once("exit", resolve),
    );
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
