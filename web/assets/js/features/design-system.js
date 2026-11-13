// Shared desktop interaction rules. Existing controls retain their data and handlers.
(() => {
  function disclosure(title, description, className = "") {
    const details = elem("details", "settings-disclosure " + className);
    const summary = elem("summary");
    summary.append(
      elem("strong", "", title),
      elem("span", "hint", description),
      chevron(),
    );
    details.append(summary);
    return details;
  }

  const advanced = disclosure("高级设置", "协议、缓存与系统提示词");
  const developer = disclosure("开发者设置", "网络信任、用量与超时");
  const footer = configFormElement.querySelector(".dialog-footer");
  footer.before(advanced, developer);
  advanced.append(
    registryField,
    adapterPanel,
    $("#system-prompt").closest("label"),
  );
  developer.append($("#timeout").closest(".form-columns"));
  const usageHint = usageRequestLabel.nextElementSibling;
  developer.append(
    usageRequestLabel,
    privateNetworkLabel,
    $("#clear-key").closest("label"),
  );
  if (usageHint?.tagName === "P") developer.append(usageHint);
  const metadata = disclosure("模型规格与价格", "上下文、输入能力与路由等级");
  modelDetails.before(metadata);
  metadata.append(modelDetails);
  const beforeEditDetails = editModelDetails;
  editModelDetails = function (item = {}) {
    beforeEditDetails(item);
    metadata.open = !!item.id;
  };

  const routingDisclosure = disclosure(
    "自动模型路由",
    "选择 AutoModelReview 时生效",
    "routing-disclosure",
  );
  routingSettings.before(routingDisclosure);
  routingDisclosure.append(routingSettings);
  function syncRoutingFields() {
    for (const field of [judgeProvider, judgeModel])
      field.closest("label").hidden = routingMode.value !== "ai";
    routingCurrency.closest("label").hidden = routingStrategy.value !== "price";
  }
  routingMode.addEventListener("change", syncRoutingFields);
  routingStrategy.addEventListener("change", syncRoutingFields);
  const beforeRoutingLoad = loadRoutingSettings;
  loadRoutingSettings = async function () {
    await beforeRoutingLoad();
    syncRoutingFields();
  };
  studioReady.then(syncRoutingFields);

  let providerReturnFocus;
  const beforeProviderOpen = expandProvider;
  expandProvider = function (id, source, mode) {
    providerReturnFocus = source || document.activeElement;
    advanced.open = false;
    developer.open = false;
    metadata.open = false;
    beforeProviderOpen(id, source, mode);
  };
  providerDialog.addEventListener("close", () => {
    closeSelect();
    if (providerReturnFocus?.isConnected)
      providerReturnFocus.focus({ preventScroll: true });
  });
  configFormElement.addEventListener(
    "invalid",
    (event) => {
      for (
        let node = event.target.parentElement;
        node && node !== configFormElement;
        node = node.parentElement
      )
        if (node.tagName === "DETAILS") node.open = true;
    },
    true,
  );
  $("#settings-feedback").setAttribute("role", "status");
  routingFeedback.setAttribute("role", "status");

  // Readability is adjustable independently from the selected skin/material.
  let solidReading = true;
  try {
    solidReading = localStorage.getItem("astra-solid-reading") !== "false";
  } catch {}
  const readingRow = elem("div", "preference-row");
  const readingText = elem("div");
  readingText.append(
    elem("h3", "", "增强阅读对比度"),
    elem("p", "hint", "提高正文和表单表面的不透明度，保留导航玻璃材质。"),
  );
  const readingSwitch = elem("input");
  readingSwitch.type = "checkbox";
  readingSwitch.setAttribute("role", "switch");
  readingSwitch.setAttribute("aria-label", "增强阅读对比度");
  readingSwitch.checked = solidReading;
  function applyReading() {
    document.documentElement.dataset.readability = readingSwitch.checked
      ? "enhanced"
      : "custom";
  }
  readingSwitch.onchange = () => {
    applyReading();
    try {
      localStorage.setItem(
        "astra-solid-reading",
        String(readingSwitch.checked),
      );
    } catch {}
  };
  readingRow.append(readingText, readingSwitch);
  $("[data-panel=appearance]").append(readingRow);
  applyReading();
  // User accent colors choose their own legible button foreground.
  const accentProbe = elem("span");
  accentProbe.hidden = true;
  accentProbe.style.color = "var(--blue)";
  document.body.append(accentProbe);
  function syncAccentForeground() {
    const channels = getComputedStyle(accentProbe)
      .color.match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) return;
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
      linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    const foreground = luminance > 0.179 ? "#000000" : "#ffffff";
    const root = document.documentElement;
    if (root.style.getPropertyValue("--action-ink") !== foreground)
      root.style.setProperty("--action-ink", foreground);
  }
  new MutationObserver(syncAccentForeground).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style"],
  });
  syncAccentForeground();
  window.addEventListener(
    "blur",
    () => (document.documentElement.dataset.windowActive = "false"),
  );
  window.addEventListener(
    "focus",
    () => (document.documentElement.dataset.windowActive = "true"),
  );

  // Compact, per-session task status. Deltas do not rebuild the message list.
  const taskStrip = elem("details", "task-status-strip");
  taskStrip.id = "task-status-strip";
  taskStrip.hidden = true;
  const taskLine = elem("summary");
  const phase = elem("strong", "task-phase");
  phase.setAttribute("role", "status");
  const model = elem("span", "task-model");
  model.dataset.i18nIgnore = "true";
  const metrics = elem("span", "task-metrics");
  taskLine.append(phase, model, metrics, chevron());
  const detail = elem("div", "task-status-detail");
  const route = elem("p");
  route.dataset.i18nIgnore = "true";
  const usage = elem("p");
  const feedback = elem("p");
  feedback.dataset.i18nIgnore = "true";
  const actions = elem("div", "task-status-actions");
  const records = actionButton(
    "执行记录",
    () => {
      taskPanel.hidden = false;
      taskPanel.open = true;
      taskPanel.scrollIntoView({ block: "nearest" });
    },
    "secondary",
  );
  const outputs = actionButton(
    "查看交付",
    () => {
      if (resourcePanel.hidden) resourceButton.click();
    },
    "secondary",
  );
  const recovery = actionButton(
    "检查与继续",
    async () => {
      await refreshExecutionRecovery();
      recoveryPanel.scrollIntoView({ block: "nearest" });
    },
    "secondary",
  );
  actions.append(records, outputs, recovery);
  detail.append(route, usage, feedback, actions);
  taskStrip.append(taskLine, detail);
  $("#chat-view").prepend(taskStrip);
  const sessions = new Map();
  const phases = {
    start: "正在准备",
    routing_start: "正在选择模型",
    routing: "正在执行",
    tool_start: "正在调用工具",
    tool: "正在执行",
    approval: "等待授权",
    delta: "正在生成",
    reasoning_summary: "正在推理",
    context_compacted: "正在压缩上下文",
    done: "任务已完成",
    cancelled: "任务已停止",
    error: "任务失败",
  };
  let frame = 0;
  function queueStatus() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        drawStatus();
      });
  }
  function remember(sid, event) {
    const previous = sessions.get(sid);
    const resumed =
      event.type === "start" &&
      event.run_id &&
      event.run_id === previous?.runId;
    if (event.type === "start" || !sessions.has(sid))
      sessions.set(sid, {
        start: resumed ? previous.start : event.time || Date.now() / 1000,
        tools: resumed ? previous.tools : 0,
        route: resumed ? previous.route : undefined,
        runId: event.run_id,
      });
    const row = sessions.get(sid);
    if (event.type === "start")
      Object.assign(row, {
        model: event.model,
        provider: event.provider_id,
        reasoning: event.requested_reasoning || event.reasoning,
      });
    if (event.type === "routing")
      Object.assign(row, {
        model: event.resolved_model,
        provider: event.provider_id,
        reasoning: event.requested_reasoning || event.reasoning,
        route: event.reason,
      });
    if (event.type === "tool_start") row.tools++;
    if (phases[event.type] && !row.end && !row.stopping) row.phase = event.type;
    if (["done", "cancelled", "error"].includes(event.type))
      Object.assign(row, {
        end: event.time || Date.now() / 1000,
        phase: event.type,
        stopping: false,
        usage: event.usage,
        message: event.message,
      });
    while (sessions.size > 32) sessions.delete(sessions.keys().next().value);
  }
  function drawStatus() {
    const row = sessions.get(state.session?.id);
    taskStrip.hidden = !row;
    if (!row) return;
    const label = uiText(
      row.stopping
        ? "正在停止，等待执行器确认"
        : phases[row.phase] || "正在执行",
    );
    if (phase.textContent !== label) phase.textContent = label;
    taskStrip.dataset.phase = row.stopping ? "stopping" : row.phase || "start";
    const provider = providerRows.find(
      (item) => item.id === row.provider,
    )?.name;
    const name = [
      row.model,
      provider,
      row.reasoning && uiText("请求推理档位") + " " + row.reasoning,
    ]
      .filter(Boolean)
      .join(" · ");
    if (model.textContent !== name) model.textContent = name;
    const seconds = Math.max(
      0,
      Math.floor((row.end || Date.now() / 1000) - row.start),
    );
    metrics.textContent =
      seconds + "s · " + row.tools + " " + uiText("次工具调用");
    route.hidden = !row.route;
    route.textContent = uiText("路由原因") + " · " + (row.route || "");
    const meter = row.usage;
    usage.textContent =
      meter?.available && meter.reported > 0
        ? uiText("已上报 Token") +
          " " +
          meter.total.toLocaleString() +
          " · " +
          meter.reported +
          "/" +
          meter.calls +
          " " +
          uiText("次调用已上报")
        : uiText("Token 用量未上报");
    feedback.hidden = !row.message && !row.stopping;
    feedback.textContent = row.stopping
      ? uiText("正在取消模型请求与工具调用，保留已有输出。")
      : row.message || "";
    outputs.hidden = !row.end;
    recovery.hidden = !["error", "cancelled"].includes(row.phase);
  }
  const beforeEvent = handleAgentEvent;
  handleAgentEvent = function (sid, event) {
    beforeEvent(sid, event);
    remember(sid, event);
    if (sid === state.session?.id && event.type !== "delta") queueStatus();
    if (
      sid === state.session?.id &&
      event.type === "delta" &&
      !sessions.get(sid)?.stopping &&
      !sessions.get(sid)?.end &&
      phase.textContent !== uiText(phases.delta)
    )
      queueStatus();
  };
  const beforeRecords = refreshTaskRecords;
  refreshTaskRecords = async function () {
    const sid = state.session?.id;
    await beforeRecords();
    if (sid !== state.session?.id) return;
    // A running stream owns its live status. Completed journals reconstruct older runs.
    if (!state.pending.has(sid)) {
      sessions.delete(sid);
      const run = state.sessionRuns?.[0];
      for (const event of run?.events || []) remember(sid, event);
    }
    queueStatus();
  };
  const beforeHeader = updateHeader;
  updateHeader = function () {
    beforeHeader();
    queueStatus();
  };
  document.addEventListener("astra:task-cancel-request", (event) => {
    const row = sessions.get(event.detail.sid);
    if (row && event.detail.accepted && !row.end) row.stopping = true;
    queueStatus();
  });
  setInterval(() => {
    if (
      !document.hidden &&
      !taskStrip.hidden &&
      !sessions.get(state.session?.id)?.end
    )
      queueStatus();
  }, 1000);
  for (const [key, value] of Object.entries({
    routing: "自动模型路由",
    routing_start: "选择模型",
    cancelled: "任务已停止",
  }))
    eventNames[key] = value;

  // Keyboard-first commands reuse the normal entry points and confirmation flows.
  const palette = elem("dialog", "command-palette");
  palette.setAttribute("aria-labelledby", "command-palette-title");
  const heading = elem("h2", "", "命令面板");
  heading.id = "command-palette-title";
  const search = elem("input");
  search.type = "search";
  search.placeholder = "搜索操作…";
  search.setAttribute("aria-label", "搜索操作");
  search.setAttribute("aria-controls", "command-results");
  const results = elem("div", "command-results");
  results.id = "command-results";
  const hint = elem("p", "hint", "↑ ↓ 选择 · Enter 执行 · Esc 关闭");
  const dismiss = actionButton("关闭", () => palette.close(), "secondary");
  const paletteHead = elem("header");
  paletteHead.append(heading, dismiss);
  palette.append(paletteHead, search, results, hint);
  document.body.append(palette);
  const settings = (tab) => {
    showSettings();
    selectSettingsTab(tab);
  };
  const commands = [
    ["新建会话", "", () => $("#new-item").click()],
    [
      "聚焦输入框",
      "",
      async () => {
        if (await navigatePage("home")) $("#chat-input").focus();
      },
    ],
    [
      "模型选择",
      "",
      async () => {
        if (await navigatePage("home")) openReasoning();
      },
    ],
    ["模型服务商", "", () => settings("connection")],
    ["外观与交互", "", () => settings("appearance")],
    ["插件与技能", "", () => settings("capabilities")],
    ["设置", "Ctrl+,", () => settings("general")],
    ["资料库", "", () => navigatePage("library")],
    ["定时任务", "", () => navigatePage("schedule")],
    ["生图", "", () => navigatePage("images")],
    ["项目工作区", "", showProjectManager],
    ["文件工作台", "", () => openWorkbench("files")],
    ["终端", "", () => openWorkbench("terminal")],
    [
      "显示或隐藏侧栏",
      "Ctrl+Shift+S",
      () =>
        setConversationPane(
          document.body.classList.contains("conversation-collapsed"),
        ),
    ],
    [
      "停止当前任务",
      "",
      cancelProjectTask,
      () => state.pending.has(state.session?.id),
    ],
    ["切换暗色模式", "", () => $("#theme-toggle").click()],
  ];
  let selected = 0,
    visibleCommands = [],
    returnFocus;
  function drawCommands() {
    const query = search.value.trim().toLocaleLowerCase();
    visibleCommands = commands.filter(
      ([name, key, , available]) =>
        (!available || available()) &&
        (uiText(name) + " " + name + " " + key)
          .toLocaleLowerCase()
          .includes(query),
    );
    selected = Math.min(selected, Math.max(0, visibleCommands.length - 1));
    results.replaceChildren();
    visibleCommands.forEach(([name, key], index) => {
      const button = actionButton(
        "",
        () => runCommand(index),
        "command-result",
      );
      button.append(elem("span", "", uiText(name)), elem("kbd", "", key));
      button.classList.toggle("selected", index === selected);
      button.onfocus = () => {
        selected = index;
      };
      results.append(button);
    });
    if (!visibleCommands.length)
      results.append(elem("p", "hint", uiText("没有匹配的操作")));
  }
  async function runCommand(index) {
    const command = visibleCommands[index];
    if (!command) return;
    palette.close();
    try {
      await command[2]();
    } catch (error) {
      toast(error.message);
    }
  }
  function openCommands() {
    if (document.querySelector("dialog[open]")) return;
    returnFocus = document.activeElement;
    search.value = "";
    selected = 0;
    drawCommands();
    palette.showModal();
    search.focus();
  }
  palette.addEventListener(
    "close",
    () =>
      returnFocus?.isConnected && returnFocus.focus({ preventScroll: true }),
  );
  search.oninput = () => {
    selected = 0;
    drawCommands();
  };
  palette.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      palette.close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if (["Home", "End"].includes(event.key) && event.target === search)
        return;
      event.preventDefault();
      const count = visibleCommands.length;
      selected =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? count - 1
            : (selected + (event.key === "ArrowDown" ? 1 : -1) + count) %
              Math.max(1, count);
      drawCommands();
      results.children[selected]?.focus({ preventScroll: true });
      results.children[selected]?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter" && event.target === search) {
      event.preventDefault();
      runCommand(selected);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (
      event.key.toLowerCase() === "k" ||
      (event.shiftKey && event.key.toLowerCase() === "p")
    ) {
      event.preventDefault();
      openCommands();
    }
    if (event.key === "," && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      settings("general");
    }
  });
  const commandButton = actionButton(
    "",
    openCommands,
    "chrome-button command-launcher",
  );
  commandButton.setAttribute("aria-label", "命令面板");
  commandButton.title = "命令面板 · Ctrl+K";
  commandButton.append(railIcon("search"));
  titlebarDrag.before(commandButton);
})();
