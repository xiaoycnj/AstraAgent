// Independent creative workspaces reuse immutable attachments and normal chat permissions.
function studioField(label, control) {
  const wrapper = elem("label", "studio-field");
  wrapper.append(elem("span", "", label), control);
  if (control.tagName === "SELECT") buildSelect(control);
  return wrapper;
}
function studioSelect(items) {
  const select = elem("select");
  for (const [value, label] of items) {
    const option = elem("option", "", label);
    option.value = value;
    select.append(option);
  }
  return select;
}
function studioAction(label, action, kind = "secondary") {
  const button = actionButton(
    label,
    async () => {
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
    kind,
  );
  return button;
}
function studioLink(label, url, name) {
  const link = elem("a", "secondary", label);
  link.href = url;
  link.download = name || "";
  return link;
}
function studioLayout() {
  const layout = elem("div", "creative-layout");
  const list = elem("nav", "creative-list"),
    detail = elem("section", "creative-detail");
  list.setAttribute("aria-label", "项目列表");
  detail.setAttribute("aria-label", "项目详情");
  layout.append(list, detail);
  destinationBody.append(layout);
  return { list, detail };
}
async function renderCreatorPage() {
  const renderTicket = pageTicket;
  let openTicket = 0;
  destinationTitle.textContent = "作品工作台";
  const { list, detail } = studioLayout();
  destinationActions.append(
    studioAction("新建作品", async () => {
      if (!state.session) throw Error("请先新建或打开一个会话");
      const item = await api("/api/creations", "POST", {
        session_id: state.session.id,
        name: "index.html",
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>我的作品</title></head><body><h1>开始创作</h1></body></html>',
      });
      await refresh(item.id);
    }),
  );
  async function refresh(selected) {
    const result = await api("/api/creations");
    if (appPage !== "creator" || pageTicket !== renderTicket) return;
    list.replaceChildren();
    for (const item of result) {
      const button = studioAction(
        item.title,
        () => open(item.id),
        "creative-item",
      );
      button.dataset.i18nIgnore = "";
      button.append(
        elem(
          "small",
          "",
          item.versions.length +
            " · " +
            new Date(item.updated * 1000).toLocaleString(),
        ),
      );
      list.append(button);
    }
    if (selected || result[0]) await open(selected || result[0].id);
    else
      detail.replaceChildren(
        elem("p", "hint", "生成的文件与图片会自动保留作品版本。"),
      );
  }
  async function open(id) {
    const opening = ++openTicket;
    const item = await api("/api/creations/" + id);
    if (
      appPage !== "creator" ||
      opening !== openTicket ||
      pageTicket !== renderTicket
    )
      return;
    detail.replaceChildren(elem("h2", "", item.title));
    detail.querySelector("h2").dataset.i18nIgnore = "";
    const versions = studioSelect(
      item.versions.map((v, index) => [
        v.id,
        "V" +
          (item.versions.length - index) +
          " · " +
          new Date(v.created * 1000).toLocaleString(),
      ]),
    );
    const controls = elem("div", "creative-controls"),
      content = elem("div", "creative-preview");
    controls.append(studioField("版本", versions));
    detail.append(controls, content);
    async function showVersion() {
      const version = item.versions.find((v) => v.id === versions.value);
      content.replaceChildren();
      const url = "/api/attachments/" + version.attachment_id + "/content";
      controls.querySelectorAll("a,button").forEach((node) => node.remove());
      controls.append(
        studioLink("下载文件", url, version.attachment.name),
        studioLink(
          "导出资源包",
          "/api/creations/" + id + "/bundle?version=" + version.id,
          "Astra-creation.zip",
        ),
      );
      if (version.id !== item.head)
        controls.append(
          studioAction("恢复此版本", async () => {
            await api("/api/creations/" + id, "PUT", {
              expected_head: item.head,
              restore_version: version.id,
            });
            await refresh(id);
          }),
        );
      if (version.attachment.kind === "image") {
        const compare = elem("div", "creative-compare");
        const prior = studioSelect(
          item.versions.map((v, index) => [
            v.id,
            "V" + (item.versions.length - index),
          ]),
        );
        prior.value =
          item.versions.find((v) => v.id !== version.id)?.id || version.id;
        const left = elem("img"),
          right = elem("img");
        left.alt = "对比版本";
        right.alt = "当前版本";
        right.src = url;
        prior.onchange = () => {
          left.src =
            "/api/attachments/" +
            item.versions.find((v) => v.id === prior.value).attachment_id +
            "/content";
        };
        prior.onchange();
        content.append(studioField("对比版本", prior));
        compare.append(left, right);
        content.append(compare);
        content.append(
          studioAction("绘制编辑蒙版", () =>
            paintImageMask(item, version, content),
          ),
        );
        return;
      }
      const result = await api(
        "/api/creations/" + id + "/content?version=" + version.id,
      );
      if (versions.value !== version.id || appPage !== "creator") return;
      const frame = elem("iframe", "creative-frame");
      frame.title = "静态作品预览";
      frame.setAttribute("sandbox", "");
      frame.referrerPolicy = "no-referrer";
      frame.srcdoc = result.html;
      const editor = elem("textarea", "creative-editor");
      editor.value = result.content;
      editor.spellcheck = false;
      editor.setAttribute("aria-label", "作品源文件");
      editor.dataset.i18nIgnore = "";
      const source = elem("details");
      source.append(
        elem("summary", "", "编辑源文件"),
        editor,
        studioAction("保存新版本", async () => {
          await api("/api/creations/" + id, "PUT", {
            expected_head: item.head,
            content: editor.value,
          });
          await refresh(id);
        }),
      );
      const report = elem("div", "creative-report");
      report.setAttribute("role", "status");
      const assets = elem("details");
      assets.append(elem("summary", "", "关联资源附件"));
      const resources = await api(
        "/api/sessions/" + item.session_id + "/resources",
      );
      if (
        versions.value !== version.id ||
        opening !== openTicket ||
        pageTicket !== renderTicket
      )
        return;
      const selectedAssets = new Set(version.metadata.assets || []),
        picks = elem("div", "creative-controls");
      for (const asset of [...resources.sources, ...resources.outputs].filter(
        (asset, index, array) =>
          asset.id !== version.attachment_id &&
          array.findIndex((row) => row.id === asset.id) === index,
      )) {
        const pick = studioAction(asset.name, () => {
          selectedAssets.has(asset.id)
            ? selectedAssets.delete(asset.id)
            : selectedAssets.add(asset.id);
          pick.setAttribute(
            "aria-pressed",
            String(selectedAssets.has(asset.id)),
          );
        });
        pick.dataset.i18nIgnore = "";
        pick.setAttribute("aria-pressed", String(selectedAssets.has(asset.id)));
        picks.append(pick);
      }
      assets.append(
        elem(
          "p",
          "hint",
          "选择同目录的 CSS 和图片，可在预览中加载，并随资源包导出。",
        ),
        picks,
        studioAction("保存资源关联", async () => {
          await api("/api/creations/" + id, "PUT", {
            expected_head: item.head,
            assets: [...selectedAssets],
          });
          await refresh(id);
        }),
      );
      const width = studioSelect([
        [390, "390 px"],
        [768, "768 px"],
        [1440, "1440 px"],
        [1920, "1920 px"],
      ]);
      width.value = "1440";
      controls.append(
        studioField("预览宽度", width),
        studioAction("浏览器检查与 PDF", async () => {
          report.replaceChildren(elem("p", "hint", "正在渲染作品…"));
          try {
            const check = await api("/api/creations/" + id + "/check", "POST", {
              version_id: version.id,
              width: Number(width.value),
              pdf: true,
            });
            report.replaceChildren(
              elem(
                "p",
                "",
                check.report.horizontal_overflow
                  ? "检测到横向溢出"
                  : "布局宽度检查通过",
              ),
            );
            for (const output of check.outputs)
              report.append(
                studioLink(
                  output.name,
                  "/api/attachments/" + output.id + "/content",
                  output.name,
                ),
              );
          } catch (error) {
            report.replaceChildren(elem("p", "hint", error.message));
          }
        }),
      );
      content.append(
        elem(
          "p",
          "hint",
          "静态预览会移除活动内容并禁用网络。交互行为需单独验证。",
        ),
        frame,
        source,
        assets,
        report,
      );
    }
    versions.onchange = () =>
      showVersion().catch((error) => toast(error.message));
    await showVersion();
  }
  await refresh();
}
async function paintImageMask(creation, version, container) {
  const image = new Image();
  image.src = "/api/attachments/" + version.attachment_id + "/content";
  await image.decode();
  if (image.naturalWidth * image.naturalHeight > 16777216)
    throw Error("蒙版编辑最多支持 1600 万像素");
  const panel = elem("section", "story-editor"),
    canvas = elem("canvas", "mask-canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.setAttribute("aria-label", "拖动画笔标记需要重绘的区域");
  const overlay = canvas.getContext("2d"),
    mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const context = mask.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, mask.width, mask.height);
  const brush = elem("input");
  brush.type = "range";
  brush.min = "5";
  brush.max = "200";
  brush.value = "40";
  // Paint the selection in a separate transparent overlay, keep source pixels immutable.
  const marks = document.createElement("canvas");
  marks.width = canvas.width;
  marks.height = canvas.height;
  const strokes = marks.getContext("2d");
  function draw() {
    overlay.clearRect(0, 0, canvas.width, canvas.height);
    overlay.drawImage(image, 0, 0);
    overlay.drawImage(marks, 0, 0);
  }
  let last = null,
    painted = false;
  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * canvas.width) / bounds.width,
      y: ((event.clientY - bounds.top) * canvas.height) / bounds.height,
    };
  }
  function paint(event) {
    const current = point(event);
    for (const [ctx, mode, color] of [
      [context, "destination-out", "black"],
      [strokes, "source-over", "rgba(126,102,239,.5)"],
    ]) {
      ctx.globalCompositeOperation = mode;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth =
        (Number(brush.value) * canvas.width) /
        canvas.getBoundingClientRect().width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo((last || current).x, (last || current).y);
      ctx.lineTo(current.x, current.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(current.x, current.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    last = current;
    painted = true;
    draw();
  }
  canvas.onpointerdown = (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    last = null;
    paint(event);
  };
  canvas.onpointermove = (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) paint(event);
  };
  canvas.onpointerup = (event) => {
    canvas.releasePointerCapture(event.pointerId);
    last = null;
  };
  canvas.onpointercancel = () => {
    last = null;
  };
  draw();
  panel.append(
    elem(
      "p",
      "hint",
      "涂抹需要重新生成的区域。准备后将图片、蒙版和提示词放入当前会话，发送时按权限调用图片服务。",
    ),
    studioField("画笔大小", brush),
    canvas,
  );
  const actions = elem("div", "creative-controls");
  actions.append(
    studioAction("清空蒙版", () => {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "white";
      context.fillRect(0, 0, mask.width, mask.height);
      strokes.clearRect(0, 0, marks.width, marks.height);
      painted = false;
      draw();
    }),
    studioAction(
      "准备编辑请求",
      async () => {
        if (!painted) throw Error("请先涂抹编辑范围");
        if (
          submitting ||
          uploadBusy ||
          state.session?.id !== creation.session_id
        )
          throw Error("请先打开作品所属会话并等待当前任务完成");
        if (pendingAttachments.length > 4)
          throw Error("请先移除部分待发送附件");
        const source = document.createElement("canvas");
        source.width = canvas.width;
        source.height = canvas.height;
        source.getContext("2d").drawImage(image, 0, 0);
        const data = source.toDataURL("image/png").split(",")[1],
          maskData = mask.toDataURL("image/png").split(",")[1];
        if (data.length + maskData.length > 13_000_000)
          throw Error("编辑附件总计超过限制，请使用较小图片");
        const converted = await api("/api/creations/" + creation.id, "PUT", {
          expected_head: creation.head,
          source_version: version.id,
          image_data: data,
        });
        const updated = await api("/api/creations/" + creation.id);
        const sourceVersion = updated.versions.find(
          (v) => v.id === converted.version,
        );
        const maskItem = await api("/api/attachments", "POST", {
          name: "edit-mask.png",
          data: maskData,
        });
        pendingAttachments.push(sourceVersion.attachment, maskItem);
        renderAttachmentTray();
        if (!runtimePlugins.includes("image-generation"))
          runtimePlugins.push("image-generation");
        syncPluginChips();
        await navigatePage("home");
        const input = $("#chat-input");
        input.value =
          (input.value.trim() ? input.value.trim() + "\n\n" : "") +
          "请使用支持蒙版编辑的图片模型进行局部重绘。参考图 file=" +
          sourceVersion.attachment_id +
          "，蒙版 mask=" +
          maskItem.id +
          "。透明区域为编辑范围，其余内容尽量保留。我的修改要求：";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      },
      "primary",
    ),
  );
  panel.append(actions);
  container.append(panel);
}
async function renderStoryPage() {
  const renderTicket = pageTicket;
  let openTicket = 0;
  destinationTitle.textContent = "写作项目";
  const { list, detail } = studioLayout();
  const create = elem("form", "creative-controls"),
    name = elem("input");
  name.placeholder = "项目名称";
  name.required = true;
  name.maxLength = 100;
  name.setAttribute("aria-label", "项目名称");
  const submit = elem("button", "primary", "创建项目");
  submit.type = "submit";
  create.append(name, submit);
  destinationActions.append(create);
  create.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const item = await api("/api/stories", "POST", { title: name.value });
      name.value = "";
      await refresh(item.id);
    } catch (error) {
      toast(error.message);
    }
  };
  async function refresh(selected) {
    const result = await api("/api/stories");
    if (appPage !== "story" || pageTicket !== renderTicket) return;
    list.replaceChildren();
    for (const item of result) {
      const button = studioAction(
        item.title,
        () => open(item.id),
        "creative-item",
      );
      button.dataset.i18nIgnore = "";
      list.append(button);
    }
    if (selected || result[0]) await open(selected || result[0].id);
    else
      detail.replaceChildren(
        elem("p", "hint", "将章节、人物和时间线保存在一个项目中。"),
      );
  }
  async function open(id) {
    const opening = ++openTicket;
    const project = await api("/api/stories/" + id);
    if (
      appPage !== "story" ||
      opening !== openTicket ||
      pageTicket !== renderTicket
    )
      return;
    detail.replaceChildren(elem("h2", "", project.title));
    detail.querySelector("h2").dataset.i18nIgnore = "";
    const actions = elem("div", "creative-controls");
    actions.append(
      studioAction("绑定当前会话", async () => {
        if (!state.session) throw Error("请先新建或打开一个会话");
        await api("/api/sessions/" + state.session.id, "PATCH", {
          story_id: id,
        });
        state.session.story_id = id;
        toast("已绑定写作项目");
      }),
      studioAction("解除当前绑定", async () => {
        if (!state.session) throw Error("请先新建或打开一个会话");
        await api("/api/sessions/" + state.session.id, "PATCH", {
          story_id: "",
        });
        state.session.story_id = "";
        toast("已解除绑定");
      }),
    );
    for (const format of ["md", "epub", "docx"])
      actions.append(
        studioLink(
          format.toUpperCase(),
          "/api/stories/" + id + "/export/" + format,
          "Story." + format,
        ),
      );
    detail.append(
      actions,
      elem(
        "p",
        "hint",
        "绑定会话后，已确认的设定与最近章节会发给所选模型。草稿和假设可单独查询。",
      ),
    );
    const entries = elem("div", "creative-controls"),
      editor = elem("form", "story-editor");
    entries.append(studioAction("新建条目", () => edit(null)));
    for (const entry of project.entries) {
      const button = studioAction(entry.title, () => edit(entry));
      button.dataset.i18nIgnore = "";
      entries.append(button);
    }
    detail.append(entries, editor);
    function edit(entry) {
      editor.replaceChildren();
      editor.dataset.revision = String(entry?.revision || 0);
      const title = elem("input");
      title.value = entry?.title || "";
      title.required = true;
      title.maxLength = 200;
      const kind = studioSelect([
        ["chapter", "章节"],
        ["outline", "大纲"],
        ["character", "人物"],
        ["location", "地点"],
        ["timeline", "时间线"],
        ["note", "笔记"],
      ]);
      kind.value = entry?.kind || "chapter";
      const status = studioSelect([
        ["draft", "草稿"],
        ["confirmed", "已确认"],
        ["assumption", "假设"],
      ]);
      status.value = entry?.state || "draft";
      const position = elem("input");
      position.type = "number";
      position.min = "0";
      position.max = "100000";
      position.value = entry?.position ?? project.entries.length;
      const text = elem("textarea", "creative-editor");
      text.value = entry?.content || "";
      text.dataset.i18nIgnore = "";
      text.setAttribute("aria-label", "正文");
      const fields = elem("div", "creative-controls");
      fields.append(
        studioField("标题", title),
        studioField("类型", kind),
        studioField("状态", status),
        studioField("顺序", position),
      );
      const save = elem("button", "primary", "保存条目");
      save.type = "submit";
      editor.append(fields, text, save);
      editor.onsubmit = async (event) => {
        event.preventDefault();
        try {
          await api("/api/stories/" + id + "/entries", "PUT", {
            id: entry?.id,
            expected_revision: entry?.revision,
            title: title.value,
            kind: kind.value,
            state: status.value,
            position: Number(position.value),
            content: text.value,
          });
          await open(id);
        } catch (error) {
          toast(error.message);
        }
      };
      if (entry)
        editor.append(
          studioAction("历史版本", async () => {
            const result = await api(
              "/api/stories/" + id + "/history/" + entry.id,
            );
            const history = elem("div", "creative-controls");
            for (const version of result)
              history.append(
                studioAction("V" + version.revision, () => {
                  title.value = version.snapshot.title;
                  kind.value = version.snapshot.kind;
                  status.value = version.snapshot.state;
                  kind._refresh?.();
                  status._refresh?.();
                  position.value = version.snapshot.position;
                  text.value = version.snapshot.content;
                  toast("已载入历史版本，保存后创建新修订");
                }),
              );
            editor.append(history);
          }),
        );
    }
    edit(project.entries[0] || null);
  }
  await refresh();
}
async function renderSchedulePage() {
  const renderTicket = pageTicket;
  destinationTitle.textContent = "定时任务";
  destinationBody.append(
    elem(
      "p",
      "hint",
      "应用运行且电脑唤醒时执行。每次使用当前服务商凭证与权限，可能产生模型费用。重启后结果不确定的任务会暂停。",
    ),
  );
  destinationActions.append(
    studioAction("任务验收", async () => {
      await navigatePage("home");
      openWorkbench("evaluations");
    }),
  );
  destinationActions.append(
    studioAction("刷新", () =>
      navigatePage("schedule", { historyMode: "none" }),
    ),
  );
  const catalog = await api("/api/evaluations");
  if (appPage !== "schedule" || pageTicket !== renderTicket) return;
  const form = elem("form", "story-editor"),
    name = elem("input");
  name.required = true;
  name.maxLength = 100;
  const cases = studioSelect(catalog.cases.map((item) => [item.id, item.name]));
  const kind = studioSelect([
    ["interval", "间隔执行"],
    ["daily", "每日执行"],
    ["once", "单次执行"],
  ]);
  const interval = elem("input");
  interval.type = "number";
  interval.min = "60";
  interval.value = "3600";
  const daily = elem("input");
  daily.type = "time";
  daily.value = "09:00";
  const once = elem("input");
  once.type = "datetime-local";
  const missed = studioSelect([
    ["skip", "跳过错过的触发"],
    ["run_once", "补执行一次"],
  ]);
  const enabled = elem("input");
  enabled.type = "checkbox";
  const toggle = elem("label", "switch-pill");
  toggle.append(elem("span", "", "启用自动执行"), enabled);
  upgradeSwitches(toggle);
  const fields = elem("div", "creative-controls");
  const period = studioField("间隔（秒）", interval),
    clock = studioField("本机时间", daily),
    date = studioField("执行时间", once);
  function updateKind() {
    period.hidden = kind.value !== "interval";
    clock.hidden = kind.value !== "daily";
    date.hidden = kind.value !== "once";
  }
  kind.onchange = updateKind;
  updateKind();
  fields.append(
    studioField("任务名称", name),
    studioField("已保存任务", cases),
    studioField("触发方式", kind),
    period,
    clock,
    date,
    studioField("错过触发时", missed),
    toggle,
  );
  const save = elem("button", "primary", "保存定时任务");
  save.type = "submit";
  form.append(fields, save);
  destinationBody.append(form);
  let editing = null;
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      if (!cases.value) throw Error("请先在任务验收中保存一个任务");
      if (
        enabled.checked &&
        !(await appConfirm(
          "启用后将按计划调用模型并产生费用。工具仍受当前权限控制，是否启用？",
        ))
      )
        return;
      await api("/api/schedules", "PUT", {
        id: editing?.id,
        name: name.value,
        case_id: cases.value,
        kind: kind.value,
        interval_seconds: Number(interval.value),
        daily_time: daily.value,
        next_due: new Date(once.value).getTime() / 1000,
        missed: missed.value,
        enabled: enabled.checked,
        options: editing?.options || runtimeOptions(),
      });
      await navigatePage("schedule", { historyMode: "none" });
    } catch (error) {
      toast(error.message);
    }
  };
  const jobs = await api("/api/schedules");
  if (appPage !== "schedule" || pageTicket !== renderTicket) return;
  for (const job of jobs) {
    const card = elem("article", "settings-group");
    card.append(
      elem("h2", "", job.name),
      elem(
        "p",
        "hint",
        (job.enabled ? "运行计划已启用" : "计划已暂停") +
          " · " +
          new Date(job.next_due * 1000).toLocaleString(),
      ),
    );
    card.querySelector("h2").dataset.i18nIgnore = "";
    if (job.error) card.append(elem("p", "hint", job.error));
    const controls = elem("div", "creative-controls");
    if (job.enabled)
      controls.append(
        studioAction("暂停后续触发", async () => {
          await api("/api/schedules/" + job.id, "PATCH", { enabled: false });
          await navigatePage("schedule", { historyMode: "none" });
        }),
      );
    controls.append(
      studioAction("编辑计划", () => {
        editing = job;
        name.value = job.name;
        cases.value = job.case_id;
        kind.value = job.kind;
        interval.value = job.interval_seconds;
        daily.value = job.daily_time;
        missed.value = job.missed;
        const due = new Date(job.next_due * 1000);
        once.value = new Date(due.getTime() - due.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        for (const select of [cases, kind, missed]) select._refresh?.();
        enabled.checked = job.enabled;
        updateKind();
        name.focus();
        form.scrollIntoView({ block: "nearest" });
      }),
      studioAction("删除计划", async () => {
        if (
          await appConfirm(
            "删除此定时计划及触发历史？已创建会话仍可在会话栏查看。",
          )
        ) {
          await api("/api/schedules/" + job.id, "DELETE");
          await navigatePage("schedule", { historyMode: "none" });
        }
      }),
    );
    card.append(controls);
    const runs = elem("details");
    runs.append(elem("summary", "", "触发历史"));
    for (const run of job.runs) {
      const row = elem("div", "creative-controls");
      row.append(
        elem(
          "span",
          "",
          new Date(run.scheduled_for * 1000).toLocaleString() +
            " · " +
            ({
              running: "运行中",
              dispatching: "正在派发",
              complete: "已完成",
              done: "已完成",
              error: "失败",
              failed: "失败",
              interrupted: "已中断",
              cancelled: "已取消",
              needs_review: "等待复核",
              skipped: "已跳过",
            }[run.status] || run.status),
        ),
        elem("span", "hint", run.detail),
      );
      if (run.session_id)
        row.append(
          studioAction("打开任务会话", async () => {
            await navigatePage("home");
            await refreshList();
            await openSession(
              state.sessions.find((item) => item.id === run.session_id) || {
                id: run.session_id,
                title: job.name,
              },
            );
          }),
        );
      runs.append(row);
    }
    card.append(runs);
    destinationBody.append(card);
  }
}
for (const [page, label, icon] of [
  ["creator", "作品工作台", "review"],
  ["story", "写作项目", "library"],
]) {
  const button = studioAction(
    "",
    async () => {
      closeRailMenu();
      await navigatePage(page);
    },
    "rail-menu-item",
  );
  button.setAttribute("role", "menuitem");
  button.append(railIcon(icon), elem("span", "", label));
  railMenu.append(button);
}
