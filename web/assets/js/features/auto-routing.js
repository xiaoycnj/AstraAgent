const AUTO_MODEL = "AutoModelReview";
const AUTO_TIERS = ["standard", "advanced", "flagship"];
const AUTO_LABELS = ["标准", "高级", "旗舰"];
function hasModelConnection() {
  if (chosenModel() === AUTO_MODEL)
    return (
      providerRows.some(
        (row) =>
          row.base_url &&
          (
            row.capabilities ||
            { image_api: [], video_api: [] }[row.type] || ["chat"]
          ).includes("chat"),
      ) || !!state.settings.base_url
    );
  return !!(state.settings.base_url || $("#provider-select").value);
}
let autoMinimumTier = localStorage.getItem("astra-auto-tier") || "standard";
if (!AUTO_TIERS.includes(autoMinimumTier)) autoMinimumTier = "standard";
let registrySnapshot;

const registryVendor = elem("select");
registryVendor.id = "registry-vendor";
registryVendor.append(new Option("自动 · 官方域名", "auto"));
const registryField = elem("label", "", "规格参考厂商");
registryField.append(registryVendor);
imageProviderField.after(registryField);
buildSelect(registryVendor);
const beforeRegistryConfig = configForm;
configForm = function () {
  return { ...beforeRegistryConfig(), registry_vendor: registryVendor.value };
};
const beforeRegistryExpand = expandProvider;
expandProvider = function (id, source, mode) {
  beforeRegistryExpand(id, source, mode);
  const config =
    providerMode === "default"
      ? state.settings
      : providerRows.find((row) => row.id === id) || {};
  registryVendor.value = config.registry_vendor || "auto";
  registryVendor._refresh?.();
};

for (const [key, title, choices] of [
  [
    "tier",
    "路由模型等级（预设）",
    [
      ["standard", "标准"],
      ["advanced", "高级"],
      ["flagship", "旗舰"],
    ],
  ],
  [
    "tool_calling",
    "工具调用能力",
    [
      ["", "未指定"],
      ["true", "支持"],
      ["false", "不支持"],
    ],
  ],
]) {
  const label = elem("label", "", title),
    input = elem("select");
  input.id = "model-detail-" + key;
  for (const [value, name] of choices) input.append(new Option(name, value));
  label.append(input);
  modelDetails.append(label);
  buildSelect(input);
  modelDetailFields[key] = input;
}
const modelEnabled = elem("input");
modelEnabled.type = "checkbox";
modelEnabled.setAttribute("role", "switch");
modelEnabled.checked = true;
const modelEnabledLabel = elem("label", "switch-pill");
modelEnabledLabel.append(elem("span", "", "允许自动路由"), modelEnabled);
modelDetails.append(modelEnabledLabel);
const beforeRegistryDetails = editModelDetails;
editModelDetails = function (item = {}) {
  beforeRegistryDetails(item);
  modelDetailFields.tier.value = item.tier || "advanced";
  modelDetailFields.tier._refresh?.();
  modelEnabled.checked = item.enabled !== false;
};
const beforeRegistryRead = readModelDetails;
readModelDetails = function () {
  const value = beforeRegistryRead();
  if (!value) return null;
  value.tool_calling =
    value.tool_calling === "" ? null : value.tool_calling === "true";
  value.enabled = modelEnabled.checked;
  return value;
};
editModelDetails();

const registryDialog = elem("dialog", "registry-dialog");
registryDialog.setAttribute("aria-label", "内置模型数据库");
const registrySearch = elem("input");
registrySearch.type = "search";
registrySearch.placeholder = "搜索模型或厂商";
const registryList = elem("div", "registry-model-list");
registryDialog.append(
  elem("h2", "", "内置模型数据库"),
  elem(
    "p",
    "hint",
    "来源 Models.dev，离线快照与参考价格。模型等级是可编辑的本地预设。导入不会创建密钥或自动启用服务商。",
  ),
  registrySearch,
  registryList,
  actionButton("关闭", () => registryDialog.close(), "secondary"),
);
document.body.append(registryDialog);
function addRegistryModel(provider, model) {
  const existing = providerModelDraft.some((row) => row.id === model.id);
  if (!existing && providerModelDraft.length >= 500) {
    toast("最多保存 500 个模型");
    return;
  }
  if (existing && typeof mergeModelReference === "function") {
    providerModelDraft = providerModelDraft.map((item) =>
      item.id === model.id ? mergeModelReference(item, model) : item,
    );
  } else if (!existing) providerModelDraft.push({ ...model });
  if (!$("#model").value) $("#model").value = model.id;
  settingsDirty = true;
  renderProviderModels();
  renderRegistryList();
}
function renderRegistryList() {
  registryList.replaceChildren();
  if (!registrySnapshot) return;
  const query = registrySearch.value.toLowerCase();
  for (const provider of registrySnapshot.providers) {
    for (const model of provider.models.filter((row) =>
      (provider.name + " " + row.id + " " + row.name)
        .toLowerCase()
        .includes(query),
    )) {
      const row = elem("div", "registry-model-row"),
        details = elem("div");
      details.append(
        elem("strong", "", model.name),
        elem(
          "small",
          "",
          provider.name +
            " · " +
            model.id +
            " · " +
            (model.context_window || "—") +
            " Token",
        ),
      );
      const added = providerModelDraft.some((item) => item.id === model.id);
      const button = actionButton(
        added ? "补全规格" : "导入",
        () => addRegistryModel(provider, model),
        "secondary",
      );
      row.append(modelLogo(model.id), details, button);
      registryList.append(row);
    }
  }
}
registrySearch.oninput = renderRegistryList;
managerTop.append(
  actionButton(
    "内置模型库",
    () => {
      renderRegistryList();
      registryDialog.showModal();
    },
    "secondary",
  ),
);

const routingSettings = elem("section", "settings-group");
routingSettings.append(elem("h3", "", "Auto Model Review"));
const routingMode = elem("select"),
  routingStrategy = elem("select"),
  routingCurrency = elem("select"),
  judgeProvider = elem("select"),
  judgeModel = elem("input");
routingMode.id = "auto-routing-mode";
judgeModel.id = "auto-judge-model";
judgeModel.placeholder = "Judge 模型 ID";
for (const currency of ["USD", "CNY", "EUR", "JPY"])
  routingCurrency.append(new Option(currency, currency));
for (const [value, name] of [
  ["rules", "规则路由"],
  ["ai", "AI 路由"],
])
  routingMode.append(new Option(name, value));
for (const [value, name] of [
  ["balanced", "综合推荐"],
  ["quality", "质量优先"],
  ["price", "价格优先"],
])
  routingStrategy.append(new Option(name, value));
for (const [title, field] of [
  ["路由逻辑", routingMode],
  ["路由策略", routingStrategy],
  ["价格比较币种", routingCurrency],
  ["Judge 服务商", judgeProvider],
  ["Judge 模型", judgeModel],
]) {
  const label = elem("label", "", title);
  label.append(field);
  routingSettings.append(label);
  if (field.tagName === "SELECT") buildSelect(field);
}
const routingFeedback = elem("p", "hint");
function refreshJudgeProviders() {
  const selected = judgeProvider.value;
  judgeProvider.replaceChildren(
    new Option("默认接口", ""),
    ...providerRows
      .filter((row) =>
        (
          row.capabilities ||
          { image_api: [], video_api: [] }[row.type] || ["chat"]
        ).includes("chat"),
      )
      .map((row) => new Option(row.name, row.id)),
  );
  judgeProvider.value = selected;
  judgeProvider._refresh?.();
}
const beforeRoutingProviders = loadProviders;
loadProviders = async function () {
  await beforeRoutingProviders();
  refreshJudgeProviders();
};
routingSettings.append(
  elem(
    "p",
    "hint",
    "选择 AutoModelReview 时生效。AI 路由会将任务文本发送给配置的 Judge，产生额外调用费用；判断失败时显示原因并使用规则。只从已配置且能力匹配的模型中选择。",
  ),
  actionButton(
    "保存路由设置",
    async () => {
      try {
        await api("/api/auto-routing", "PUT", {
          mode: routingMode.value,
          strategy: routingStrategy.value,
          price_currency: routingCurrency.value,
          judge_provider: judgeProvider.value,
          judge_model: judgeModel.value.trim(),
        });
        routingFeedback.textContent = "路由设置已保存";
      } catch (error) {
        routingFeedback.textContent = error.message;
      }
    },
    "secondary",
  ),
  routingFeedback,
);
providerHost.prepend(routingSettings);
async function loadRoutingSettings() {
  const [registry, settings] = await Promise.all([
    api("/api/model-registry"),
    api("/api/auto-routing"),
  ]);
  registrySnapshot = registry;
  const editing = providerDialog.open
    ? providerMode === "default"
      ? state.settings
      : providerRows.find((row) => row.id === $("#provider-edit").value)
    : null;
  const selectedReference =
    registryVendor.value || editing?.registry_vendor || "auto";
  registryVendor.replaceChildren(
    new Option("自动 · 官方域名", "auto"),
    ...registry.providers.map((row) => new Option(row.name, row.id)),
  );
  registryVendor.value = selectedReference;
  registryVendor._refresh?.();
  refreshJudgeProviders();
  routingMode.value = settings.mode;
  routingStrategy.value = settings.strategy;
  routingCurrency.value = settings.price_currency;
  judgeProvider.value = settings.judge_provider;
  judgeModel.value = settings.judge_model;
  for (const field of [
    routingMode,
    routingStrategy,
    routingCurrency,
    judgeProvider,
  ])
    field._refresh?.();
}
const beforeAutoRender = renderModelChoices;
renderModelChoices = function () {
  beforeAutoRender();
  const active = chosenModel() === AUTO_MODEL;
  const button = actionButton("", () => useModel(AUTO_MODEL), "model-choice");
  button.dataset.modelId = AUTO_MODEL;
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(active));
  button.append(
    svgIcon("review"),
    elem("span", "model-display-name", AUTO_MODEL),
    elem("span", "checkmark", active ? "✓" : ""),
  );
  modelList.prepend(button);
};
const beforeAutoOptions = runtimeOptions;
runtimeOptions = function () {
  return { ...beforeAutoOptions(), auto_min_tier: autoMinimumTier };
};
const beforeAutoSync = syncComposerControls;
syncComposerControls = function () {
  beforeAutoSync();
  const automatic = chosenModel() === AUTO_MODEL;
  slider.max = automatic ? "2" : "7";
  if (automatic) {
    const index = Math.max(0, AUTO_TIERS.indexOf(autoMinimumTier));
    slider.value = index;
    slider.setAttribute("aria-valuetext", AUTO_LABELS[index]);
    strengthLabel.textContent =
      uiText("最低模型强度") + " · " + uiText(AUTO_LABELS[index]);
    rail.style.setProperty("--progress", (index / 2) * 100 + "%");
    const badge = $("#model-pill .model-strength");
    if (badge)
      badge.textContent =
        uiText("最低模型强度") + " · " + uiText(AUTO_LABELS[index]);
    for (const node of [rail, reasoningPopover, $("#model-pill")])
      node.classList.toggle("maxed", index === 2);
  }
  ticks.hidden = automatic;
  slider.setAttribute(
    "aria-label",
    uiText(automatic ? "最低模型强度" : "思考强度"),
  );
  labels.firstElementChild.textContent = automatic ? "标准" : "默认";
  labels.lastElementChild.textContent = automatic ? "旗舰" : "最高";
};
const beforeAutoSlider = slider.oninput;
slider.oninput = function () {
  if (chosenModel() !== AUTO_MODEL) return beforeAutoSlider();
  autoMinimumTier = AUTO_TIERS[Number(slider.value)] || "standard";
  localStorage.setItem("astra-auto-tier", autoMinimumTier);
  saveRuntime();
  syncComposerControls();
};
const beforeAutoReset = resetReasoning.onclick;
resetReasoning.onclick = function () {
  if (chosenModel() !== AUTO_MODEL) return beforeAutoReset();
  autoMinimumTier = "standard";
  localStorage.setItem("astra-auto-tier", autoMinimumTier);
  syncComposerControls();
};
eventNames.routing = "自动模型路由";
const beforeRoutingEvent = handleAgentEvent;
handleAgentEvent = function (sid, event) {
  beforeRoutingEvent(sid, event);
  if (event.type === "routing" && state.session?.id === sid)
    modelStatus.textContent = event.resolved_model + " · " + event.reason;
};
studioReady
  .then(() => loadRoutingSettings())
  .catch((error) => {
    routingFeedback.textContent = error.message;
  });
syncComposerControls();
