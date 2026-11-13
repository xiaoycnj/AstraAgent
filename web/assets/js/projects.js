// A session owns its project binding. Project files and shell share that root.
let projectCatalog = [];
let selectedProjectId = state.session?.project_id || '';
let previewedChanges = null;
const projectLabels = {passed: '验证通过', failed: '验证未通过', unverified: '待验收'};
const projectButton = actionButton('打开项目', showProjectManager, 'secondary project-open');
projectButton.id = 'project-open';
$('.header-actions').prepend(projectButton);
const cancelTaskButton = actionButton('停止任务', cancelProjectTask, 'secondary danger-text');
cancelTaskButton.id = 'cancel-task';
cancelTaskButton.hidden = true;
$('.composer-tools').append(cancelTaskButton);
approvalActions.prepend(actionButton('停止整个任务', async () => {
    await cancelProjectTask();
    rejectApproval.click();
}, 'secondary danger-text'));

const previousProjectOptions = runtimeOptions;
runtimeOptions = function () {
    return {...previousProjectOptions(), project_id: selectedProjectId};
};
const previousProjectApi = api;
api = function (path, method = 'GET', data) {
    if (selectedProjectId && (path === '/api/workspace/files' || path.startsWith('/api/workspace/files?'))) {
        const url=new URL(path,location.origin);url.searchParams.set('project_id',selectedProjectId);path=url.pathname+url.search;
    }
    if (['/api/workspace/file', '/api/terminal'].includes(path)) {
        data = {...data, project_id: selectedProjectId};
    }
    return previousProjectApi(path, method, data);
};

function currentProject() {
    return projectCatalog.find(project => project.id === selectedProjectId);
}
function updateProjectControls() {
    const project = currentProject();
    const label = projectButton.querySelector('span') || projectButton;
    label.textContent = project ? project.name : '打开项目';
    projectButton.title = project?.path || '选择真实项目目录';
    cancelTaskButton.hidden = !state.pending.has(state.session?.id);
    projectRoot.textContent = project?.path || '未绑定项目 · 使用应用工作区';
}
async function refreshProjects() {
    projectCatalog = await api('/api/projects');
    updateProjectControls();
}
async function bindProject(identifier) {
    if (state.pending.has(state.session?.id)) throw new Error('请先停止当前任务');
    if (!await confirmEditorChange()) return false;
    if (!state.session) await previousProjectNewSession();
    if (state.session) {
        await api('/api/sessions/' + state.session.id, 'PATCH', {project_id: identifier});
        state.session.project_id = identifier;
    }
    if (terminalId) await stopShell();
    selectedProjectId = identifier;
    clearProjectEditor();
    updateProjectControls();
    await refreshList();
    return true;
}
function clearProjectEditor() {
    filePath.value = '';
    openedPath = '';
    editorRevision = null;
    editor.setValue('');
    editorDirty = false;
    editorStatus.textContent = '选择项目文件';
    previewedChanges = null;
    if (!drawer.hidden) loadWorkspaceFiles().catch(error => toast(error.message));
}
const previousProjectOpenSession = openSession;
openSession = async function (session) {
    const projectId = session.project_id || '';
    if (projectId !== selectedProjectId && !await confirmEditorChange()) return;
    if (projectId !== selectedProjectId && terminalId) await stopShell();
    if (projectId !== selectedProjectId) {
        selectedProjectId = projectId;
        clearProjectEditor();
    }
    await previousProjectOpenSession(session);
    updateProjectControls();
};
const previousProjectNewSession = newSession;
newSession = async function () {
    if (!await confirmEditorChange()) return state.session;
    editorDirty = false;
    const identifier = selectedProjectId;
    const session = await previousProjectNewSession();
    if (identifier) await bindProject(identifier);
    return session;
};

async function cancelProjectTask() {
    const sid = state.session?.id;
    let key = streamKeys.get(sid);
    if (!key && sid) key = (await api('/api/sessions/' + sid + '/stream'))?.id;
    if (!key) return;
    const result = await api('/api/stream/' + key + '/cancel', 'POST', {});
    document.dispatchEvent(new CustomEvent('astra:task-cancel-request', {detail: {sid, ...result}}));
    toast(result.accepted ? '正在停止任务，保留已有文件和输出' : '任务已经结束');
    return result;
}

// Project setup stays small. Each check uses explicit argv to preserve quoting.
const projectDialog = elem('dialog', 'project-dialog');
projectDialog.id = 'project-dialog';
const projectDialogHead = elem('header', 'project-dialog-head');
projectDialogHead.append(elem('h2', '', '项目工作区'), actionButton('关闭', () => projectDialog.close(), 'secondary'));
const projectChooser = elem('select');
projectChooser.id = 'project-selector';
projectChooser.setAttribute('aria-label', '选择项目');
const projectChooserRow = elem('div', 'project-row');
projectChooserRow.append(projectChooser,
    actionButton('进入项目', async () => {
        if (await bindProject(projectChooser.value)) {
            projectDialog.close();
            openWorkbench('files');
        }
    }),
    actionButton('新建配置', () => editProject(null), 'secondary'));
const projectForm = elem('form', 'project-form');
let editingProjectId = '';
function projectField(label, input) {
    const field = elem('label', 'project-field', label);
    field.append(input);
    return field;
}
const projectName = elem('input');
projectName.id = 'project-name';
projectName.required = true;
projectName.maxLength = 100;
const projectPath = elem('input');
projectPath.id = 'project-path';
projectPath.required = true;
projectPath.placeholder = '项目绝对路径';
const projectPathRow = elem('div', 'project-row');
projectPathRow.append(projectPath, actionButton('选择文件夹', async () => {
    if (!window.pywebview?.api?.choose_project) {
        toast('浏览器模式请填写绝对路径');
        projectPath.focus();
        return;
    }
    const path = await window.pywebview.api.choose_project();
    if (path) {
        projectPath.value = path;
        if (!projectName.value) projectName.value = path.split(/[\\/]/).filter(Boolean).at(-1);
    }
}, 'secondary'));
const projectInstructions = elem('textarea');
projectInstructions.id = 'project-instructions';
projectInstructions.rows = 3;
projectInstructions.maxLength = 12000;
projectInstructions.placeholder = '项目约定。根目录 AGENTS.md 会一同注入。';
const checkRows = elem('div', 'project-checks');
function addCheckRow(check = {}) {
    const row = elem('div', 'project-check-row');
    const name = elem('input');
    name.placeholder = '验证名称';
    name.value = check.name || '';
    name.setAttribute('aria-label', '验证名称');
    const argv = elem('input');
    argv.placeholder = '["py", "-3", "-m", "unittest"]';
    argv.value = check.argv ? JSON.stringify(check.argv) : '';
    argv.setAttribute('aria-label', '命令 argv 数组');
    row.append(name, argv, actionButton('移除', () => row.remove(), 'secondary'));
    checkRows.append(row);
}
const projectFeedback = elem('p', 'hint');
projectFeedback.setAttribute('role', 'status');
const saveProject = elem('button', 'primary', '保存项目配置');
saveProject.type = 'submit';
projectForm.append(projectField('项目名称', projectName), projectField('项目目录', projectPathRow),
    projectField('项目指令', projectInstructions), elem('h3', '', '验收命令'),
    elem('p', 'hint', '使用 JSON 参数数组。任务结束时按访问权限执行，也可手动运行。'),
    checkRows, actionButton('添加验证命令', () => addCheckRow(), 'secondary'),
    elem('p', 'hint', '检查点包含文本与二进制文件，跳过依赖、构建产物和链接目录。上限 10,000 文件、单文件 10 MB、合计 100 MB。'),
    projectFeedback, saveProject);
projectDialog.append(projectDialogHead, projectChooserRow, projectForm);
document.body.append(projectDialog);
projectDialog.addEventListener('close', () => {
    closeSelect();
    document.body.append(selectMenu);
});
buildSelect(projectChooser);
projectChooser.onchange = () => editProject(projectCatalog.find(project => project.id === projectChooser.value));
function editProject(project) {
    editingProjectId = project?.id || '';
    projectName.value = project?.name || '';
    projectPath.value = project?.path || '';
    projectInstructions.value = project?.instructions || '';
    checkRows.replaceChildren();
    for (const check of project?.checks || []) addCheckRow(check);
    projectFeedback.textContent = '';
}
async function showProjectManager() {
    await refreshProjects();
    projectChooser.replaceChildren(new Option('应用工作区', ''), ...projectCatalog.map(project => new Option(project.name, project.id)));
    projectChooser.value = selectedProjectId;
    projectChooser._refresh();
    editProject(currentProject());
    projectDialog.showModal();
    projectDialog.append(selectMenu);
}
projectForm.onsubmit = async event => {
    event.preventDefault();
    saveProject.disabled = true;
    try {
        const checks = [...checkRows.children].map(row => ({
            name: row.children[0].value.trim(),
            argv: JSON.parse(row.children[1].value)
        }));
        const project = await api('/api/projects', 'PUT', {
            id: editingProjectId, name: projectName.value.trim(), path: projectPath.value.trim(),
            instructions: projectInstructions.value, checks
        });
        await refreshProjects();
        if (await bindProject(project.id)) {
            projectDialog.close();
            openWorkbench('files');
            toast('项目已连接');
        }
    } catch (error) {
        projectFeedback.textContent = error.message;
    } finally {
        saveProject.disabled = false;
    }
};

// Reuse the editor drawer for checkpoint review and real verification evidence.
const projectView = elem('section', 'workspace-pane project-pane');
projectView.id = 'project-review';
projectView.hidden = true;
const projectRoot = elem('p', 'project-root');
projectRoot.id = 'project-root';
const projectActions = elem('div', 'project-row');
const checkpointChooser = elem('select');
checkpointChooser.setAttribute('aria-label', '比较检查点');
const diffButton = actionButton('查看差异', showProjectDiff, 'secondary');
const rollbackButton = actionButton('回退到此检查点', rollbackProject, 'secondary danger-text');
rollbackButton.disabled = true;
projectActions.append(checkpointChooser, diffButton, rollbackButton);
const projectEvidence = elem('div', 'project-evidence');
const projectHistory = elem('div', 'project-history');
const projectReviewActions = elem('div', 'project-row');
projectReviewActions.append(actionButton('刷新记录', refreshProjectReview, 'secondary'),
    actionButton('保存检查点', async () => {
        await requireProject();
        await api('/api/projects/' + selectedProjectId + '/checkpoint', 'POST', {label: '手动检查点'});
        await refreshProjectReview();
    }, 'secondary'),
    actionButton('运行验收命令', async () => {
        await requireProject();
        const checks = currentProject().checks;
        if (!checks.length) {toast('请先在项目配置中添加验收命令'); return;}
        if (!await appConfirm('在项目目录执行以下命令？\n' + checks.map(check => JSON.stringify(check.argv)).join('\n'))) return;
        projectEvidence.textContent = '正在运行验收命令…';
        try {
            const result = await api('/api/projects/' + selectedProjectId + '/verify', 'POST', runtimeOptions());
            renderProjectVerification(result);
            await refreshProjectHistory();
        } catch (error) {projectEvidence.textContent = error.message;}
    }));
projectView.append(projectRoot, projectReviewActions, projectActions, projectEvidence, projectHistory);
drawer.append(projectView);
const projectTab = actionButton('变更与验收', () => openWorkbench('project'), 'secondary');
projectTab.dataset.tab = 'project';
drawerTabs.append(projectTab);
buildSelect(checkpointChooser);
const previousProjectWorkbench = openWorkbench;
openWorkbench = function (tab = 'files') {
    previousProjectWorkbench(tab);
    projectView.hidden = tab !== 'project';
    updateProjectControls();
    if (tab === 'project') refreshProjectReview().catch(error => toast(error.message));
};
async function requireProject() {
    if (!currentProject()) throw new Error('请先打开项目');
    return currentProject();
}
async function refreshProjectHistory() {
    await requireProject();
    const identifier = selectedProjectId;
    const history = await api('/api/projects/' + identifier + '/history');
    if (identifier !== selectedProjectId) throw new Error('项目已切换，请重新加载记录');
    const previous = checkpointChooser.value;
    checkpointChooser.replaceChildren(...history.checkpoints.map(point => new Option(
        point.label + ' · ' + new Date(point.created).toLocaleString(), point.id)));
    if (history.checkpoints.some(point => point.id === previous)) checkpointChooser.value = previous;
    checkpointChooser._refresh();
    projectHistory.replaceChildren(elem('h3', '', '验收记录'));
    for (const verification of history.verifications) {
        const row = actionButton(projectLabels[verification.verdict] + ' · ' + new Date(verification.created).toLocaleString(),
            () => renderProjectVerification(verification), 'secondary');
        projectHistory.append(row);
    }
    for (const operation of history.rollbacks) {
        projectHistory.append(elem('p', 'hint', '回退记录 · ' + operation.status +
            ' · 保护检查点 ' + operation.undo_id.slice(0, 8) + (operation.error ? ' · ' + operation.error : '')));
    }
    return history;
}
async function refreshProjectReview() {
    previewedChanges = null;
    rollbackButton.disabled = true;
    updateProjectControls();
    if (!currentProject()) {
        projectEvidence.textContent = '打开项目后，可在这里查看检查点、文件差异和验收记录。';
        return;
    }
    const history = await refreshProjectHistory();
    if (history.checkpoints.length) await showProjectDiff();
    else projectEvidence.textContent = '第一次任务或编辑器保存前会自动创建检查点。';
}
checkpointChooser.onchange = () => {previewedChanges = null; rollbackButton.disabled = true;};
async function showProjectDiff() {
    await requireProject();
    if (!checkpointChooser.value) return;
    const projectId = selectedProjectId;
    const result = await api('/api/projects/' + projectId + '/diff', 'POST', {checkpoint_id: checkpointChooser.value});
    if (projectId !== selectedProjectId) return;
    previewedChanges = {...result, project_id: projectId};
    rollbackButton.disabled = !result.changes.length;
    projectEvidence.replaceChildren(elem('h3', '', result.changes.length + ' 个文件变更'));
    projectEvidence.append(elem('p', 'hint', '比较当前项目和所选检查点，包含期间所有文件变更。'));
    for (const change of result.changes) {
        const details = elem('details', 'project-change');
        const summary = elem('summary', '', ({added:'新增',deleted:'删除',modified:'修改'}[change.kind]) + ' · ' + change.path);
        const pre = elem('pre', 'project-diff', change.diff || (change.binary ? '二进制文件已变化' : '内容或权限已变化，文件过大时省略文本预览'));
        details.append(summary, pre);
        if (change.kind !== 'deleted' && !change.binary) {
            details.append(actionButton('在编辑器打开', async () => {
                openWorkbench('files');
                await openWorkspaceFile(change.path);
            }, 'secondary'));
        }
        projectEvidence.append(details);
    }
}
async function rollbackProject() {
    const preview = previewedChanges;
    if (!preview || preview.project_id !== selectedProjectId) return;
    if (!await confirmEditorChange()) return;
    if (!await appConfirm('将这些文件恢复到所选检查点？新增文件将移除，回退前会保存保护检查点。\n共 ' + preview.changes.length + ' 个文件')) return;
    rollbackButton.disabled = true;
    try {
        await api('/api/projects/' + selectedProjectId + '/rollback', 'POST', {
            checkpoint_id: preview.checkpoint_id, revision: preview.revision
        });
        clearProjectEditor();
        await refreshProjectReview();
        toast('已回退，可选择保护检查点恢复');
    } catch (error) {
        previewedChanges = null;
        projectEvidence.textContent = error.message + '。请刷新差异。';
    }
}
function renderProjectVerification(result) {
    rollbackButton.disabled = true;
    projectEvidence.replaceChildren(elem('h3', '', projectLabels[result.verdict] || result.verdict),
        elem('p', 'hint', '结果对应运行时文件版本 ' + result.revision.slice(0, 12) + '。后续修改需重新验证。'));
    for (const check of result.results) {
        const details = elem('details', 'project-change');
        details.open = true;
        details.append(elem('summary', '', check.name + ' · 退出码 ' + String(check.exit_code ?? '未执行')),
            elem('pre', 'project-diff', JSON.stringify(check.argv) + '\n' + (check.output || check.error || '')));
        projectEvidence.append(details);
    }
}
const previousProjectSummary = executionSummary;
executionSummary = function (run) {
    const summary = previousProjectSummary(run);
    const done = run.events.findLast(event => event.type === 'done');
    return done?.verdict ? summary + ' · ' + projectLabels[done.verdict] : summary;
};
const previousProjectEvent = handleAgentEvent;
handleAgentEvent = function (sid, event) {
    previousProjectEvent(sid, event);
    if (sid === state.session?.id && ['done', 'cancelled', 'project_changes', 'verification'].includes(event.type)) {
        if (!projectView.hidden) refreshProjectReview().catch(error => toast(error.message));
    }
};
const previousProjectRender = renderMessages;
renderMessages = function () {
    previousProjectRender();
    updateProjectControls();
};
setInterval(updateProjectControls, 500);
refreshProjects().catch(error => toast(error.message));
