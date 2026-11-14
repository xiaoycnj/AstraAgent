/* Desktop interaction regression using an isolated server and profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = path.resolve(__dirname, "..");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "astra-design-ui-"));
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
    await page.evaluate(() => {
      showSettings();
      selectSettingsTab("connection");
    });
    assert.equal(
      await page.locator(".routing-disclosure").getAttribute("open"),
      null,
    );
    await page.locator("#provider-add").click();
    await page.locator(".provider-dialog[open]").waitFor();
    assert.equal(
      await page.locator(".provider-dialog .settings-disclosure[open]").count(),
      0,
    );
    await page.locator("#provider-name").fill("Design fixture");
    await page.locator("#base-url").fill("http://127.0.0.1:9/v1");
    // A real click verifies that the listbox belongs to the native dialog top layer.
    await page.screenshot({
      path: path.join(root, "work/design-provider.png"),
    });
    await page
      .locator(".provider-dialog summary")
      .filter({ hasText: "高级设置" })
      .click();
    const trigger = page.locator("#registry-vendor + .custom-select");
    await trigger.click();
    assert.equal(
      await page.locator(".provider-dialog #custom-select-menu").count(),
      1,
    );
    await page.locator("#custom-select-menu .select-option").last().click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await page
      .locator(".provider-dialog summary")
      .filter({ hasText: "开发者设置" })
      .click();
    assert.equal(await page.locator("#timeout").isVisible(), true);
    await page.locator("#timeout").fill("1");
    await page
      .locator(".provider-dialog summary")
      .filter({ hasText: "开发者设置" })
      .click();
    await page.locator("#provider-save").click();
    assert.equal(await page.locator("#timeout").isVisible(), true);
    assert.equal(
      await page
        .locator("#timeout")
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.locator("#timeout").fill("90");
    await page.evaluate(() => {
      settingsDirty = false;
      providerDialog.close();
    });
    assert.equal(
      await page
        .locator("#provider-add")
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.locator(".routing-disclosure>summary").click();
    assert.equal(await page.locator("#auto-judge-model").isVisible(), false);
    await page.locator("#auto-routing-mode + .custom-select").click();
    await page
      .locator("#custom-select-menu .select-option")
      .filter({ hasText: "AI 路由" })
      .click();
    assert.equal(await page.locator("#auto-judge-model").isVisible(), true);
    // Keyboard palette restores focus, filters, navigates and invokes normal routes.
    await page.evaluate(() => closeSettingsPage());
    await page.locator("#chat-input").focus();
    await page.keyboard.press("Control+k");
    await page.locator(".command-palette[open]").waitFor();
    await page.locator(".command-palette input").fill("没有这个操作");
    assert.equal(await page.locator(".command-result").count(), 0);
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelector("#chat-input") === document.activeElement,
    );
    await page.keyboard.press("Control+Shift+p");
    await page.locator(".command-palette input").fill("资料库");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => appPage === "library");
    await page.evaluate(async () => {
      await navigatePage("home");
      await newSession();
    });
    const sid = await page.evaluate(() => state.session.id);
    await page.evaluate((sid) => {
      state.pending.add(sid);
      handleAgentEvent(sid, {
        type: "start",
        model: "AutoModelReview",
        time: Date.now() / 1000 - 5,
        reasoning: "high",
      });
      handleAgentEvent(sid, {
        type: "routing",
        resolved_model: "fixture-model",
        reason: "匹配工具能力与上下文",
        reasoning: "high",
      });
      handleAgentEvent(sid, { type: "tool_start", name: "read_file" });
      document.dispatchEvent(
        new CustomEvent("astra:task-cancel-request", {
          detail: { sid, accepted: true },
        }),
      );
    }, sid);
    await page.waitForFunction(() =>
      document.querySelector(".task-phase").textContent.includes("正在停止"),
    );
    await page.evaluate(
      (sid) => handleAgentEvent(sid, { type: "delta", text: "partial" }),
      sid,
    );
    assert.match(await page.locator(".task-phase").textContent(), /正在停止/);
    await page.evaluate((sid) => {
      handleAgentEvent(sid, {
        type: "cancelled",
        message: "任务已取消",
        usage: { available: true, calls: 2, reported: 1, total: 120 },
      });
      state.pending.delete(sid);
    }, sid);
    await page.waitForFunction(
      () => document.querySelector(".task-phase").textContent === "任务已停止",
    );
    await page.locator("#task-status-strip>summary").click();
    assert.match(
      await page.locator(".task-status-detail").textContent(),
      /120.*1\/2/,
    );
    assert.match(
      await page.locator(".task-status-detail").textContent(),
      /匹配工具能力/,
    );
    const stripText = await page.locator("#task-status-strip").textContent();
    await page.evaluate(() => {
      state.session = { id: 999999, title: "Other" };
      updateHeader();
    });
    await page.waitForFunction(
      () => document.querySelector("#task-status-strip").hidden,
    );
    await page.evaluate((sid) => {
      state.session = { id: sid, title: "Design fixture" };
      updateHeader();
    }, sid);
    await page.waitForFunction(
      () => !document.querySelector("#task-status-strip").hidden,
    );
    assert.equal(
      await page.locator("#task-status-strip").textContent(),
      stripText,
    );
    const associations = await page.evaluate(() => {
      const messages = state.messages,
        runs = state.sessionRuns;
      try {
        state.messages = [
          { id: 901, role: "assistant", content: "Previous answer" },
          { id: 902, role: "assistant", content: "Resumed answer" },
        ];
        state.sessionRuns = [
          {
            status: "failed",
            events: [
              { type: "start", time: 1 },
              { type: "error", time: 2, message: "No saved response" },
            ],
          },
        ];
        renderMessages();
        const orphan = document.querySelectorAll(".execution-summary").length;
        state.sessionRuns = [
          {
            status: "complete",
            events: [
              { type: "start", time: 1 },
              { type: "cancelled", time: 2, message_id: 901 },
              { type: "start", time: 3 },
              { type: "done", time: 4, message_id: 902 },
            ],
          },
        ];
        renderMessages();
        return {
          orphan,
          previous: document
            .querySelectorAll(".message.assistant")[0]
            .querySelectorAll(".execution-summary").length,
          resumed: document
            .querySelectorAll(".message.assistant")[1]
            .querySelectorAll(".execution-summary").length,
        };
      } finally {
        state.messages = messages;
        state.sessionRuns = runs;
        renderMessages();
      }
    });
    assert.deepEqual(associations, { orphan: 0, previous: 0, resumed: 1 });
    const evidence = {
      viewport: [],
      contrast: [],
      message_association: associations,
    };
    async function checkHeatmap(surface, inputType) {
      const days = Array.from({ length: 365 }, (_, index) => ({
        day: new Date(Date.UTC(2025, 10, 14 + index))
          .toISOString()
          .slice(0, 10),
        total: index === 363 ? 10 : index === 364 ? 20 : 0,
        calls: index >= 363 ? 1 : 0,
        unreported: 0,
      }));
      const fixture = {
        days,
        before_total: 0,
        since: Date.UTC(2026, 10, 6) / 1000,
        totals: {
          calls: 2,
          total: 30,
          input: 20,
          output: 10,
          cached: 8,
          unreported: 0,
          input_reported: 2,
          output_reported: 2,
          cached_reported: 2,
        },
        cache: { rate: 0.4 },
        costs: [{ currency: "USD", amount: 0.001 }],
        unpriced_calls: 0,
      };
      await surface.route("**/api/usage?*", (route) =>
        route.fulfill({ json: fixture }),
      );
      await surface.evaluate(() => {
        showSettings();
        selectSettingsTab("profile");
      });
      await surface.waitForFunction(() => usageData?.totals.total === 30);
      await surface
        .locator("#token-activity")
        .evaluate((el) => (el.closest("details").open = true));
      for (const theme of ["light", "dark"]) {
        await surface.evaluate((theme) => applyTheme(theme), theme);
        for (const mode of ["daily", "weekly", "cumulative"]) {
          await surface
            .locator('.token-mode[data-mode="' + mode + '"]')
            .click();
          const layout = await surface
            .locator("#token-activity")
            .evaluate((section) => {
              const cells = [...section.querySelectorAll("button.token-cell")];
              const months = section
                .querySelector(".token-months")
                .getBoundingClientRect();
              return {
                count: cells.length,
                heights: [
                  ...new Set(
                    cells.map((cell) => getComputedStyle(cell).height),
                  ),
                ],
                widths: [
                  ...new Set(cells.map((cell) => getComputedStyle(cell).width)),
                ],
                minHeights: [
                  ...new Set(
                    cells.map((cell) => getComputedStyle(cell).minHeight),
                  ),
                ],
                bottom: Math.max(
                  ...cells.map((cell) => cell.getBoundingClientRect().bottom),
                ),
                monthsTop: months.top,
              };
            });
          assert.deepEqual(
            layout.heights,
            ["12px"],
            JSON.stringify({ inputType, theme, mode, layout }),
          );
          assert.deepEqual(layout.widths, ["12px"]);
          assert.ok(layout.bottom < layout.monthsTop, JSON.stringify(layout));
          assert.equal(layout.count, mode === "weekly" ? 53 : 365);
        }
      }
      await surface.locator(".token-mode[data-mode=daily]").click();
      await surface
        .locator("#token-activity")
        .evaluate((el) => (el.closest("details").open = true));
      await surface.locator('.token-cell[data-tokens="20"]').focus();
      assert.equal(await surface.locator("#token-tooltip").isVisible(), true);
      await surface.keyboard.press("Enter");
      assert.match(
        await surface
          .locator("#token-activity .hint[role=status]")
          .textContent(),
        /20 Token/,
      );
      await surface
        .locator("#token-activity")
        .evaluate((el) => (el.closest("details").open = true));
      await surface.locator("#token-activity").scrollIntoViewIfNeeded();
      await surface.screenshot({
        path: path.join(root, "work/heatmap-" + inputType + ".png"),
      });
      await surface.evaluate(() => closeSettingsPage());
      return { inputType, themes: 2, modes: 3, cell: 12 };
    }
    evidence.heatmap = [await checkHeatmap(page, "mouse")];
    const touchContext = await browser.newContext({
      viewport: { width: 1024, height: 900 },
      hasTouch: true,
    });
    const touchPage = await touchContext.newPage();
    touchPage.on("pageerror", (error) => errors.push(error.message));
    await touchPage.goto(url + "/#access=" + token);
    await touchPage.waitForFunction(() => state.token && state.settings);
    assert.equal(
      await touchPage.evaluate(() => matchMedia("(pointer: coarse)").matches),
      true,
    );
    evidence.heatmap.push(await checkHeatmap(touchPage, "touch"));
    await touchContext.close();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => applyTheme(theme), theme);
      await page.waitForTimeout(300);
      const contrast = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        function lum(value) {
          const rgb = value
            .trim()
            .slice(1)
            .match(/../g)
            .map((x) => parseInt(x, 16) / 255)
            .map((x) =>
              x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
            );
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        }
        const bg = lum(style.getPropertyValue("--surface-reading"));
        return [
          "--text-primary",
          "--text-secondary",
          "--control-border",
          "--focus-color",
        ].map((key) => {
          const value = lum(style.getPropertyValue(key));
          return {
            key,
            ratio: (Math.max(bg, value) + 0.05) / (Math.min(bg, value) + 0.05),
          };
        });
      });
      for (const row of contrast)
        assert.ok(
          row.ratio >= (row.key.includes("text") ? 4.5 : 3),
          theme + JSON.stringify(row),
        );
      evidence.contrast.push({ theme, values: contrast });
      await page.screenshot({
        path: path.join(root, "work/design-task-" + theme + ".png"),
      });
      await page.evaluate(() => {
        showSettings();
        selectSettingsTab("connection");
      });
      await page.waitForTimeout(450);
      await page.screenshot({
        path: path.join(root, "work/design-settings-" + theme + ".png"),
      });
      await page.evaluate(() => closeSettingsPage());
    }
    for (const width of [1920, 1440, 1024, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
        composer: document
          .querySelector("#chat-form")
          .getBoundingClientRect()
          .toJSON(),
        strip: document
          .querySelector("#task-status-strip")
          .getBoundingClientRect()
          .toJSON(),
      }));
      assert.ok(layout.overflow <= 2, JSON.stringify(layout));
      assert.ok(layout.composer.right <= width + 2, JSON.stringify(layout));
      evidence.viewport.push(layout);
    }
    await page.emulateMedia({
      reducedMotion: "reduce",
      forcedColors: "active",
    });
    await page.keyboard.press("Control+k");
    assert.equal(
      await page
        .locator(".command-palette input")
        .evaluate((node) => getComputedStyle(node).outlineStyle),
      "solid",
    );
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(root, "work/design-evidence.json"),
      JSON.stringify({ ...evidence, page_errors: errors }, null, 2),
    );
    console.log(
      JSON.stringify({
        progressive_settings: true,
        modal_select: true,
        invalid_field: true,
        keyboard_palette: true,
        stop_confirmation: true,
        session_isolation: true,
        ...evidence,
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
