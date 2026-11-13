// Shared component contracts. Feature modules keep their values and event handlers.
function enhanceUiElement(element) {
  if (!(element instanceof Element)) return;
  const tag = element.tagName;
  if (element.closest(".markdown,.CodeMirror,.file-preview")) return;
  if (tag === "BUTTON") {
    const intrinsic = element.matches(
      ".token-cell,.asset-preview,.starter-card,[data-theme-choice],.material-choice,.skin-preview",
    );
    element.classList.toggle("ui-button", !intrinsic);
    const iconOnly =
      !element.textContent.trim() && !!element.querySelector("svg,img");
    element.classList.toggle(
      "ui-icon-button",
      !intrinsic && iconOnly && !element.matches(".rail-button,.model-pill"),
    );
    if (element.matches(".custom-select")) element.classList.add("ui-picker");
  }
  if (tag === "INPUT" && element.type === "checkbox") {
    element.classList.remove("ui-field");
    element.classList.add("ui-switch");
    element.setAttribute("role", "switch");
  } else if (element.matches("input,textarea,select")) {
    const excluded = element.matches(
      "#chat-input,[type=range],[type=color],[type=hidden],[type=radio],[type=submit],[type=button]",
    );
    element.classList.toggle("ui-field", !excluded);
  }
  if (
    tag === "LABEL" &&
    !element.matches(".switch-pill") &&
    element.querySelector(
      "input:not([type=checkbox]):not([type=range]):not([type=color]),textarea,select",
    )
  )
    element.classList.add("ui-field-group");
  if (tag === "SUMMARY") element.classList.add("ui-disclosure");
  if (tag === "DIALOG") element.classList.add("ui-dialog");
  if (element.matches(".settings-group")) element.classList.add("ui-section");
  if (element.matches(".preference-row"))
    element.classList.add("ui-setting-row");
}

(() => {
  const appMenus = [...appMenu.querySelectorAll(".app-menu")];
  const compactMenu = elem("details", "compact-app-menu");
  const compactTitle = elem("summary", "", "应用菜单");
  const compactList = elem("div", "compact-app-menu-list");
  compactMenu.append(compactTitle, compactList);
  appMenus[0].before(compactMenu);
  const compactChrome = matchMedia("(max-width:600px)");
  function syncAppMenus() {
    compactMenu.open = false;
    compactMenu.hidden = !compactChrome.matches;
    for (const menu of appMenus) {
      menu.open = false;
      if (compactChrome.matches) compactList.append(menu);
      else compactMenu.before(menu);
    }
    window.reportWindowChrome?.();
  }
  compactList.addEventListener("click", (event) => {
    if (event.target.closest("button")) compactMenu.open = false;
  });
  compactMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      compactMenu.open = false;
      compactTitle.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!compactMenu.contains(event.target)) compactMenu.open = false;
  });
  compactChrome.addEventListener("change", syncAppMenus);
  syncAppMenus();
  // Infrequent context maintenance belongs with the conversation's other options.
  composerOptionsPanel.append(compactButton);
  function registerTree(root) {
    enhanceUiElement(root);
    for (const element of root.querySelectorAll(
      "button,input,textarea,select,label,summary,dialog,.settings-group,.preference-row",
    ))
      enhanceUiElement(element);
  }
  registerTree(document.body);
  // Register added controls only. Streaming text does not cause a document rescan.
  new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.target instanceof Element &&
        record.target.matches("button,label")
      )
        enhanceUiElement(record.target);
      for (const node of record.addedNodes)
        if (node instanceof Element) registerTree(node);
    }
  }).observe(document.body, { childList: true, subtree: true });

  const layout = document.querySelector(".settings-layout");
  const content = layout.querySelector(".settings-content");
  const navigation = layout.querySelector(".settings-nav");
  navigation.id = "settings-navigation";
  const main = elem("div", "settings-main");
  const header = elem("header", "settings-page-header");
  const heading = elem("h1");
  heading.id = "settings-page-title";
  main.setAttribute("role", "region");
  main.setAttribute("aria-labelledby", heading.id);
  heading.tabIndex = -1;
  const categories = elem("button", "secondary settings-categories");
  categories.type = "button";
  categories.append(svgIcon("settings"), elem("span", "", "设置分类"));
  categories.setAttribute("aria-controls", navigation.id);
  const backdrop = elem("button", "settings-category-backdrop");
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "收起设置分类");
  backdrop.hidden = true;
  header.append(categories, heading);
  content.before(main);
  main.append(header, content);
  layout.append(backdrop);
  const narrow = matchMedia("(max-width:680px)");

  function showCategories(open, restoreFocus = false) {
    const expanded = narrow.matches && open;
    document.body.classList.toggle("settings-categories-open", expanded);
    backdrop.hidden = !expanded;
    navigation.inert = narrow.matches && !expanded;
    categories.setAttribute("aria-expanded", String(expanded));
    if (expanded)
      navigation
        .querySelector("[aria-current=page]")
        ?.focus({ preventScroll: true });
    else if (restoreFocus && narrow.matches)
      categories.focus({ preventScroll: true });
  }
  categories.onclick = () =>
    showCategories(
      !document.body.classList.contains("settings-categories-open"),
    );
  backdrop.onclick = () => showCategories(false, true);
  narrow.addEventListener("change", () => showCategories(false));
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        document.body.classList.contains("settings-categories-open")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showCategories(false, true);
      }
    },
    true,
  );
  navigation.addEventListener("keydown", (event) => {
    if (
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
      !event.target.matches("[data-settings-tab]")
    )
      return;
    const buttons = [
      ...navigation.querySelectorAll("[data-settings-tab]"),
    ].filter((button) => !button.hidden && !button.disabled);
    const current = buttons.indexOf(document.activeElement);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    event.preventDefault();
    buttons[index]?.focus();
  });
  function syncCategoryTabStops() {
    const buttons = [...navigation.querySelectorAll("[data-settings-tab]")];
    const visible = buttons.filter((button) => !button.hidden);
    const current =
      visible.find(
        (button) => button.getAttribute("aria-current") === "page",
      ) || visible[0];
    for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
  }
  settingsSearch.addEventListener("input", syncCategoryTabStops);
  settingsSearch.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigation.querySelector('[data-settings-tab][tabindex="0"]')?.focus();
    }
  });

  const selectCapabilityTab = selectIntegration;
  selectIntegration = function (id) {
    selectCapabilityTab(id);
    for (const [name, button] of Object.entries(integrationButtons))
      button.tabIndex = name === id ? 0 : -1;
  };
  integrationTabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...integrationTabs.querySelectorAll("[role=tab]")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
    event.preventDefault();
    buttons[next].click();
    buttons[next].focus();
  });
  selectIntegration(integrationCurrent);

  const selectCategory = selectSettingsTab;
  selectSettingsTab = function (name) {
    selectCategory(name);
    if (!document.querySelector("#settings").hidden)
      selectRail(
        { capabilities: "plugins", profile: "profile" }[name] || "settings",
      );
    const selected = navigation.querySelector(
      '[data-settings-tab="' + CSS.escape(name) + '"]',
    );
    heading.textContent = selected?.textContent.trim() || uiText("设置");
    syncCategoryTabStops();
    const panel = [...content.children].find(
      (node) => node.dataset.panel === name,
    );
    const duplicate = panel?.querySelector(
      ":scope > h2,:scope > .dialog-head h2",
    );
    if (duplicate && !duplicate.closest(".provider-host"))
      duplicate.classList.add("ui-sr-only");
    const closeMenu = document.body.classList.contains(
      "settings-categories-open",
    );
    showCategories(false);
    if (closeMenu) heading.focus({ preventScroll: true });
  };
  heading.textContent =
    navigation.querySelector("[aria-current=page]")?.textContent.trim() ||
    uiText("常规");
  showCategories(false);

  const oauthDisclosure = elem(
    "details",
    "settings-disclosure oauth-disclosure",
  );
  const oauthTitle = elem("summary");
  oauthTitle.append(elem("strong", "", "OpenAI · ChatGPT OAuth"), chevron());
  oauthGroup.before(oauthDisclosure);
  oauthDisclosure.append(oauthTitle, oauthGroup);
  oauthGroup.querySelector("h3").classList.add("ui-sr-only");

  // Keep one primary save action in the dialog command area.
  const footer = configFormElement.querySelector(".dialog-footer");
  const name = document.querySelector("#provider-name");
  const nameField = elem(
    "label",
    "provider-name-field ui-field-group",
    "服务商名称",
  );
  name.before(nameField);
  nameField.append(name);
  const save = document.querySelector("#provider-save");
  save.classList.remove("secondary");
  save.classList.add("primary");
  footer.prepend(document.querySelector("#provider-delete"));
  footer.append(save);
  const providerHeading = configFormElement.querySelector(".dialog-head");
  const providerBody = elem("div", "provider-dialog-body");
  for (const child of [...configFormElement.children]) {
    if (
      child !== providerHeading &&
      child !== footer &&
      !child.classList.contains("provider-close")
    )
      providerBody.append(child);
  }
  footer.before(providerBody);
  const developerSettings = [
    ...providerBody.querySelectorAll(":scope > .settings-disclosure"),
  ].at(-1);
  if (developerSettings)
    developerSettings.append(
      ...providerHost.querySelectorAll(":scope > .hint"),
    );
  configFormElement.querySelector(".provider-manager > label").hidden = true;
  configFormElement.querySelector(".provider-manager > .hint")?.remove();
  providerBody.querySelector(":scope > .dialog-intro")?.remove();
  document
    .querySelector("#base-url")
    .closest("label")
    .querySelector("span")
    ?.classList.add("ui-sr-only");
  const imageHint = imageProviderField.querySelector("small");
  const videoHint = providerCapabilities.nextElementSibling;
  function syncProviderHints() {
    imageHint.hidden = !capabilitySwitches.image.checked;
    videoHint.hidden = !capabilitySwitches.video.checked;
  }
  imageProviderType.addEventListener("change", syncProviderHints);
  providerCapabilities.addEventListener("change", syncProviderHints);
  const openProvider = expandProvider;
  expandProvider = function (id, source, mode) {
    openProvider(id, source, mode);
    syncProviderHints();
    providerBody.scrollTop = 0;
    if (providerMode === "default")
      document.querySelector("#base-url").focus({ preventScroll: true });
  };
})();
