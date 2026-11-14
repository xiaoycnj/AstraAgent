/* Static rendering in a fresh browser profile. No generated JavaScript executes. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function main() {
  const [browserPath, folder] = process.argv.slice(2);
  const input = JSON.parse(
    fs.readFileSync(path.join(folder, "request.json"), "utf8"),
  );
  if (typeof WebSocket !== "function")
    throw new Error("Node.js 22 or later is required");
  const child = spawn(
    browserPath,
    [
      "--headless",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--user-data-dir=" + path.join(folder, "profile"),
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "",
    socket,
    nextId = 0;
  const pending = new Map();
  const deadline = setTimeout(() => {
    child.kill();
    process.exitCode = 1;
  }, 30000);
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-16000);
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    let address;
    for (let index = 0; index < 100; index++) {
      address = stderr.match(
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/,
      )?.[1];
      if (address) break;
      if (child.exitCode !== null)
        throw new Error("Browser exited before DevTools was ready");
      await sleep(100);
    }
    if (!address) throw new Error("Browser DevTools did not start");
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    function call(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Browser protocol timeout"));
        }, 8000);
        pending.set(id, { resolve, reject, timer });
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    }
    socket.addEventListener("message", async (event) => {
      const packet = JSON.parse(String(event.data));
      if (packet.id && pending.has(packet.id)) {
        const request = pending.get(packet.id);
        pending.delete(packet.id);
        clearTimeout(request.timer);
        if (packet.error) request.reject(new Error(packet.error.message));
        else request.resolve(packet.result || {});
      }
      if (packet.method === "Fetch.requestPaused") {
        try {
          await call(
            "Fetch.failRequest",
            {
              requestId: packet.params.requestId,
              errorReason: "BlockedByClient",
            },
            packet.sessionId,
          );
        } catch {}
      }
    });
    const context = await call("Target.createBrowserContext");
    const target = await call("Target.createTarget", {
      url: "about:blank",
      browserContextId: context.browserContextId,
    });
    const { sessionId } = await call("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    await call("Page.enable", {}, sessionId);
    await call("Runtime.enable", {}, sessionId);
    await call(
      "Emulation.setScriptExecutionDisabled",
      { value: true },
      sessionId,
    );
    await call("Browser.setDownloadBehavior", {
      behavior: "deny",
      browserContextId: context.browserContextId,
    });
    await call(
      "Fetch.enable",
      {
        patterns: [
          { urlPattern: "http://*" },
          { urlPattern: "https://*" },
          { urlPattern: "file://*" },
          { urlPattern: "ftp://*" },
        ],
      },
      sessionId,
    );
    await call(
      "Emulation.setDeviceMetricsOverride",
      { width: input.width, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await call(
      "Page.navigate",
      {
        url:
          "data:text/html;base64," + Buffer.from(input.html).toString("base64"),
      },
      sessionId,
    );
    await sleep(600);
    const metrics = await call(
      "Runtime.evaluate",
      {
        expression: `JSON.stringify({title:document.title,width:document.documentElement.clientWidth,contentWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,images:[...document.images].map(image=>({loaded:image.complete&&image.naturalWidth>0,alt:image.alt})),headings:document.querySelectorAll('h1').length})`,
        returnByValue: true,
      },
      sessionId,
    );
    if (metrics.exceptionDetails)
      throw new Error("Could not inspect rendered document");
    const report = JSON.parse(metrics.result.value);
    report.horizontal_overflow = report.contentWidth > report.width + 1;
    report.scope = "static-layout-only";
    report.scripts_executed = false;
    const screenshot = await call(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      sessionId,
    );
    fs.writeFileSync(
      path.join(folder, "screenshot.png"),
      Buffer.from(screenshot.data, "base64"),
    );
    if (input.pdf) {
      if (report.height > 18000)
        throw new Error("Document exceeds the bounded PDF page budget");
      const pdf = await call(
        "Page.printToPDF",
        { printBackground: true, preferCSSPageSize: true, pageRanges: "1-20" },
        sessionId,
      );
      fs.writeFileSync(
        path.join(folder, "document.pdf"),
        Buffer.from(pdf.data, "base64"),
      );
      report.pdf_page_limit = 20;
    }
    fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify(report));
    await call("Target.disposeBrowserContext", {
      browserContextId: context.browserContextId,
    });
    await call("Browser.close");
  } finally {
    clearTimeout(deadline);
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    child.kill();
  }
}
main().catch((error) => {
  process.stderr.write(String(error.message).slice(0, 500));
  process.exitCode = 1;
});
