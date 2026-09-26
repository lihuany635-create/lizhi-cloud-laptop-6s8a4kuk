import {DraftController} from '../core/draft-controller.js';

const $ = selector => document.querySelector(selector);
const fields = ['#title', '#folder-path', '#body', '#tags'];
const controller = new DraftController({onState: renderStatus});
controller.attachLifecycle();

function report(error) {
  $('#save-status').textContent = `本機草稿儲存失敗：${error.message}`;
  $('#save-status').classList.add('error');
}

function renderStatus({draft, status, error}) {
  const message = error ? `本機草稿儲存失敗：${error.message}`
    : status === 'queued' ? '待正式送出（僅本機，尚未上傳）'
    : status === 'saved' ? `本機草稿已儲存 ${new Date(draft.lastLocalSavedAt).toLocaleTimeString()}`
    : status === 'saving' ? '正在儲存本機草稿…'
    : status === 'unsaved' ? '有尚未儲存的本機修改…'
    : '尚未開啟草稿';
  $('#save-status').textContent = message;
  $('#save-status').classList.toggle('error', Boolean(error));
  $('#draft-meta').textContent = `draftId：${draft?.draftId || '—'} · revision：${draft?.draftRevision || '—'} · lastLocalSavedAt：${draft?.lastLocalSavedAt || '—'}`;
  for (const selector of [...fields, '#attachment', '#prepare-send', '#delete-draft']) $(selector).disabled = !draft;
  void refreshCounts().catch(report);
}

async function refreshCounts() {
  const jobs = await controller.outbox();
  $('#outbox-count').textContent = `待正式送出：${jobs.filter(job => job.status === 'queued').length} 筆（僅本機）`;
}

async function renderList() {
  const host = $('#draft-list');
  host.replaceChildren();
  for (const draft of await controller.list()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-item';
    button.textContent = `${draft.title || '未命名草稿'} · rev ${draft.draftRevision} · ${draft.localState}`;
    button.addEventListener('click', () => void open(draft.draftId).catch(report));
    host.append(button);
  }
  if (!host.children.length) host.textContent = '目前沒有本機草稿。';
}

async function renderAttachments() {
  const host = $('#attachment-list');
  host.replaceChildren();
  for (const item of await controller.attachments()) {
    const row = document.createElement('li');
    row.textContent = `${item.name}（${item.size} bytes；blobId ${item.blobId}）`;
    host.append(row);
  }
}

function fillForm(draft) {
  $('#title').value = draft?.title || '';
  $('#folder-path').value = draft?.folderPath || '';
  $('#body').value = draft?.fields?.body || '';
  $('#tags').value = (draft?.tags || []).join(', ');
}

async function open(draftId) {
  const draft = await controller.open(draftId);
  history.replaceState(null, '', `?draft=${encodeURIComponent(draft.draftId)}`);
  fillForm(draft);
  await renderAttachments();
  await renderList();
}

$('#new-draft').addEventListener('click', () => void (async () => {
  const draft = await controller.create();
  history.replaceState(null, '', `?draft=${encodeURIComponent(draft.draftId)}`);
  fillForm(draft);
  await renderAttachments();
  await renderList();
})().catch(report));

function updateFromForm() {
  controller.update({
    title: $('#title').value,
    folderPath: $('#folder-path').value,
    fields: {...controller.current.fields, body: $('#body').value},
    tags: $('#tags').value.split(',').map(tag => tag.trim()).filter(Boolean),
  });
}
for (const selector of fields) {
  $(selector).addEventListener('input', updateFromForm);
  $(selector).addEventListener('change', updateFromForm);
  $(selector).addEventListener('blur', () => void controller.flush().then(renderList).catch(report));
}

$('#attachment').addEventListener('change', () => void (async () => {
  const file = $('#attachment').files[0];
  if (!file) return;
  await controller.addAttachment(file);
  $('#attachment').value = '';
  await renderAttachments();
  await renderList();
})().catch(report));

$('#prepare-send').addEventListener('click', () => void controller.prepareSend().then(async () => { await renderList(); await refreshCounts(); }).catch(report));
$('#delete-draft').addEventListener('click', () => void (async () => {
  if (!confirm('確定刪除這份本機草稿、附件和待送出工作？')) return;
  await controller.removeCurrent();
  history.replaceState(null, '', location.pathname);
  fillForm(null);
  await renderAttachments();
  await renderList();
})().catch(report));

function renderOnline() { $('#connection').textContent = navigator.onLine ? '目前：線上' : '目前：離線中'; }
window.addEventListener('online', renderOnline);
window.addEventListener('offline', renderOnline);
renderOnline();
renderStatus({draft: null, status: 'idle', error: null});
void (async () => {
  const draftId = new URLSearchParams(location.search).get('draft');
  if (draftId) await open(draftId);
  else await renderList();
  await refreshCounts();
})().catch(report);
