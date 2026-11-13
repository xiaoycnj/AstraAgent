// Provider-scoped model catalog: friendly names stay separate from API IDs.
let providerModelDraft = [],
  editingModelId = null;
const legacyModelRow = $("#model").closest("label");
legacyModelRow.classList.add("legacy-model-row");
$("#model").required = false;
const modelManager = elem("section", "model-manager");
legacyModelRow.after(modelManager);
const managerTop = elem("div", "model-manager-top");
managerTop.append(elem("strong", "", "模型列表"));
const fetchProviderModels = actionButton(
  "获取模型",
  fetchProviderModelList,
  "secondary",
);
fetchProviderModels.id = "fetch-provider-models";
const addProviderModel = actionButton("", commitProviderModel, "model-add");
addProviderModel.id = "add-provider-model";
addProviderModel.title = "添加模型";
addProviderModel.setAttribute("aria-label", "添加模型");
addProviderModel.append(svgIcon("plus"));
managerTop.append(fetchProviderModels, addProviderModel);
modelManager.append(managerTop);
const modelEntry = elem("div", "model-entry");
const aliasInput = elem("input");
aliasInput.id = "model-alias";
aliasInput.placeholder = "输入模型名称";
aliasInput.maxLength = 120;
aliasInput.setAttribute("aria-label", "模型显示名称");
const idLabel = elem("span", "", "ID:");
const modelIdInput = elem("input");
modelIdInput.id = "model-api-id";
modelIdInput.placeholder = "例如 gpt-6-astra";
modelIdInput.maxLength = 200;
modelIdInput.setAttribute("aria-label", "模型 API ID");
modelEntry.append(aliasInput, idLabel, modelIdInput);
modelManager.append(modelEntry);
const modelManagerFeedback = elem("p", "model-manager-feedback");
modelManagerFeedback.setAttribute("role", "status");
modelManager.append(modelManagerFeedback);
const providerModelsList = elem("div", "provider-models-list");
providerModelsList.setAttribute("role", "listbox");
providerModelsList.setAttribute("aria-label", "服务商模型列表");
modelManager.append(providerModelsList);
modelManager.append(
  elem(
    "p",
    "hint",
    "点击模型设为默认；编辑名称与 ID 后点击上方加号确认。保存服务商后生效。",
  ),
);
function resetModelEntry() {
  if (typeof editModelDetails === "function") editModelDetails();
  editingModelId = null;
  aliasInput.value = "";
  modelIdInput.value = "";
  addProviderModel.title = "添加模型";
  addProviderModel.setAttribute("aria-label", "添加模型");
  addProviderModel.replaceChildren(svgIcon("plus"));
}
function setDefaultProviderModel(id) {
  $("#model").value = id;
  settingsDirty = true;
  renderProviderModels();
  decorateModelNames();
}
function renderProviderModels() {
  providerModelsList.replaceChildren();
  for (const item of providerModelDraft) {
    const row = elem("div", "provider-model-item");
    row.setAttribute("role", "option");
    const active = $("#model").value === item.id;
    row.classList.toggle("active", active);
    row.setAttribute("aria-selected", String(active));
    const select = actionButton(
      "",
      () => setDefaultProviderModel(item.id),
      "provider-model-select",
    );
    select.append(
      modelLogo(item.id),
      elem("span", "provider-model-alias", item.name),
      elem("span", "provider-model-id", "(ID: " + item.id + ")"),
    );
    select.title = "设为默认：" + item.name;
    const edit = actionButton(
      "",
      () => {
        editingModelId = item.id;
        if (typeof editModelDetails === "function") editModelDetails(item);
        aliasInput.value = item.name;
        modelIdInput.value = item.id;
        addProviderModel.title = "确认修改";
        addProviderModel.setAttribute("aria-label", "确认模型修改");
        addProviderModel.replaceChildren(svgIcon("review"));
        aliasInput.focus();
      },
      "model-row-action",
    );
    edit.setAttribute("aria-label", "编辑模型 " + item.id);
    const pencil = svgIcon("note");
    pencil
      .querySelector("path")
      .setAttribute("d", "m4 17-1 4 4-1L20 7l-4-4L4 17Zm10-12 4 4");
    edit.append(pencil);
    const remove = actionButton(
      "",
      () => {
        providerModelDraft = providerModelDraft.filter((m) => m.id !== item.id);
        if ($("#model").value === item.id)
          $("#model").value = providerModelDraft[0]?.id || "";
        if (editingModelId === item.id) resetModelEntry();
        settingsDirty = true;
        renderProviderModels();
      },
      "model-row-action model-row-remove",
    );
    remove.setAttribute("aria-label", "删除模型 " + item.id);
    remove.append(svgIcon("close"));
    row.append(select, edit, remove);
    providerModelsList.append(row);
  }
  if (!providerModelDraft.length)
    providerModelsList.append(
      elem(
        "p",
        "model-list-empty",
        "暂无模型。输入名称与 ID 后点击 +，或从接口获取。",
      ),
    );
}
async function commitProviderModel() {
  const pendingId = modelIdInput.value.trim();
  if (pendingId && typeof fillModelEntry === "function") await fillModelEntry();
  if (pendingId !== modelIdInput.value.trim()) return;
  const id = modelIdInput.value.trim(),
    name = aliasInput.value.trim() || id;
  modelManagerFeedback.textContent = "";
  if (!id) {
    modelManagerFeedback.textContent = "请填写模型 ID。";
    modelIdInput.focus();
    return;
  }
  const details =
    typeof readModelDetails === "function" ? readModelDetails() : {};
  if (!details) return;
  if (providerModelDraft.some((m) => m.id === id && m.id !== editingModelId)) {
    modelManagerFeedback.textContent = "此模型 ID 已存在。";
    return;
  }
  if (editingModelId) {
    providerModelDraft = providerModelDraft.map((m) =>
      m.id === editingModelId ? { ...m, ...details, id, name } : m,
    );
    if ($("#model").value === editingModelId) $("#model").value = id;
  } else {
    if (providerModelDraft.length >= 500) {
      modelManagerFeedback.textContent = "最多保存 500 个模型";
      return;
    }
    providerModelDraft.push({ ...details, id, name });
    if (!$("#model").value) $("#model").value = id;
  }
  settingsDirty = true;
  resetModelEntry();
  renderProviderModels();
}
for (const input of [aliasInput, modelIdInput])
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitProviderModel();
    }
  });
async function fetchProviderModelList() {
  const context =
    typeof modelAutofillContext === "function" ? modelAutofillContext() : null;
  busyButton(fetchProviderModels, true, "获取中…");
  modelManagerFeedback.textContent = "";
  try {
    const result = await api("/api/settings/models", "POST", configForm());
    if (context && (context !== modelAutofillContext() || !providerDialog.open))
      return;
    for (const id of result.models) {
      if (
        !providerModelDraft.some((m) => m.id === id) &&
        providerModelDraft.length < 500
      )
        providerModelDraft.push({ id, name: id });
    }
    if (!$("#model").value && providerModelDraft[0])
      $("#model").value = providerModelDraft[0].id;
    if (typeof hydrateProviderModels === "function")
      await hydrateProviderModels();
    settingsDirty = true;
    renderProviderModels();
    modelManagerFeedback.textContent =
      "读取到 " +
      result.models.length +
      " 个模型，已有名称保留；保存服务商后生效。";
  } catch (e) {
    modelManagerFeedback.textContent = e.message;
  } finally {
    busyButton(fetchProviderModels, false);
  }
}
const previousManagerExpandProvider = expandProvider;
expandProvider = function (id, source, mode = id ? "edit" : "new") {
  previousManagerExpandProvider(id, source, mode);
  const config =
    mode === "default"
      ? state.settings
      : providerRows.find((p) => p.id === id) || {};
  providerModelDraft = (config.models || []).map((m) => ({ ...m }));
  if (config.model && !providerModelDraft.some((m) => m.id === config.model))
    providerModelDraft.push({ id: config.model, name: config.model });
  resetModelEntry();
  modelManagerFeedback.textContent = "";
  renderProviderModels();
};
const previousManagerConfigForm = configForm;
configForm = function () {
  return {
    ...previousManagerConfigForm(),
    models: providerModelDraft.map((m) => ({ ...m })),
  };
};
function selectedModelCatalog() {
  return (
    (
      providerRows.find((p) => p.id === $("#provider-select").value) ||
      state.settings
    ).models || []
  );
}
function friendlyModelName(id) {
  return selectedModelCatalog().find((m) => m.id === id)?.name || id;
}
const previousManagerSync = syncComposerControls;
syncComposerControls = function () {
  previousManagerSync();
  const id = chosenModel(),
    name = friendlyModelName(id);
  const label = $("#model-pill .model-name");
  if (label) label.textContent = name || "选择模型";
  reasoningModel.replaceChildren(
    modelLogo(id),
    elem("span", name ? "model-display-name" : "", name || "选择模型"),
    chevron(),
  );
  reasoningModel.title = id;
};
renderModelChoices = function () {
  modelList.replaceChildren();
  const config =
      providerRows.find((p) => p.id === $("#provider-select").value) ||
      state.settings,
    current = chosenModel(),
    query = search.value.trim().toLowerCase();
  const candidates = [
    ...new Set(
      [
        config.model,
        current,
        ...(config.models || []).map((m) => m.id),
        ...availableModels,
      ].filter(Boolean),
    ),
  ];
  const fallback = actionButton("", () => useModel(""), "model-choice");
  fallback.dataset.modelId = config.model || "";
  fallback.setAttribute("role", "option");
  fallback.setAttribute("aria-selected", String(!$("#runtime-model").value));
  const d = elem("span", "", "默认");
  d.append(
    elem("small", "", friendlyModelName(config.model) || "使用接口默认模型"),
  );
  fallback.append(
    modelLogo(config.model),
    d,
    elem("span", "checkmark", !$("#runtime-model").value ? "✓" : ""),
  );
  modelList.append(fallback);
  for (const id of candidates.filter((id) =>
    (id + " " + friendlyModelName(id)).toLowerCase().includes(query),
  )) {
    const button = actionButton("", () => useModel(id), "model-choice");
    button.dataset.modelId = id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(current === id));
    const label = elem("span", "model-display-name", friendlyModelName(id));
    if (friendlyModelName(id) !== id) label.append(elem("small", "", id));
    button.append(
      modelLogo(id),
      label,
      elem("span", "checkmark", current === id ? "✓" : ""),
    );
    modelList.append(button);
  }
  if (query && !candidates.some((id) => id.toLowerCase() === query)) {
    const custom = actionButton(
      "使用模型 ID：" + search.value.trim(),
      () => useModel(search.value.trim()),
      "model-choice custom-model",
    );
    custom.dataset.modelId = search.value.trim();
    custom.prepend(modelLogo(search.value));
    modelList.append(custom);
  }
};
syncComposerControls();
const previousManagerSaveProvider = saveProviderEditor;
saveProviderEditor = async function () {
  const context =
    typeof modelAutofillContext === "function" ? modelAutofillContext() : null;
  if (aliasInput.value.trim() || modelIdInput.value.trim()) {
    await commitProviderModel();
    if (aliasInput.value.trim() || modelIdInput.value.trim()) return;
  }
  if (typeof hydrateProviderModels === "function")
    await hydrateProviderModels();
  if (context && (context !== modelAutofillContext() || !providerDialog.open))
    return;
  await previousManagerSaveProvider();
};
$("#provider-save").onclick = saveProviderEditor;
$("#save-settings").onclick = (e) => {
  e.preventDefault();
  saveProviderEditor();
};
configFormElement.onsubmit = (e) => {
  e.preventDefault();
  saveProviderEditor();
};
