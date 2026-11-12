// Curated, declarative extensions and temporary appearance previews.
let marketData = null,
  marketTab = "plugin",
  marketQuery = "",
  skinPreview = null;
const skinTokens = [
  "--theme-color",
  "--blue",
  "--accent-color",
  "--ink",
  "--muted",
  "--line",
  "--soft",
  "--glass-reading",
  "--surface",
  "--glass-blur",
  "--market-radius",
];
function captureSkinAppearance() {
  return {
    theme: document.documentElement.dataset.theme,
    colors: Object.fromEntries(
      skinTokens.map((token) => [
        token,
        document.documentElement.style.getPropertyValue(token),
      ]),
    ),
    custom: document.body.classList.contains("market-skin"),
  };
}
function restoreSkinAppearance(snapshot) {
  document.documentElement.dataset.theme = snapshot.theme;
  for (const [token, value] of Object.entries(snapshot.colors))
    document.documentElement.style.setProperty(token, value);
  document.body.classList.toggle("market-skin", snapshot.custom);
}
function paintMarketSkin(payload) {
  document.documentElement.dataset.theme = payload.theme;
  for (const token of skinTokens)
    if (!["--glass-blur", "--market-radius"].includes(token))
      document.documentElement.style.removeProperty(token);
  for (const [token, value] of Object.entries(payload.colors))
    document.documentElement.style.setProperty(token, value);
  document.documentElement.style.setProperty(
    "--glass-blur",
    payload.blur + "px",
  );
  document.documentElement.style.setProperty(
    "--market-radius",
    payload.radius + "px",
  );
  document.body.classList.add("market-skin");
}
function cancelSkinPreview() {
  if (!skinPreview) return;
  restoreSkinAppearance(skinPreview.before);
  skinPreview = null;
  $("#skin-preview-bar")?.remove();
}
function previewMarketSkin(entry) {
  cancelSkinPreview();
  skinPreview = { entry, before: captureSkinAppearance() };
  paintMarketSkin(entry.payload);
  const bar = elem("aside", "skin-preview-bar");
  bar.id = "skin-preview-bar";
  bar.setAttribute("aria-label", "皮肤预览");
  bar.append(
    elem("strong", "", "正在预览 · " + entry.name),
    actionButton("应用皮肤", () => applyMarketSkin(entry), "primary"),
    actionButton("取消预览", cancelSkinPreview, "secondary"),
  );
  document.body.append(bar);
}
async function applyMarketSkin(entry) {
  const original = skinPreview?.before || captureSkinAppearance();
  marketData.state = await api("/api/marketplace/import", "POST", entry);
  marketData.state = await api("/api/marketplace/skin", "PUT", {
    id: entry.id,
  });
  if (!localStorage.getItem("astra-market-baseline"))
    localStorage.setItem("astra-market-baseline", JSON.stringify(original));
  cancelSkinPreview();
  paintMarketSkin(entry.payload);
  renderMarketCards();
  toast("皮肤已应用");
}
async function resetMarketSkin() {
  const baseline = localStorage.getItem("astra-market-baseline");
  marketData.state = await api("/api/marketplace/skin", "PUT", { id: null });
  cancelSkinPreview();
  if (baseline) restoreSkinAppearance(JSON.parse(baseline));
  localStorage.removeItem("astra-market-baseline");
  renderMarketCards();
  toast("已恢复原外观");
}
function marketGlyph(kind) {
  const wrapper = elem("span", "market-glyph");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute(
    "d",
    kind === "skin"
      ? "M16 4C9 4 4 9 4 16s5 12 12 12h2a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h5c8 0 6-14-6-14Z"
      : "M10 5h5v3a3 3 0 1 0 6 0V5h6v9h-3a3 3 0 1 0 0 6h3v7H5v-7h3a3 3 0 1 0 0-6H5V5Z",
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  wrapper.append(svg);
  return wrapper;
}
function skinThumbnail(entry) {
  const preview = elem("div", "skin-thumbnail");
  preview.style.background = entry.payload.colors["--theme-color"];
  preview.style.color = entry.payload.colors["--blue"];
  const rail = elem("div", "skin-mini-rail");
  for (let i = 0; i < 4; i++) rail.append(elem("i"));
  const content = elem("div", "skin-mini-content");
  content.append(
    elem("b", "", "AstraAgent"),
    elem("i"),
    elem("i"),
    elem("i"),
    elem("div", "skin-mini-composer"),
  );
  preview.append(rail, content);
  return preview;
}
function downloadMarketPackage(entry) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" }),
  );
  const link = elem("a");
  link.href = url;
  link.download = entry.id + ".astra-" + entry.kind + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function installMarketPlugin(entry) {
  const actions = entry.payload.hooks.map(
    (hook) =>
      ({
        limit_length: "限制输入长度",
        prefix: "发送前添加提示",
        save_output: "将回复保存到资料库",
        notify: "显示完成提醒",
        reading_layout: "调整阅读布局",
      })[hook.action] || hook.action,
  );
  if (
    !(await appConfirm(
      entry.name +
        "\n" +
        entry.author +
        " · " +
        entry.license +
        "\n" +
        actions.join("、") +
        "\n安装后将启用此插件。",
    ))
  )
    return;
  marketData.state = await api("/api/marketplace/install", "POST", {
    kind: entry.kind,
    id: entry.id,
    sha256: entry.sha256,
  });
  await reloadCapabilities();
  renderMarketCards();
  toast("插件已安装并启用");
}
function marketDetails(entry) {
  const dialog = elem("dialog", "app-dialog market-details");
  dialog.append(
    marketGlyph(entry.kind),
    elem("h2", "", entry.name),
    elem("p", "", entry.description),
    elem(
      "p",
      "hint",
      entry.author + " · " + entry.version + " · " + entry.license,
    ),
    elem("p", "hint", "SHA-256 · " + entry.sha256),
  );
  if (entry.kind === "plugin")
    for (const hook of entry.payload.hooks)
      dialog.append(elem("p", "market-hook", hook.event + " → " + hook.action));
  dialog.append(
    actionButton("导出作品包", () => downloadMarketPackage(entry), "secondary"),
    actionButton("关闭", () => dialog.close(), "secondary"),
  );
  dialog.onclose = () => dialog.remove();
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });
  document.body.append(dialog);
  dialog.showModal();
}
function renderMarketCards() {
  const grid = $("#market-grid");
  if (!grid || !marketData) return;
  grid.replaceChildren();
  const installed = marketData.state.installed;
  const entries =
    marketTab === "installed"
      ? Object.values(installed)
      : marketData.entries.filter((entry) => entry.kind === marketTab);
  const filtered = entries.filter((entry) =>
    [entry.name, entry.description, entry.author, entry.id]
      .join(" ")
      .toLowerCase()
      .includes(marketQuery),
  );
  for (const entry of filtered) {
    const card = elem("article", "market-card");
    card.dataset.packageId = entry.id;
    const owned = !!installed[entry.kind + ":" + entry.id],
      active =
        entry.kind === "skin" && marketData.state.active_skin === entry.id;
    card.append(
      entry.kind === "skin" ? skinThumbnail(entry) : marketGlyph(entry.kind),
    );
    const title = elem("h2", "", entry.name);
    const origin = marketData.entries.some(
      (item) =>
        item.kind === entry.kind &&
        item.id === entry.id &&
        item.sha256 === entry.sha256,
    )
      ? "官方目录"
      : "本地导入";
    card.append(
      title,
      elem("small", "market-meta", origin),
      elem("p", "", entry.description),
      elem(
        "small",
        "market-meta",
        entry.author + " · " + entry.version + " · " + entry.license,
      ),
    );
    const actions = elem("div", "market-card-actions");
    if (entry.kind === "skin")
      actions.append(
        actionButton(
          active ? "当前皮肤" : "预览",
          () => previewMarketSkin(entry),
          "primary",
        ),
      );
    else if (!owned)
      actions.append(
        actionButton("安装并启用", () => installMarketPlugin(entry), "primary"),
      );
    else if (installed["plugin:" + entry.id].sha256 !== entry.sha256)
      actions.append(
        actionButton("更新并启用", () => installMarketPlugin(entry), "primary"),
      );
    else
      actions.append(
        elem("span", "market-installed", "已安装"),
        actionButton(
          "管理",
          () => {
            showSettings();
            selectSettingsTab("capabilities");
          },
          "secondary",
        ),
      );
    actions.append(
      actionButton("详情", () => marketDetails(entry), "secondary"),
    );
    if (owned)
      actions.append(
        actionButton(
          "卸载",
          async () => {
            if (!(await appConfirm("卸载 " + entry.name + "？"))) return;
            if (active) await resetMarketSkin();
            marketData.state = await api("/api/marketplace/uninstall", "POST", {
              kind: entry.kind,
              id: entry.id,
            });
            await reloadCapabilities();
            renderMarketCards();
          },
          "secondary",
        ),
      );
    card.append(actions);
    grid.append(card);
  }
  if (!filtered.length)
    grid.append(elem("p", "collection-empty", "没有匹配的作品。"));
}
async function renderMarketplacePage() {
  destinationTitle.textContent = "扩展市场";
  destinationActions.replaceChildren();
  destinationTabs.replaceChildren();
  destinationBody.replaceChildren();
  const search = elem("input");
  search.type = "search";
  search.placeholder = "搜索插件与皮肤";
  search.setAttribute("aria-label", "搜索插件与皮肤");
  search.value = marketQuery;
  search.oninput = () => {
    marketQuery = search.value.trim().toLowerCase();
    renderMarketCards();
  };
  destinationActions.append(
    search,
    actionButton(
      "刷新目录",
      async () => {
        marketData = await api("/api/marketplace/refresh", "POST");
        renderMarketCards();
        toast("目录已更新");
      },
      "secondary",
    ),
    actionButton("导入作品包", () => marketImporter.click(), "secondary"),
  );
  for (const [id, label] of [
    ["plugin", "插件"],
    ["skin", "UI 皮肤"],
    ["installed", "已安装"],
  ]) {
    const button = actionButton(
      label,
      () => {
        marketTab = id;
        for (const item of destinationTabs.children)
          item.classList.toggle("active", item === button);
        renderMarketCards();
      },
      "",
    );
    button.classList.toggle("active", marketTab === id);
    destinationTabs.append(button);
  }
  const intro = elem("section", "market-intro");
  intro.append(
    elem("span", "market-eyebrow", "ASTRA / MARKETPLACE"),
    elem("h2", "", "为你的工作空间，添一点可能。"),
    elem(
      "p",
      "",
      "官方目录提供声明式插件与玻璃主题。在线刷新失败时，仍可使用本地精选。",
    ),
  );
  const tools = elem("div", "market-card-actions");
  tools.append(
    actionButton("恢复原外观", resetMarketSkin, "secondary"),
    actionButton("导出当前皮肤", exportCurrentSkin, "secondary"),
  );
  tools.append(
    actionButton(
      "创建应用插件",
      () => {
        previewMaker();
        pluginMaker.showModal();
      },
      "secondary",
    ),
  );
  const submit = elem("a", "secondary", "投稿作品");
  submit.href =
    "https://github.com/xiaoycnj/AstraAgent/issues/new?title=%5BMarketplace%5D%20&body=Please%20attach%20your%20exported%20package%20and%20its%20license.";
  submit.target = "_blank";
  submit.rel = "noopener noreferrer";
  tools.append(submit);
  intro.append(tools);
  const grid = elem("div", "market-grid");
  grid.id = "market-grid";
  destinationBody.append(intro, grid);
  try {
    marketData = await api("/api/marketplace");
    if (appPage === "marketplace") renderMarketCards();
  } catch (error) {
    grid.append(elem("p", "", error.message));
  }
}
async function exportCurrentSkin() {
  const name = await appPrompt("皮肤名称", "我的皮肤");
  if (!name) return;
  const computed = getComputedStyle(document.documentElement),
    colors = {};
  for (const token of skinTokens.filter(
    (token) => !["--glass-blur", "--market-radius"].includes(token),
  )) {
    const value = computed.getPropertyValue(token).trim();
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) colors[token] = value;
    else {
      const parts = value
        .match(/^rgba?\(([^)]+)\)$/)?.[1]
        .split(",")
        .map(Number);
      if (parts?.length >= 3)
        colors[token] =
          "#" +
          parts
            .slice(0, 3)
            .map((part) => Math.round(part).toString(16).padStart(2, "0"))
            .join("") +
          (parts.length === 4
            ? Math.round(parts[3] * 255)
                .toString(16)
                .padStart(2, "0")
            : "");
    }
  }
  colors["--theme-color"] ||= "#202538";
  colors["--blue"] ||= "#879bff";
  const payload = {
    schema_version: 1,
    id: "custom-" + Date.now(),
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    colors,
    blur: Math.max(
      12,
      Math.min(40, parseInt(computed.getPropertyValue("--glass-blur")) || 26),
    ),
    radius: Math.max(
      8,
      Math.min(
        28,
        parseInt(computed.getPropertyValue("--market-radius")) || 20,
      ),
    ),
  };
  downloadMarketPackage(
    await makeMarketPackage("skin", payload, name, "自定义外观配色"),
  );
}
function canonicalMarketJson(value) {
  if (Array.isArray(value))
    return "[" + value.map(canonicalMarketJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ":" + canonicalMarketJson(value[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function makeMarketPackage(kind, payload, name, description) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalMarketJson(payload)),
  );
  const sha256 = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    schema_version: 1,
    id: payload.id,
    kind,
    name,
    description,
    author: "AstraAgent 用户",
    license: "MIT",
    version: payload.version || "1.0.0",
    payload,
    sha256,
  };
}
makerForm.append(
  actionButton(
    "导出市场作品包",
    async () => {
      const payload = makerManifest();
      downloadMarketPackage(
        await makeMarketPackage(
          "plugin",
          payload,
          payload.name,
          payload.description,
        ),
      );
    },
    "secondary",
  ),
);

const marketImporter = elem("input");
marketImporter.type = "file";
marketImporter.accept = ".json";
marketImporter.hidden = true;
document.body.append(marketImporter);
marketImporter.onchange = async () => {
  try {
    const file = marketImporter.files[0];
    if (!file) return;
    if (file.size > 500000) throw Error("作品包过大");
    const entry = JSON.parse(await file.text());
    if (
      !(await appConfirm(
        "导入 " +
          String(entry.name || "作品") +
          "\n" +
          String(entry.author || "") +
          " · " +
          String(entry.license || "") +
          "\n" +
          (entry.kind === "plugin"
            ? JSON.stringify(entry.payload?.hooks || [])
            : "UI 皮肤") +
          "\n确认导入？插件将在安装后启用。",
      ))
    )
      return;
    marketData = {
      ...(marketData || {}),
      state: await api("/api/marketplace/import", "POST", entry),
    };
    await reloadCapabilities();
    await renderMarketplacePage();
    toast("作品已导入");
  } catch (error) {
    toast(error.message);
  } finally {
    marketImporter.value = "";
  }
};
const marketOpen = () => navigatePage("marketplace");
const marketMenuButton = actionButton(
  "",
  () => {
    closeRailMenu();
    return marketOpen();
  },
  "rail-menu-item",
);
marketMenuButton.append(railIcon("plugins"), elem("span", "", "扩展市场"));
marketMenuButton.setAttribute("role", "menuitem");
railMenu.prepend(marketMenuButton);
pluginSection.prepend(actionButton("浏览扩展市场", marketOpen, "secondary"));
$(".settings-content [data-panel=appearance]")?.prepend(
  actionButton(
    "浏览皮肤市场",
    async () => {
      marketTab = "skin";
      await marketOpen();
    },
    "secondary",
  ),
);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && skinPreview) {
    event.preventDefault();
    cancelSkinPreview();
  }
});
const beforeMarketNavigate = navigatePage;
navigatePage = async function (...args) {
  cancelSkinPreview();
  return beforeMarketNavigate(...args);
};
Promise.resolve(studioReady)
  .then(async () => {
    const result = await api("/api/marketplace");
    marketData = result;
    const active = result.state.installed["skin:" + result.state.active_skin];
    if (active) {
      if (!localStorage.getItem("astra-market-baseline"))
        localStorage.setItem(
          "astra-market-baseline",
          JSON.stringify(captureSkinAppearance()),
        );
      paintMarketSkin(active.payload);
    }
  })
  .catch((error) => console.warn("Marketplace initialization", error.message));

// Manual appearance changes take ownership back from the installed theme.
async function releaseMarketAppearance() {
  if (!marketData?.state.active_skin) return;
  cancelSkinPreview();
  marketData.state = await api("/api/marketplace/skin", "PUT", { id: null });
  for (const token of skinTokens.filter(
    (token) =>
      !["--theme-color", "--blue", "--accent-color", "--glass-blur"].includes(
        token,
      ),
  ))
    document.documentElement.style.removeProperty(token);
  document.body.classList.remove("market-skin");
  localStorage.removeItem("astra-market-baseline");
}
for (const input of [$("#theme-color"), $("#accent-color")].filter(Boolean))
  input.addEventListener("input", () =>
    releaseMarketAppearance().catch((error) => toast(error.message)),
  );
document
  .querySelectorAll("[data-theme-choice]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      releaseMarketAppearance().catch((error) => toast(error.message)),
    ),
  );
