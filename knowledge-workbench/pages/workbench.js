import {DraftController} from '../core/draft-controller.js';
import {DB_NAME, DB_VERSION} from '../core/draft-db.js';

const MANIFEST_URL = 'https://raw.githubusercontent.com/lihuany635-create/lizhi-cloud-laptop-6s8a4kuk/knowledge-data/manifest.json';

export function mountKnowledgeWorkbench(panel) {
  if (panel.dataset.workbenchMounted) return;
  panel.dataset.workbenchMounted = 'true';
  panel.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">KNOWLEDGE WORKBENCH · LOCAL DRAFTS</div><h1>知識工作台</h1><p>先把正在整理的知識安全留在這台裝置。正式跨裝置送出尚未啟用。</p></div><div class="actions"><button class="button primary" data-kw="new">＋ 新增草稿</button></div></div>
    <section class="kw-status-grid">
      <div class="card"><small>本機保存</small><strong data-kw="save-status" role="status">尚未開啟草稿</strong><span data-kw="saved-at">—</span></div>
      <div class="card"><small>待正式送出</small><strong data-kw="outbox-count">0 筆</strong><span>僅存在此瀏覽器，沒有上傳</span></div>
      <div class="card"><small>目前連線</small><strong data-kw="connection">檢查中</strong><span>離線時仍可保存已載入的草稿</span></div>
    </section>
    <section class="kw-layout">
      <div class="section kw-drafts"><div class="section-head"><h2>本機草稿</h2><span class="count" data-kw="draft-count">0 份</span></div><div data-kw="draft-list" class="kw-draft-list"></div></div>
      <div class="section kw-editor"><div class="section-head"><h2>草稿內容</h2><span class="count" data-kw="draft-id">尚未選擇</span></div>
        <p class="kw-note">本機草稿不是跨裝置正式資料；編輯後會自動儲存在目前瀏覽器。</p>
        <div class="kw-fields">
          <label>標題<input data-kw="title" autocomplete="off" placeholder="輸入標題"></label>
          <label>資料夾路徑<input data-kw="folder" autocomplete="off" placeholder="例如：工程/工法"></label>
          <label>內容<textarea data-kw="body" rows="9" placeholder="記下你的想法、資料或施工經驗"></textarea></label>
          <label>標籤（逗號分隔）<input data-kw="tags" autocomplete="off" placeholder="例如：RC, 品質"></label>
          <label>圖片／附件暫存<input data-kw="attachment" type="file"></label>
          <ul data-kw="attachments" class="kw-attachments"></ul>
        </div>
        <div class="actions"><button class="button accent" data-kw="prepare">準備送出（只排隊）</button><button class="button danger" data-kw="delete">刪除草稿</button></div>
        <small data-kw="revision" class="kw-revision">—</small>
      </div>
    </section>
    <section class="section kw-future"><div class="section-head"><h2>正式資料與後續能力</h2></div><p>共用知識資料層已建立，但此階段沒有安全寫入服務。下列功能尚未啟用：</p><div class="meta"><span class="chip">正式送出 · 未啟用</span><span class="chip">模板 · 未啟用</span><span class="chip">關聯與搜尋 · 未啟用</span><span class="chip">Obsidian 備份 · 未啟用</span></div><div class="actions"><button class="button" data-kw="manifest">唯讀檢查共用資料層</button><span data-kw="manifest-status" class="kw-manifest-status">不影響本機草稿</span></div></section>`;

  const get = key => panel.querySelector(`[data-kw="${key}"]`);
  const inputKeys = ['title', 'folder', 'body', 'tags'];
  const controller = new DraftController({onState: renderState});
  controller.attachLifecycle();

  function fail(error) {
    get('save-status').textContent = `本機草稿儲存失敗：${error.message}`;
    get('save-status').classList.add('kw-error');
  }

  function renderConnection() { get('connection').textContent = navigator.onLine ? '線上' : '離線中'; }
  window.addEventListener('online', renderConnection);
  window.addEventListener('offline', renderConnection);
  renderConnection();

  function renderState({draft, status, error}) {
    get('save-status').textContent = error ? `本機草稿儲存失敗：${error.message}`
      : status === 'queued' ? '待正式送出（僅本機）'
      : status === 'saved' ? '本機草稿已儲存'
      : status === 'saving' ? '正在儲存本機草稿…'
      : status === 'unsaved' ? '有尚未儲存的本機修改…'
      : '尚未開啟草稿';
    get('save-status').classList.toggle('kw-error', Boolean(error));
    get('saved-at').textContent = draft?.lastLocalSavedAt ? `最後本機保存 ${new Date(draft.lastLocalSavedAt).toLocaleString('zh-TW')}` : '—';
    get('draft-id').textContent = draft ? `草稿 ${draft.draftId.slice(0, 8)}` : '尚未選擇';
    get('revision').textContent = draft ? `draftRevision ${draft.draftRevision} · ${draft.localState}` : '—';
    for (const key of [...inputKeys, 'attachment', 'prepare', 'delete']) get(key).disabled = !draft;
    if (status === 'saved' || status === 'queued') void renderList().catch(fail);
    void renderOutbox().catch(fail);
  }

  async function renderOutbox() {
    const jobs = await controller.outbox();
    get('outbox-count').textContent = `${jobs.filter(job => job.status === 'queued').length} 筆`;
  }

  async function renderList() {
    const drafts = await controller.list();
    const host = get('draft-list');
    host.replaceChildren();
    get('draft-count').textContent = `${drafts.length} 份`;
    for (const draft of drafts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `card kw-draft-card${controller.current?.draftId === draft.draftId ? ' active' : ''}`;
      const title = document.createElement('strong');
      title.textContent = draft.title || '未命名草稿';
      const detail = document.createElement('small');
      detail.textContent = `${draft.folderPath || '未分類'} · ${new Date(draft.updatedAt).toLocaleString('zh-TW')} · ${draft.localState === 'ready-to-send' ? '待正式送出' : '本機草稿'}`;
      button.append(title, detail);
      button.addEventListener('click', () => void open(draft.draftId).catch(fail));
      host.append(button);
    }
    if (!drafts.length) host.textContent = '還沒有草稿。按「新增草稿」開始。';
  }

  async function renderAttachments() {
    const host = get('attachments');
    host.replaceChildren();
    for (const item of await controller.attachments()) {
      const row = document.createElement('li');
      row.textContent = `${item.name} · ${item.size} bytes（僅本機）`;
      host.append(row);
    }
  }

  function fill(draft) {
    get('title').value = draft?.title || '';
    get('folder').value = draft?.folderPath || '';
    get('body').value = draft?.fields?.body || '';
    get('tags').value = (draft?.tags || []).join(', ');
  }

  function setDraftUrl(draftId) {
    const url = new URL(location.href);
    if (draftId) url.searchParams.set('draft', draftId);
    else url.searchParams.delete('draft');
    history.replaceState(null, '', url);
  }

  async function open(draftId) {
    const draft = await controller.open(draftId);
    setDraftUrl(draft.draftId);
    fill(draft);
    await renderAttachments();
    await renderList();
  }

  get('new').addEventListener('click', () => void (async () => {
    const draft = await controller.create();
    setDraftUrl(draft.draftId);
    fill(draft);
    await renderAttachments();
    await renderList();
  })().catch(fail));

  function updateFromForm() {
    controller.update({title: get('title').value, folderPath: get('folder').value,
      fields: {...controller.current.fields, body: get('body').value},
      tags: get('tags').value.split(',').map(tag => tag.trim()).filter(Boolean)});
  }
  for (const key of inputKeys) {
    get(key).addEventListener('input', updateFromForm);
    get(key).addEventListener('change', updateFromForm);
    get(key).addEventListener('blur', () => void controller.flush().catch(fail));
  }
  get('attachment').addEventListener('change', () => void (async () => {
    const file = get('attachment').files[0];
    if (!file) return;
    await controller.addAttachment(file);
    get('attachment').value = '';
    await renderAttachments();
    await renderList();
  })().catch(fail));
  get('prepare').addEventListener('click', () => void controller.prepareSend().then(renderList).catch(fail));
  get('delete').addEventListener('click', () => void (async () => {
    if (!confirm('確定刪除這份本機草稿、附件和待送出工作？')) return;
    await controller.removeCurrent();
    setDraftUrl(null);
    fill(null);
    await renderAttachments();
    await renderList();
  })().catch(fail));

  get('manifest').addEventListener('click', () => void (async () => {
    const status = get('manifest-status');
    status.textContent = '正在唯讀檢查…';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 7000);
    try {
      const response = await fetch(MANIFEST_URL, {signal: abort.signal, cache: 'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.dataModel !== 'lizhi-knowledge' || manifest.branch !== 'knowledge-data' || manifest.dataRevision !== 1) throw new Error('資料層版本不符');
      status.textContent = '共用資料層可唯讀存取 · revision 1；正式送出未啟用';
    } catch (error) {
      status.textContent = `目前無法讀取共用資料層（${error.message}）；本機草稿仍可使用`;
    } finally { clearTimeout(timer); }
  })());

  renderState({draft: null, status: 'idle', error: null});
  void (async () => {
    const draftId = new URLSearchParams(location.search).get('draft');
    if (draftId) await open(draftId);
    else await renderList();
    await renderOutbox();
  })().catch(fail);
  return controller;
}
