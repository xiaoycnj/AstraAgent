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
    await page
      .locator(".provider-card")
      .filter({ hasText: "新增服务商" })
      .first()
      .click();
    await page.locator("#provider-name").fill("Autofill fixture");
    await page.locator("#base-url").fill("http://127.0.0.1:9/v1");
    await page.locator("#model-api-id").fill("gpt-5.4");
    await page.waitForFunction(
      () =>
        document.querySelector("#model-detail-context_window").value ===
        "1050000",
    );
    assert.equal(
      await page.locator("#model-detail-multimodal").inputValue(),
      "true",
    );
    assert.equal(
      await page.locator("#model-detail-tool_calling").inputValue(),
      "true",
    );
    assert.equal(
      await page.locator("#model-detail-max_output").inputValue(),
      "128000",
    );
    assert.match(
      await page.locator("#model-detail-reasoning_levels").inputValue(),
      /high/,
    );
    assert.equal(
      await page.locator("#base-url").inputValue(),
      "http://127.0.0.1:9/v1",
    );
    assert.equal(await page.locator("#adapter-vendor").inputValue(), "auto");
    await page.locator("#model-detail-input_price").fill("77");
    await page.locator("#model-api-id").fill("gpt-5.4-nano");
    await page.waitForFunction(
      () =>
        document.querySelector("#model-detail-context_window").value ===
        "400000",
    );
    assert.equal(
      await page.locator("#model-detail-input_price").inputValue(),
      "77",
    );
    assert.equal(
      await page.locator("#model-alias").inputValue(),
      "GPT-5.4 nano",
    );
    // Saving the provider also confirms the pending model editor through its normal path.
    await page.locator("#provider-save").click();
    await page.waitForFunction(() => !providerDialog.open);
    const saved = await page.evaluate(() =>
      providerRows.find((row) => row.name === "Autofill fixture"),
    );
    assert.equal(saved.models.length, 1);
    assert.equal(saved.models[0].context_window, 400000);
    assert.equal(saved.models[0].input_price, 77);
    assert.equal(saved.models[0].max_output, 128000);
    await page
      .locator(".provider-card")
      .filter({ hasText: "Autofill fixture" })
      .click();
    await page
      .getByRole("button", { name: "编辑模型 gpt-5.4-nano", exact: true })
      .click();
    await page.locator("#model-detail-context_window").fill("65536");
    await page.locator("#add-provider-model").click();
    await page.waitForFunction(
      () => !document.querySelector("#model-api-id").value,
    );
    await page
      .getByRole("button", { name: "编辑模型 gpt-5.4-nano", exact: true })
      .click();
    await page.locator("#model-api-id").fill("gpt-5.4");
    await page.waitForFunction(
      () =>
        document.querySelector("#model-detail-context_window").value ===
        "1050000",
    );
    await page.locator("#model-api-id").fill("gpt-5.4-nano");
    await page.waitForFunction(
      () =>
        document.querySelector("#model-detail-context_window").value ===
        "65536",
    );
    await page.locator("#add-provider-model").click();
    await page.waitForFunction(
      () => !document.querySelector("#model-api-id").value,
    );
    await page.route("**/api/settings/models", (route) =>
      route.fulfill({
        json: { models: ["gpt-5.4-nano", "gpt-5.4", "unknown-fixture-id"] },
      }),
    );
    await page.locator("#fetch-provider-models").click();
    await page.waitForFunction(
      () =>
        providerModelDraft.length === 3 &&
        providerModelDraft.some(
          (row) => row.id === "gpt-5.4" && row.context_window === 1050000,
        ),
    );
    const fetched = await page.evaluate(() => providerModelDraft);
    assert.equal(
      fetched.find((row) => row.id === "gpt-5.4-nano").input_price,
      77,
    );
    assert.equal(
      fetched.find((row) => row.id === "gpt-5.4-nano").context_window,
      65536,
    );
    assert.equal(
      fetched.find((row) => row.id === "unknown-fixture-id").context_window,
      undefined,
    );
    await page.locator("#provider-save").click();
    await page.waitForFunction(() => !providerDialog.open);
    await page
      .locator(".provider-card")
      .filter({ hasText: "Autofill fixture" })
      .click();
    await page.getByRole("button", { name: "内置模型库", exact: true }).click();
    await page.locator(".registry-dialog input").fill("gpt-5.4-nano");
    await page
      .locator(".registry-model-row")
      .filter({ hasText: "gpt-5.4-nano" })
      .getByRole("button", { name: "补全规格", exact: true })
      .click();
    await page
      .locator(".registry-dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    const imported = await page.evaluate(() => ({
      vendor: registryVendor.value,
      model: providerModelDraft.find((item) => item.id === "gpt-5.4-nano"),
    }));
    assert.equal(imported.vendor, "auto");
    assert.equal(imported.model.input_price, 77);
    assert.equal(imported.model.context_window, 65536);
    const currency = await page.evaluate(() => {
      const reference = { currency: "CNY", input_price: 1, output_price: 2 };
      return {
        manual: mergeModelReference(
          { id: "fx", currency: "USD", input_price: 77 },
          reference,
        ),
        empty: mergeModelReference(
          { id: "fx", currency: "USD", input_price: null },
          reference,
        ),
      };
    });
    assert.equal(currency.manual.currency, "USD");
    assert.equal(currency.manual.output_price, undefined);
    assert.equal(currency.empty.currency, "CNY");
    let releaseSlow;
    const gate = new Promise((resolve) => (releaseSlow = resolve));
    await page.route("**/api/model-registry/match", async (route) => {
      const body = route.request().postDataJSON();
      if (body.models.length !== 1 || body.models[0] !== "slow-reference")
        return route.continue();
      await gate;
      await route.fulfill({
        json: {
          results: [
            {
              id: "slow-reference",
              status: "matched",
              model: { context_window: 999999, name: "Stale" },
              matches: [{ provider_name: "Fixture" }],
            },
          ],
        },
      });
    });
    await page.locator("#model-api-id").fill("slow-reference");
    await page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/model-registry/match") &&
        request.postDataJSON().models[0] === "slow-reference",
    );
    await page.locator("#model-api-id").fill("unknown-fixture-id");
    await page.waitForFunction(() =>
      document
        .querySelector(".model-autofill-status")
        .textContent.includes("未找到"),
    );
    releaseSlow();
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator("#model-detail-context_window").inputValue(),
      "",
    );
    assert.equal(
      await page.locator("#model-api-id").inputValue(),
      "unknown-fixture-id",
    );
    await page.evaluate(() => {
      settingsDirty = false;
      providerDialog.close();
    });
    await page.locator(".routing-disclosure>summary").click();
    await page.locator(".routing-preview textarea").fill("全面审查代码");
    await page
      .getByRole("button", { name: "检查候选与规则路由", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".routing-preview-result")
        .textContent.includes("gpt-5.4"),
    );
    assert.match(
      await page.locator(".routing-preview-result").textContent(),
      /建议等级/,
    );
    assert.match(
      await page.locator(".routing-preview-result").textContent(),
      /缺少上下文规格/,
    );
    const scopes = await page.evaluate((id) => {
      $("#provider-select").value = id;
      useModel(AUTO_MODEL);
      autoScope.value = "all";
      autoScope.dispatchEvent(new Event("change"));
      const all = runtimeOptions();
      autoScope.value = "current";
      autoScope.dispatchEvent(new Event("change"));
      const current = runtimeOptions();
      useModel("fixture-manual");
      const manual = runtimeOptions();
      return {
        all: all.provider,
        model: all.model,
        current: current.provider,
        manual: manual.provider,
      };
    }, saved.id);
    assert.deepEqual(scopes, {
      all: "",
      model: "AutoModelReview",
      current: saved.id,
      manual: saved.id,
    });
    assert.equal(
      await page.locator(".routing-preview-result").textContent(),
      "",
    );
    await page
      .getByRole("button", { name: "检查候选与规则路由", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".routing-preview-result")
        .textContent.includes("gpt-5.4"),
    );
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.screenshot({
      path: path.join(root, "work/model-routing-preview.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        autofill: true,
        manual_overrides: true,
        save_pending_model: true,
        restore_edited_id: true,
        fetch_hydration: true,
        stale_response: true,
        routing_preview: true,
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
