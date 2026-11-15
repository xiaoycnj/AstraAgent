// Local editing buffers stay outside model requests until the user restores and saves them.
let editorDraftDatabase;
function openEditorDrafts() {
  if (!editorDraftDatabase)
    editorDraftDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open("astra-editor-drafts", 1);
      request.onupgradeneeded = () =>
        request.result
          .createObjectStore("drafts", { keyPath: "id" })
          .createIndex("target", "target");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error("Draft database is blocked"));
    });
  return editorDraftDatabase;
}
async function editorDraftOperation(mode, action) {
  const db = await openEditorDrafts();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", mode);
    const request = action(transaction.objectStore("drafts"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error || Error("Draft transaction aborted"));
  });
}
function attachEditorDraft(edit, status, target, base, apply) {
  const id = crypto.randomUUID();
  let timer,
    sequence = Promise.resolve(),
    restored;
  const queue = (action) => (sequence = sequence.catch(() => {}).then(action));
  edit.flush = () => {
    clearTimeout(timer);
    const content = edit.read(),
      dirty = JSON.stringify(content) !== edit.baseline;
    return queue(() =>
      editorDraftOperation("readwrite", (store) =>
        dirty
          ? store.put({ id, target, base, content, updated: Date.now() })
          : store.delete(id),
      ),
    ).then(() => {
      if (dirty && JSON.stringify(edit.read()) === JSON.stringify(content))
        status.textContent = "本地草稿已保存";
    });
  };
  const update = edit.update;
  edit.update = () => {
    update();
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        edit
          .flush()
          .then(() => {
            if (
              edit.element.isConnected &&
              JSON.stringify(edit.read()) !== edit.baseline
            )
              status.textContent = "本地草稿已保存";
          })
          .catch(() => {
            status.textContent = "本地草稿保存失败，请手动保存";
          }),
      350,
    );
  };
  const saved = edit.saved;
  edit.saved = async () => {
    saved();
    clearTimeout(timer);
    try {
      await queue(async () => {
        await editorDraftOperation("readwrite", (store) => store.delete(id));
        if (restored)
          await editorDraftOperation("readwrite", (store) =>
            store.delete(restored),
          );
      });
    } catch {
      status.textContent = "正文已保存，草稿清理失败";
    }
  };
  const recovery = elem("details", "creative-draft-recovery");
  recovery.append(elem("summary", "", "恢复本地草稿"));
  recovery.hidden = true;
  edit.element.append(recovery);
  editorDraftOperation("readonly", (store) =>
    store.index("target").getAll(target),
  )
    .then((rows) => {
      if (creativeEdit !== edit) return;
      for (const row of rows.sort((a, b) => b.updated - a.updated)) {
        const panel = elem("div", "story-editor");
        panel.append(
          elem(
            "p",
            "hint",
            row.base === base
              ? "发现未保存的本地草稿"
              : "草稿基于旧版本，请对照当前内容后恢复",
          ),
        );
        const preview = elem("textarea");
        preview.readOnly = true;
        preview.dataset.i18nIgnore = "";
        preview.setAttribute("aria-label", "草稿内容");
        preview.value =
          typeof row.content === "string"
            ? row.content
            : JSON.stringify(row.content, null, 2);
        panel.append(
          preview,
          studioAction(new Date(row.updated).toLocaleString(), async () => {
            if (!(await confirmCreativeLeave())) return;
            apply(row.content);
            restored = row.id;
            edit.update();
          }),
          studioAction("删除草稿", async () => {
            if (!(await appConfirm("删除这份本地草稿？"))) return;
            await editorDraftOperation("readwrite", (store) =>
              store.delete(row.id),
            );
            panel.remove();
            recovery.hidden = recovery.children.length === 1;
          }),
        );
        recovery.append(panel);
      }
      recovery.hidden = rows.length === 0;
    })
    .catch(() => {
      status.textContent = "本地草稿不可用，请手动保存";
    });
}
