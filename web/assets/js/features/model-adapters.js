// Native protocol and provider capabilities are explicit per saved connection.
const adapterPanel = elem("fieldset", "settings-group");
adapterPanel.append(elem("legend", "", "模型专项适配"));
const adapterFields = {};
for (const [key, label, options] of [
  [
    "vendor",
    "厂商适配",
    [
      ["auto", "自动 · 官方域名"],
      ["generic", "通用兼容"],
      ["openai", "OpenAI"],
      ["deepseek", "DeepSeek"],
      ["anthropic", "Anthropic"],
      ["glm", "GLM / 智谱"],
    ],
  ],
  [
    "api_protocol",
    "请求协议",
    [
      ["chat", "Chat Completions"],
      ["responses", "Responses API"],
      ["messages", "Claude Messages"],
    ],
  ],
  [
    "cache_mode",
    "显式缓存策略",
    [
      ["auto", "自动"],
      ["off", "关闭客户端显式缓存"],
      ["5m", "Claude · 5 分钟"],
      ["1h", "Claude · 1 小时"],
    ],
  ],
  [
    "thinking_mode",
    "Claude 思考模式",
    [
      ["auto", "按模型自动选择"],
      ["adaptive", "Adaptive thinking"],
      ["budget", "固定思考预算"],
    ],
  ],
  [
    "verbosity",
    "Responses 回答详略",
    [
      ["default", "默认"],
      ["low", "简洁"],
      ["medium", "适中"],
      ["high", "详细"],
    ],
  ],
]) {
  const labelNode = elem("label", "", label),
    select = elem("select");
  select.id = "adapter-" + key;
  for (const [value, text] of options) select.append(new Option(text, value));
  select.onchange = () => {
    settingsDirty = true;
  };
  labelNode.append(select);
  adapterPanel.append(labelNode);
  adapterFields[key] = select;
  buildSelect(select);
}
for (const [key, label, value] of [
  ["max_output_tokens", "输出 Token 上限", 16384],
  ["thinking_budget", "Claude 固定思考预算", 4096],
]) {
  const labelNode = elem("label", "", label),
    input = elem("input");
  input.type = "number";
  input.min = "1024";
  input.max = key === "thinking_budget" ? "65536" : "131072";
  input.value = value;
  input.id = "adapter-" + key;
  input.oninput = () => {
    settingsDirty = true;
  };
  labelNode.append(input);
  adapterPanel.append(labelNode);
  adapterFields[key] = input;
}
adapterPanel.append(
  elem(
    "p",
    "hint",
    "Anthropic 适配使用 Messages 协议。DeepSeek 与 GLM 使用隐式缓存，关闭显式缓存不会关闭服务端自动缓存。代理接口可手动选择厂商，未知域名保持通用兼容。",
  ),
);
adapterPanel.append(
  elem(
    "p",
    "hint",
    "档位会按模型能力映射。强制思考模型选择“关闭”时使用最低档，实际参数请参阅模型适配说明。",
  ),
);
$("#system-prompt").closest("label").before(adapterPanel);
const beforeAdapterConfig = configForm;
configForm = function () {
  return {
    ...beforeAdapterConfig(),
    ...Object.fromEntries(
      Object.entries(adapterFields).map(([key, input]) => [
        key,
        input.type === "number" ? Number(input.value) : input.value,
      ]),
    ),
  };
};
const beforeAdapterExpand = expandProvider;
expandProvider = function (id, source, mode) {
  beforeAdapterExpand(id, source, mode);
  const config =
    providerMode === "default"
      ? state.settings
      : providerRows.find((row) => row.id === id) || {};
  for (const [key, input] of Object.entries(adapterFields)) {
    input.value =
      config[key] ??
      {
        vendor: "auto",
        api_protocol: "chat",
        cache_mode: "auto",
        thinking_mode: "auto",
        verbosity: "default",
        max_output_tokens: 16384,
        thinking_budget: 4096,
      }[key];
    input._refresh?.();
  }
  adapterPanel.hidden = imageProviderType.value === "image_api";
};
const reasoningChoices = $("#reasoning-select");
reasoningChoices.replaceChildren(
  ...strengths.map((value, index) => new Option(strengthNames[index], value)),
);
let savedReasoning;
try {
  savedReasoning = JSON.parse(
    localStorage.getItem("astra-runtime") || "{}",
  ).reasoning;
} catch {
  savedReasoning = "default";
}
reasoningChoices.value = strengths.includes(savedReasoning)
  ? savedReasoning
  : "default";
syncComposerControls();

imageProviderType.addEventListener("change", () => {
  adapterPanel.hidden = imageProviderType.value === "image_api";
});

adapterFields.vendor.addEventListener("change", () => {
  if (adapterFields.vendor.value === "anthropic") {
    adapterFields.api_protocol.value = "messages";
    adapterFields.api_protocol._refresh?.();
  }
});
