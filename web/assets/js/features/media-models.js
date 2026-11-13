// Model metadata remains scoped to the provider being edited.
const modelDetailFields = {};
const modelDetails = elem("div", "model-details-grid");
for (const [key, title, type] of [
  ["context_window", "上下文窗口（Token）", "number"],
  ["input_price", "输入价格 / 百万 Token", "number"],
  ["output_price", "输出价格 / 百万 Token", "number"],
  ["cached_input_price", "缓存读取价格 / 百万 Token", "number"],
  ["currency", "价格币种", "currency"],
  ["multimodal", "多模态输入", "multimodal"],
  ["kind", "模型用途", "kind"],
  ["max_output", "模型输出上限（Token）", "number"],
  ["reasoning", "推理能力", "reasoning"],
  ["reasoning_levels", "支持的推理档位", "text"],
]) {
  const label = elem("label", "", title);
  const input = elem(["number", "text"].includes(type) ? "input" : "select");
  input.id = "model-detail-" + key;
  if (type === "number") {
    input.type = "number";
    input.min =
      key === "context_window" ? "1024" : key === "max_output" ? "1" : "0";
    input.max = ["context_window", "max_output"].includes(key)
      ? "10000000"
      : "1000000";
    input.step = ["context_window", "max_output"].includes(key) ? "1" : "any";
    input.placeholder = "未配置";
  } else if (type === "text") {
    input.placeholder = "none, low, medium, high, xhigh, max";
    input.maxLength = 160;
  } else {
    const choices = {
      currency: [
        ["USD", "USD"],
        ["CNY", "CNY"],
        ["EUR", "EUR"],
        ["JPY", "JPY"],
      ],
      multimodal: [
        ["", "未指定"],
        ["true", "支持"],
        ["false", "仅文本"],
      ],
      kind: [
        ["auto", "跟随服务商"],
        ["chat", "对话"],
        ["image", "图片生成"],
        ["video", "视频生成"],
        ["other", "其他用途"],
      ],
      reasoning: [
        ["", "未指定"],
        ["true", "支持"],
        ["false", "不支持"],
      ],
    }[type];
    for (const [value, name] of choices) input.append(new Option(name, value));
  }
  input.addEventListener("change", () => {
    settingsDirty = true;
  });
  label.append(input);
  if (!["number", "text"].includes(type)) buildSelect(input);
  modelDetails.append(label);
  modelDetailFields[key] = input;
}
modelEntry.after(modelDetails);
modelDetails.after(
  elem(
    "p",
    "hint",
    "价格留空表示未知。上下文窗口用于自动压缩，费用按实际上报 Token 和配置单价估算。",
  ),
);
function editModelDetails(item = {}) {
  for (const [key, input] of Object.entries(modelDetailFields)) {
    const value = item[key] ?? ({ currency: "USD", kind: "auto" }[key] || "");
    input.value = Array.isArray(value) ? value.join(", ") : value;
    input._refresh?.();
  }
}
function readModelDetails() {
  const result = {};
  for (const [key, input] of Object.entries(modelDetailFields)) {
    if (!input.checkValidity()) {
      input.reportValidity();
      return null;
    }
    result[key] =
      input.type === "number"
        ? input.value === ""
          ? null
          : Number(input.value)
        : input.value;
  }
  result.multimodal =
    result.multimodal === "" ? null : result.multimodal === "true";
  result.reasoning =
    result.reasoning === "" ? null : result.reasoning === "true";
  result.reasoning_levels = result.reasoning_levels
    .split(/[,，\s]+/)
    .filter(Boolean);
  return result;
}
editModelDetails();

imageProviderType.append(
  new Option("视频服务商 · video_api", "video_api"),
  new Option("多模态服务商 · multimodal_api", "multimodal_api"),
);
imageProviderType._refresh?.();
const providerCapabilities = elem("div", "provider-capabilities");
const capabilitySwitches = {};
for (const [key, title] of [
  ["chat", "对话能力"],
  ["image", "图片生成"],
  ["video", "视频生成"],
]) {
  const label = elem("label", "switch-pill");
  const input = elem("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.addEventListener("change", () => {
    settingsDirty = true;
  });
  label.append(elem("span", "", title), input);
  providerCapabilities.append(label);
  capabilitySwitches[key] = input;
}
imageProviderField.after(
  providerCapabilities,
  elem(
    "p",
    "hint",
    "视频服务商支持配置与模型管理；视频生成协议将在对应厂商适配后接入。",
  ),
);
function setProviderCapabilities(config) {
  const defaults = {
    chat_api: ["chat"],
    image_api: ["image"],
    video_api: ["video"],
    multimodal_api: ["chat", "image", "video"],
  };
  const enabled = config.capabilities || defaults[config.type || "chat_api"];
  for (const [key, input] of Object.entries(capabilitySwitches))
    input.checked = enabled.includes(key);
}
const beforeMediaConfig = configForm;
configForm = function () {
  return {
    ...beforeMediaConfig(),
    capabilities: Object.entries(capabilitySwitches)
      .filter(([, input]) => input.checked)
      .map(([key]) => key),
  };
};
const beforeMediaExpand = expandProvider;
expandProvider = function (id, source, mode) {
  beforeMediaExpand(id, source, mode);
  setProviderCapabilities(
    providerMode === "default"
      ? state.settings
      : providerRows.find((row) => row.id === id) || {},
  );
  providerCapabilities.hidden = providerMode === "default";
};
imageProviderType.addEventListener("change", () =>
  setProviderCapabilities({ type: imageProviderType.value }),
);
renderProviderCards = function () {
  providerGrid.replaceChildren();
  for (const [type, title] of [
    ["chat_api", "对话服务商"],
    ["image_api", "图片服务商"],
    ["video_api", "视频服务商"],
    ["multimodal_api", "多模态服务商"],
  ]) {
    const header = elem("div", "provider-grid-heading");
    header.append(elem("h2", "", title));
    providerGrid.append(header);
    const rows = providerRows.filter(
      (row) => (row.type || "chat_api") === type,
    );
    for (const row of [{ id: "", name: "新增服务商" }, ...rows]) {
      const card = elem("button", "provider-card");
      card.type = "button";
      card.append(
        svgIcon(row.id ? "canvas" : "plus"),
        elem("strong", "", row.name),
        chevron(),
      );
      card.onclick = () => {
        expandProvider(row.id, card);
        if (!row.id) {
          imageProviderType.value = type;
          imageProviderType._refresh?.();
          imageProviderType.dispatchEvent(new Event("change"));
        }
      };
      providerGrid.append(card);
    }
  }
  const fallback = actionButton(
    "默认接口",
    () => expandProvider("", null, "default"),
    "provider-card",
  );
  fallback.prepend(svgIcon("settings"));
  providerGrid.append(fallback);
};
const beforeCostUsage = drawUsage;
drawUsage = function () {
  beforeCostUsage();
  if (!usageData) return;
  for (const estimate of usageData.costs || []) {
    const box = elem("div");
    box.append(
      elem(
        "strong",
        "",
        estimate.currency + " " + Number(estimate.amount).toFixed(6),
      ),
      elem("span", "", "成本估算"),
    );
    usageTotals.append(box);
  }
  usageHint.append(
    elem(
      "span",
      "",
      " " + uiText("费用仅按已配置单价估算，未定价或未上报用量的调用不计入。"),
    ),
  );
};
studioReady.then(() => {
  renderProviderCards();
});
