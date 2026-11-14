// Task-facing layout owns disclosure and placement, while feature handlers keep state.
(() => {
  function disclosure(title, ...sections) {
    const details = elem("details", "settings-disclosure workspace-disclosure");
    const summary = elem("summary");
    summary.append(elem("strong", "", title), chevron());
    const body = elem("div", "disclosure-content");
    body.append(...sections);
    details.append(summary, body);
    return details;
  }

  // One permission choice invokes the original policy actions and confirmations.
  const policyChoice = elem("select");
  policyChoice.id = "access-policy-choice";
  policyChoice.setAttribute("aria-label", "权限模式");
  for (const [value, title] of Object.entries(policyNames))
    policyChoice.append(new Option(title, value));
  const policyRow = elem("div", "preference-row");
  const policyText = elem("div");
  const policyDescription = elem("p");
  policyText.append(elem("h3", "", "工具与文件访问"), policyDescription);
  policyRow.append(policyText, policyChoice);
  policyGrid.before(policyRow);
  policyGrid.hidden = true;
  buildSelect(policyChoice);
  policyChoice.onchange = async () => {
    policyChoice.disabled = true;
    policyChoice._refresh?.();
    try {
      const button = [...policyGrid.children].find(
        (item) => item.dataset.policy === policyChoice.value,
      );
      await button?.onclick();
    } finally {
      policyChoice.disabled = false;
      renderExecutionSettings();
      policyChoice._refresh?.();
    }
  };
  const renderPolicy = renderExecutionSettings;
  renderExecutionSettings = function () {
    renderPolicy();
    policyChoice.value = executionSettings.access_policy;
    policyDescription.textContent = uiText(
      policyDescriptions[executionSettings.access_policy] || "",
    );
    policyChoice._refresh?.();
  };
  renderExecutionSettings();
  const policyExplanation = permissionsGroup.querySelector(":scope > p");
  if (policyExplanation)
    permissionsGroup.append(disclosure("权限说明", policyExplanation));
  const workspaceInfo = [...generalPanel.children].find(
    (section) => section.querySelector("h3")?.textContent === "工作空间",
  );
  if (workspaceInfo) storagePanel.append(workspaceInfo);
  const advancedExecution = disclosure(
    "高级执行与安全",
    executionGroup,
    engineGroup,
    securityAuditGroup,
  );
  generalPanel.append(advancedExecution);
  generalPanel.prepend(languageSection, permissionsGroup);

  generalPanel.querySelector(":scope > .dialog-intro")?.remove();
  capabilitiesPanel.querySelector(":scope > p")?.remove();
  const languageHelp = languageSection.querySelector(":scope > p");
  const languageButtons = [
    ...languageActions.querySelectorAll("button"),
  ].filter((button) => !button.classList.contains("custom-select"));
  languageSection.append(
    disclosure(
      "管理语言包",
      ...[languageHelp, ...languageButtons].filter(Boolean),
    ),
  );

  const appearance = document.querySelector("[data-panel=appearance]");
  appearance.querySelector(".reading-preview")?.remove();
  appearance.append(
    disclosure("高级外观", colorSection, glassSettings, materialGroup),
  );
  const statistics = disclosure("使用统计", profileStats, usageSection);
  profilePanel.append(statistics);

  // The provider list is the first decision. Optional account and routing setup follow it.
  const routing = providerHost.querySelector(".routing-disclosure");
  const oauth = providerHost.querySelector(".oauth-disclosure");
  if (oauth) providerHost.append(oauth);
  if (routing) providerHost.append(routing);
  const advancedProvider = providerDialog.querySelector(
    ".provider-dialog-body > .settings-disclosure",
  );
  if (advancedProvider) advancedProvider.append(providerCapabilities);

  // Management operations have a single menu, adjacent to the capability search.
  const manage = elem("details", "integration-manage");
  const manageTitle = elem("summary");
  manageTitle.append(svgIcon("more"));
  manageTitle.setAttribute("aria-label", "管理扩展");
  const manageActions = elem("div", "integration-manage-actions");
  const actions = [...integrationBar.children].filter(
    (node) => node.tagName === "BUTTON",
  );
  const marketAction = [
    ...pluginSection.querySelectorAll(":scope > button"),
  ].find((node) => node.textContent.includes("浏览扩展市场"));
  if (marketAction) actions.push(marketAction);
  manageActions.append(...actions);
  manage.append(manageTitle, manageActions);
  integrationBar.append(manage);
  manageActions.addEventListener("click", (event) => {
    if (event.target.closest("button")) manage.open = false;
  });
  manage.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      manage.open = false;
      manageTitle.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!manage.contains(event.target)) manage.open = false;
  });
  const skillForm = disclosure("创建或编辑技能", skillEditor);
  integrationPanes.skills.append(skillForm);
  integrationSkills.addEventListener(
    "click",
    (event) => {
      if (event.target.closest("button")) skillForm.open = true;
    },
    true,
  );
  const mcpEditor = disclosure("添加或编辑 MCP 服务", mcpForm);
  integrationPanes.mcp.append(mcpEditor);
  mcpCards.addEventListener(
    "click",
    (event) => {
      if (event.target.closest("button")) mcpEditor.open = true;
    },
    true,
  );

  // Task history remains available beside the other session operations.
  activityToggle.classList.remove("header-icon", "ui-icon-button");
  activityToggle.classList.add("conversation-menu-item");
  activityToggle.setAttribute("role", "menuitem");
  activityToggle.append(elem("span", "", "任务与产物"));
  activityToggle.addEventListener("click", closeHeaderMenu);
  headerMenu.append(activityToggle);
})();
