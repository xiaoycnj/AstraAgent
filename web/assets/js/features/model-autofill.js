// Reference metadata is shared with backend matching. Connection identity stays explicit.
const modelAutofillStatus = elem("p", "hint model-autofill-status");
modelAutofillStatus.setAttribute("role", "status");
modelEntry.after(modelAutofillStatus);
const useReferenceButton = actionButton(
  "使用参考规格",
  () => fillModelEntry(true),
  "secondary",
);
useReferenceButton.hidden = true;
modelAutofillStatus.after(useReferenceButton);
const chooseReferenceButton = actionButton(
  "选择参考厂商",
  () => {
    registryField.closest("details").open = true;
    registryVendor.nextElementSibling.focus();
  },
  "secondary",
);
chooseReferenceButton.hidden = true;
useReferenceButton.after(chooseReferenceButton);
let modelMatchTicket = 0,
  modelMatchTimer,
  entryOriginId = "",
  entryAppliedId = "",
  autoAlias = "",
  entryOriginalValues = {};
const manuallyEditedModelFields = new Set();
for (const [key, input] of Object.entries(modelDetailFields)) {
  for (const event of ["input", "change"])
    input.addEventListener(event, () => manuallyEditedModelFields.add(key));
}
modelEnabled.addEventListener("change", () =>
  manuallyEditedModelFields.add("enabled"),
);
aliasInput.addEventListener("input", () =>
  manuallyEditedModelFields.add("name"),
);
const beforeAutofillDetails = editModelDetails;
editModelDetails = function (item = {}) {
  beforeAutofillDetails(item);
  modelMatchTicket++;
  entryOriginId = item.id || "";
  entryOriginalValues = { ...item };
  entryAppliedId = item.id || "";
  autoAlias = "";
  manuallyEditedModelFields.clear();
  modelAutofillStatus.textContent = "";
  useReferenceButton.hidden = true;
  chooseReferenceButton.hidden = true;
};
function modelAutofillContext() {
  return JSON.stringify([
    providerMode,
    $("#provider-edit").value,
    $("#base-url").value.trim(),
    registryVendor.value,
  ]);
}
async function lookupModelReferences(ids) {
  return api("/api/model-registry/match", "POST", {
    models: ids,
    base_url: $("#base-url").value.trim(),
    registry_vendor: registryVendor.value,
  });
}
function mergeModelReference(item, reference) {
  const next = { ...item };
  const priceKeys = ["input_price", "output_price", "cached_input_price"];
  const hasPrices = priceKeys.some((key) => item[key] != null);
  const protectedCurrency =
    hasPrices || (item.currency && item.currency !== "USD");
  const differentCurrency =
    protectedCurrency &&
    item.currency &&
    reference.currency &&
    item.currency !== reference.currency;
  for (const key of [...Object.keys(modelDetailFields), "enabled"]) {
    if (differentCurrency && priceKeys.includes(key)) continue;
    if (
      reference[key] !== undefined &&
      (next[key] == null ||
        (key === "kind" && next[key] === "auto") ||
        (key === "reasoning_levels" && !next[key].length))
    )
      next[key] = reference[key];
  }
  if (!protectedCurrency && reference.currency)
    next.currency = reference.currency;
  if (!next.name || next.name === next.id)
    next.name = reference.name || next.id;
  return next;
}
async function hydrateProviderModels() {
  if (!providerModelDraft.length || !providerDialog.open) return;
  const draft = providerModelDraft,
    context = modelAutofillContext();
  try {
    const result = await lookupModelReferences(draft.map((item) => item.id));
    if (
      !providerDialog.open ||
      context !== modelAutofillContext() ||
      draft !== providerModelDraft
    )
      return;
    const references = new Map(
      result.results
        .filter((item) => item.status === "matched")
        .map((item) => [item.id, item.model]),
    );
    const enriched = draft.map((item) =>
      references.has(item.id)
        ? mergeModelReference(item, references.get(item.id))
        : item,
    );
    if (JSON.stringify(draft) !== JSON.stringify(enriched)) {
      providerModelDraft = enriched;
      settingsDirty = true;
      renderProviderModels();
      modelManagerFeedback.textContent =
        uiText("已补全参考规格，保存服务商后生效。");
    }
  } catch (error) {
    if (context === modelAutofillContext() && providerDialog.open)
      modelManagerFeedback.textContent = error.message;
  }
}
async function fillModelEntry(force = false) {
  clearTimeout(modelMatchTimer);
  const id = modelIdInput.value.trim(),
    context = modelAutofillContext(),
    ticket = ++modelMatchTicket;
  if (!id) {
    modelAutofillStatus.textContent = "";
    useReferenceButton.hidden = true;
    chooseReferenceButton.hidden = true;
    return;
  }
  try {
    const result = await lookupModelReferences([id]);
    if (
      ticket !== modelMatchTicket ||
      id !== modelIdInput.value.trim() ||
      context !== modelAutofillContext() ||
      !providerDialog.open
    )
      return;
    const match = result.results[0];
    if (!entryAppliedId && !entryOriginId) {
      for (const [key, input] of Object.entries(modelDetailFields)) {
        const initial =
          { currency: "USD", kind: "auto", tier: "advanced" }[key] || "";
        if (input.value !== "" && input.value !== initial)
          manuallyEditedModelFields.add(key);
      }
      if (!modelEnabled.checked) manuallyEditedModelFields.add("enabled");
    }
    chooseReferenceButton.hidden = match.status !== "ambiguous";
    useReferenceButton.hidden = match.status !== "matched";
    if (entryAppliedId && id !== entryAppliedId) {
      for (const [key, input] of Object.entries(modelDetailFields))
        if (!manuallyEditedModelFields.has(key)) {
          const value =
            (id === entryOriginId ? entryOriginalValues[key] : undefined) ??
            ({ currency: "USD", kind: "auto", tier: "advanced" }[key] || "");
          input.value = Array.isArray(value) ? value.join(", ") : String(value);
          input._refresh?.();
        }
      if (!manuallyEditedModelFields.has("enabled"))
        modelEnabled.checked =
          id === entryOriginId ? entryOriginalValues.enabled !== false : true;
    }
    entryAppliedId = id;
    if (match.status !== "matched") {
      if (
        aliasInput.value === autoAlias &&
        !manuallyEditedModelFields.has("name")
      )
        aliasInput.value = "";
      modelAutofillStatus.textContent = uiText(
        match.status === "ambiguous"
          ? "同名模型存在多份规格，请选择参考厂商。"
          : "未找到参考规格，可手动填写。",
      );
      return;
    }
    const reference = match.model;
    const priceKeys = ["input_price", "output_price", "cached_input_price"];
    const originalPricing =
      id === entryOriginId &&
      priceKeys.some((key) => entryOriginalValues[key] != null);
    const editedPricing = priceKeys.some(
      (key) =>
        manuallyEditedModelFields.has(key) &&
        modelDetailFields[key].value !== "",
    );
    const currencyClash =
      !force &&
      reference.currency &&
      modelDetailFields.currency.value !== reference.currency &&
      (originalPricing ||
        editedPricing ||
        manuallyEditedModelFields.has("currency"));
    for (const [key, input] of Object.entries(modelDetailFields)) {
      if (currencyClash && (priceKeys.includes(key) || key === "currency"))
        continue;
      const blank =
        input.value === "" || (key === "kind" && input.value === "auto");
      if (
        reference[key] === undefined ||
        (!force &&
          (manuallyEditedModelFields.has(key) ||
            (id === entryOriginId &&
              !blank &&
              !(key === "currency" && !originalPricing))))
      )
        continue;
      const value = reference[key];
      input.value = Array.isArray(value)
        ? value.join(", ")
        : value == null
          ? ""
          : String(value);
      input._refresh?.();
    }
    if (
      reference.enabled !== undefined &&
      (force || (!entryOriginId && !manuallyEditedModelFields.has("enabled")))
    )
      modelEnabled.checked = reference.enabled !== false;
    if (
      !manuallyEditedModelFields.has("name") &&
      (!aliasInput.value ||
        aliasInput.value === id ||
        aliasInput.value === autoAlias)
    ) {
      aliasInput.value = reference.name || id;
      autoAlias = aliasInput.value;
    }
    if (force) manuallyEditedModelFields.clear();
    modelDetails.closest("details").open = true;
    settingsDirty = true;
    modelAutofillStatus.textContent =
      uiText("已匹配参考规格，手动修改会保留。价格请以服务商为准。") +
      " · " +
      match.matches.map((item) => item.provider_name).join(" / ");
  } catch (error) {
    if (ticket === modelMatchTicket && context === modelAutofillContext())
      modelAutofillStatus.textContent = error.message;
  }
}
modelIdInput.addEventListener("input", () => {
  modelMatchTicket++;
  clearTimeout(modelMatchTimer);
  modelMatchTimer = setTimeout(fillModelEntry, 220);
});
for (const input of [registryVendor, $("#base-url")])
  input.addEventListener("change", () => {
    modelMatchTicket++;
    hydrateProviderModels();
    if (modelIdInput.value.trim()) fillModelEntry();
  });
const beforeAutofillExpand = expandProvider;
expandProvider = function (...args) {
  beforeAutofillExpand(...args);
  hydrateProviderModels();
};
providerDialog.addEventListener("close", () => {
  modelMatchTicket++;
  clearTimeout(modelMatchTimer);
});

const routingPreview = elem("section", "routing-preview");
const autoScope = elem("select");
autoScope.id = "auto-routing-scope";
autoScope.append(
  new Option("全部已配置服务商", "all"),
  new Option("仅当前对话服务商", "current"),
);
try {
  autoScope.value = localStorage.getItem("astra-auto-scope") || "all";
} catch {}
if (!["all", "current"].includes(autoScope.value)) autoScope.value = "all";
const autoScopeLabel = elem("label", "", "调度范围（即时生效）");
autoScopeLabel.append(autoScope);
routingSettings.querySelector("h3").after(autoScopeLabel);
buildSelect(autoScope);
autoScope.addEventListener("change", () => {
  try {
    localStorage.setItem("astra-auto-scope", autoScope.value);
  } catch {}
  syncComposerControls();
});
const beforeScopedOptions = runtimeOptions;
runtimeOptions = function () {
  const options = beforeScopedOptions();
  if (chosenModel() === AUTO_MODEL) {
    options.model = AUTO_MODEL;
    options.auto_scope = autoScope.value;
    if (autoScope.value === "all") options.provider = "";
  }
  return options;
};
const scopeHint = elem("p", "hint auto-scope-hint");
reasoningPopover.append(scopeHint);
const beforeScopedSync = syncComposerControls;
syncComposerControls = function () {
  beforeScopedSync();
  const automatic = chosenModel() === AUTO_MODEL;
  const model = selectedModelCatalog().find(
    (item) => item.id === chosenModel(),
  );
  slider.disabled = !automatic && model?.reasoning === false;
  scopeHint.hidden =
    !automatic &&
    model?.reasoning !== false &&
    !model?.reasoning_levels?.length;
  scopeHint.textContent = automatic
    ? uiText(
        autoScope.value === "all"
          ? "在全部已配置服务商中自动选择"
          : "仅在当前对话服务商中自动选择",
      )
    : model?.reasoning === false
      ? uiText("当前模型不使用推理档位")
      : uiText("支持的推理档位") +
        " · " +
        (model?.reasoning_levels || []).join(" / ");
};
syncComposerControls();
const routingTask = elem("textarea");
routingTask.rows = 2;
routingTask.maxLength = 8000;
routingTask.setAttribute("aria-label", "路由预览任务");
routingTask.placeholder = "输入任务，检查规则路由与模型候选";
const routingTools = elem("input"),
  routingVision = elem("input");
const routingOptions = elem("div", "routing-preview-options");
for (const [input, title] of [
  [routingTools, "需要工具能力"],
  [routingVision, "需要视觉能力"],
]) {
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  const label = elem("label", "switch-pill");
  label.append(elem("span", "", title), input);
  routingOptions.append(label);
}
const routingResult = elem("div", "routing-preview-result");
routingResult.setAttribute("role", "status");
let routingPreviewTicket = 0;
function invalidateRoutingPreview() {
  routingPreviewTicket++;
  routingResult.replaceChildren();
}
for (const input of [
  routingTask,
  routingTools,
  routingVision,
  autoScope,
  $("#provider-select"),
  slider,
]) {
  input.addEventListener(
    input === routingTask || input === slider ? "input" : "change",
    invalidateRoutingPreview,
  );
}
const previewRouting = actionButton(
  "检查候选与规则路由",
  async () => {
    const ticket = ++routingPreviewTicket;
    busyButton(previewRouting, true, "检查中…");
    try {
      const result = await api("/api/auto-routing/preview", "POST", {
        content: routingTask.value,
        allow_tools: routingTools.checked,
        vision: routingVision.checked,
        auto_min_tier: autoMinimumTier,
        auto_scope: autoScope.value,
        provider:
          autoScope.value === "current" ? $("#provider-select").value : "",
      });
      if (ticket !== routingPreviewTicket) return;
      routingResult.replaceChildren(
        elem(
          "p",
          "",
          result.error
            ? uiText(result.error)
            : result.route.resolved_model +
                " · " +
                result.route.reason
                  .split("；")
                  .map((part) => uiText(part))
                  .join(" · "),
        ),
      );
      for (const model of result.models)
        routingResult.append(
          elem(
            "p",
            model.eligible ? "" : "hint",
            model.provider + " / " + model.id + " · " + uiText(model.reason),
          ),
        );
    } catch (error) {
      if (ticket === routingPreviewTicket)
        routingResult.textContent = error.message;
    } finally {
      busyButton(previewRouting, false);
    }
  },
  "secondary",
);
routingPreview.append(
  elem("h3", "", "路由检查"),
  elem(
    "p",
    "hint",
    "使用已保存配置预览规则，不会调用 AI Judge。最低等级沿用对话中的 Auto 滑块。",
  ),
  routingTask,
  routingOptions,
  previewRouting,
  routingResult,
);
routingSettings.after(routingPreview);
