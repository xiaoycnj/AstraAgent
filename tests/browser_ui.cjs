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

    await page.emulateMedia({ reducedMotion: "reduce" });
    const evidence = { screens: [], responsive: [], languages: [] };
    async function noOverflow(selector) {
      const overflow = await page
        .locator(selector)
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, selector + " overflows by " + overflow);
    }
    async function screenshot(name) {
      await page.screenshot({
        path: path.join(root, "work/ui-" + name + ".png"),
      });
    }
    assert.equal(await page.locator("link[rel=stylesheet]").count(), 1);
    assert.equal(await page.locator("#activity-rail").isVisible(), false);
    assert.equal(await page.locator(".pane-backdrop").isVisible(), false);
    assert.equal(await page.locator("#open-side").isVisible(), false);
    assert.ok((await page.locator("#chat-form").boundingBox()).height < 125);
    assert.ok((await page.locator("#messages").boundingBox()).height > 700);
    assert.equal(
      await page
        .locator("#chat-input")
        .evaluate((el) => el.classList.contains("ui-field")),
      false,
    );
    await page.evaluate(() => {
      state.messages = [
        {
          id: 901,
          role: "user",
          content: "帮我梳理当前项目的界面，保留玻璃材质。",
        },
        {
          id: 902,
          role: "assistant",
          content:
            '## 界面调整\n\n共享导航、表单和弹窗组件已经统一。\n\n- 对话保留更多阅读空间\n- 设置采用分类导航\n- 任务执行状态可以展开查看\n\n```js\nconst workspace = "AstraAgent";\n```\n\n公式示例 $E=mc^2$。'.replaceAll(
              "\\n",
              "\n",
            ),
        },
      ];
      renderMessages();
    });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => applyTheme(theme), theme);
      await screenshot("chat-" + theme);
      for (const destination of ["library", "images", "schedule"]) {
        await page.evaluate(
          (destination) => navigatePage(destination),
          destination,
        );
        await noOverflow(".destination-page");
        assert.equal(await page.locator("#chat-view").isVisible(), false);
        await screenshot(destination + "-" + theme);
        evidence.screens.push(destination + "-" + theme);
      }
      await page.evaluate(() => {
        showSettings();
        selectSettingsTab("general");
      });
      assert.equal(
        await page.locator(".settings-page-header h1").textContent(),
        "常规",
      );
      const before = await page.locator(".settings-page-header").boundingBox();
      await page
        .locator(".settings-content")
        .evaluate((el) => (el.scrollTop = el.scrollHeight));
      const after = await page.locator(".settings-page-header").boundingBox();
      assert.equal(before.y, after.y);
      await page
        .locator(".settings-content")
        .evaluate((el) => (el.scrollTop = 0));
      await screenshot("general-" + theme);
      for (const category of [
        "profile",
        "appearance",
        "capabilities",
        "connection",
        "storage",
        "about",
      ]) {
        await page.evaluate(
          (category) => selectSettingsTab(category),
          category,
        );
        await noOverflow(".settings-content");
        if (["profile", "capabilities", "connection"].includes(category))
          await screenshot(category + "-" + theme);
        evidence.screens.push(category + "-" + theme);
      }
      await page.evaluate(() => selectSettingsTab("connection"));
      const card = page
        .locator(".provider-card")
        .filter({ hasText: "新增服务商" })
        .first();
      await card.click();
      await page.locator(".provider-dialog[open]").waitFor();
      assert.equal(
        await page.locator("#provider-name").evaluate((el) => el.labels.length),
        1,
      );
      assert.equal(
        await page.locator(".provider-dialog .primary:visible").count(),
        1,
      );
      const save = await page.locator("#provider-save").boundingBox();
      assert.ok(save.y + save.height < 1000);
      await screenshot("provider-" + theme);
      await page.evaluate(() => renderProviderCards());
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          !providerDialog.open && providerGrid.contains(document.activeElement),
      );
      assert.equal(
        await card.evaluate((el) => el === document.activeElement),
        true,
      );
      await page.evaluate(() => closeSettingsPage());
      assert.equal(await page.evaluate(() => appPage), "schedule");
      await page.evaluate(() => navigatePage("home"));
    }
    await page.evaluate(() => {
      showSettings();
      selectSettingsTab("general");
    });
    await page.locator("[data-settings-tab=general]").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.settingsTab),
      "profile",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator(".settings-page-header h1").textContent(),
      "个人资料",
    );
    await page.locator('input[placeholder="搜索设置"]').fill("模型");
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.settingsTab),
      "connection",
    );
    await page.locator('input[placeholder="搜索设置"]').fill("");
    await page.evaluate(() => {
      selectSettingsTab("capabilities");
      selectIntegration("plugins");
    });
    await page.locator("#integration-tab-plugins").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page
        .locator("#integration-tab-skills")
        .getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await page
        .locator("#integration-tab-skills")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    for (const width of [1920, 1024, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => selectSettingsTab("connection"));
      await noOverflow(".settings-content");
      if (width <= 680) {
        assert.equal(await page.locator(".settings-nav").isVisible(), false);
        assert.equal(
          await page.locator(".settings-nav").evaluate((el) => el.inert),
          true,
        );
        await page.locator(".settings-categories").click();
        assert.equal(await page.locator(".settings-nav").isVisible(), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#settings").isVisible(), true);
        assert.equal(
          await page
            .locator(".settings-categories")
            .evaluate((el) => el === document.activeElement),
          true,
        );
        await page.locator(".settings-categories").click();
        await page.locator("[data-settings-tab=appearance]").click();
        assert.equal(await page.locator(".settings-nav").isVisible(), false);
        await noOverflow(".settings-content");
      }
      if (width <= 600) {
        assert.equal(
          await page.locator(".compact-app-menu .app-menu").count(),
          4,
        );
        await noOverflow(".custom-titlebar");
      }
      await screenshot("settings-" + width);
      await page.evaluate(() => {
        selectSettingsTab("connection");
        expandProvider("", document.activeElement, "new");
      });
      await noOverflow(".provider-dialog-body");
      const save = await page.locator("#provider-save").boundingBox();
      assert.ok(
        save.y >= 0 && save.y + save.height <= 800,
        "Visible save at " + width,
      );
      assert.ok(save.x >= 0 && save.x + save.width <= width);
      await page.keyboard.press("Escape");
      evidence.responsive.push(width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const language of ["en", "ja", "zh-CN"]) {
      await page.evaluate((language) => {
        selectedLanguage = language;
        applyUiLanguage();
        selectSettingsTab("general");
      }, language);
      await noOverflow(".settings-content");
      assert.equal(
        await page.locator(".settings-page-header h1").textContent(),
        { en: "General", ja: "一般", "zh-CN": "常规" }[language],
      );
      evidence.languages.push(language);
    }
    // Exercise the actual declarative skin entry point and its cascade layer.
    assert.deepEqual(
      await page.evaluate(() => {
        const original = captureSkinAppearance();
        paintMarketSkin({
          theme: "dark",
          colors: { "--blue": "#8a9fff", "--glass-reading": "#1f2233" },
          blur: 18,
          radius: 17,
        });
        const radius = getComputedStyle(
          document.querySelector("#chat-form"),
        ).borderRadius;
        const surface = getComputedStyle(
          document.querySelector(".settings-main"),
        ).backgroundColor;
        restoreSkinAppearance(original);
        return { radius, surface };
      }),
      { radius: "17px", surface: "rgb(31, 34, 51)" },
    );
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    assert.equal(
      await page
        .locator(".settings-view")
        .evaluate((el) => getComputedStyle(el, "::before").display),
      "none",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(root, "work/ui-system-evidence.json"),
      JSON.stringify({ ...evidence, page_errors: errors }, null, 2),
    );
    console.log(
      JSON.stringify({
        ...evidence,
        shared_components: true,
        sticky_settings_header: true,
        mobile_navigation: true,
        pinned_dialog_actions: true,
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
