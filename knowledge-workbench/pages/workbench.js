import {DraftController} from '../core/draft-controller.js';
import {DB_NAME, DB_VERSION} from '../core/draft-db.js';
import {ensureFolder, ensureFoldersFromDrafts, getFolderTree, describeFolderPath} from '../core/folder-catalog-store.js';
import {getAncestorPaths, getFolderLookupKey, validateFolderPath} from '../core/folder-model.js';

const MANIFEST_URL = 'https://raw.githubusercontent.com/lihuany635-create/lizhi-cloud-laptop-6s8a4kuk/knowledge-data/manifest.json';

export function mountKnowledgeWorkbench(panel) {
  if (panel.dataset.workbenchMounted) return;
  panel.dataset.workbenchMounted = 'true';
  panel.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">KNOWLEDGE WORKBENCH · LOCAL DRAFTS</div><h1>知識工作台</h1><p>先選知識位置，再把正在整理的內容安全留在這台裝置。正式跨裝置送出尚未啟用。</p></div><div class="actions"><button class="button primary" data-kw="new">＋ 新增知識</button></div></div>
    <section class="kw-status-grid">
      <div class="card"><small>本機保存</small><strong data-kw="save-status" role="status">尚未開啟草稿</strong><span data-kw="saved-at">—</span></div>
      <div class="card"><small>待正式送出</small><strong data-kw="outbox-count">0 筆</strong><span>僅存在此瀏覽器，沒有上傳</span></div>
      <div class="card"><small>目前連線</small><strong data-kw="connection">檢查中</strong><span>離線時仍可保存已載入的草稿</span></div>
    </section>
    <section class="kw-layout">
      <div class="section kw-drafts"><div class="section-head"><h2>資料夾</h2></div><div data-kw="folder-browser" class="kw-folder-tree"></div><p data-kw="browse-crumb" class="kw-folder-crumb">全部知識</p><p data-kw="folder-warnings" class="kw-folder-warning" hidden></p><div class="section-head"><h2>本機草稿</h2><span class="count" data-kw="draft-count">0 份</span></div><div data-kw="draft-list" class="kw-draft-list"></div></div>
      <div class="section kw-editor"><div class="section-head"><h2>草稿內容</h2><span class="count" data-kw="draft-id">尚未選擇</span></div>
        <p class="kw-note">本機草稿不是跨裝置正式資料；編輯後會自動儲存在目前瀏覽器。</p>
        <div class="kw-fields">
          <label>標題<input data-kw="title" autocomplete="off" placeholder="輸入標題"></label>
          <div class="kw-location"><span>儲存位置</span><button class="button" type="button" data-kw="choose-folder">選擇儲存位置</button><small data-kw="folder-crumb">尚未選擇</small></div>
          <label>內容<textarea data-kw="body" rows="9" placeholder="記下你的想法、資料或施工經驗"></textarea></label>
          <label>標籤（逗號分隔）<input data-kw="tags" autocomplete="off" placeholder="例如：RC, 品質"></label>
          <label>圖片／附件暫存<input data-kw="attachment" type="file"></label>
          <ul data-kw="attachments" class="kw-attachments"></ul>
        </div>
        <div class="actions"><button class="button accent" data-kw="prepare">準備送出（只排隊）</button><button class="button danger" data-kw="delete">刪除草稿</button></div>
        <small data-kw="revision" class="kw-revision">—</small>
      </div>
    </section>
    <section class="section kw-future"><div class="section-head"><h2>正式資料與後續能力</h2></div><p>共用知識資料層已建立，但此階段沒有安全寫入服務。下列功能尚未啟用：</p><div class="meta"><span class="chip">正式送出 · 未啟用</span><span class="chip">模板 · 未啟用</span><span class="chip">關聯與搜尋 · 未啟用</span><span class="chip">Obsidian 備份 · 未啟用</span></div><div class="actions"><button class="button" data-kw="manifest">唯讀檢查共用資料層</button><span data-kw="manifest-status" class="kw-manifest-status">不影響本機草稿</span></div></section>
    <dialog class="kw-folder-dialog" data-kw="folder-dialog"><div class="kw-folder-dialog-body"><div class="section-head"><h2>選擇知識位置</h2><button class="button" type="button" data-kw="folder-cancel">關閉</button></div><p class="kw-note">選擇根目錄或資料夾。這只決定本機草稿的位置，尚未跨裝置同步。</p><div data-kw="picker-tree" class="kw-folder-tree"></div><p data-kw="picker-crumb" class="kw-folder-crumb">全部知識 &gt; 根目錄</p><label class="kw-create-folder">在目前位置新增資料夾<input data-kw="folder-name" placeholder="例如：工程/RC/施工問題"></label><button class="button" type="button" data-kw="folder-create">＋ 新增資料夾</button><p data-kw="folder-error" class="kw-folder-error" role="alert"></p><div class="actions"><button class="button primary" type="button" data-kw="folder-confirm">選用此位置</button></div></div></dialog>`;

  const get = key => panel.querySelector(`[data-kw="${key}"]`);
  const inputKeys = ['title', 'body', 'tags'];
  const controller = new DraftController({onState: renderState});
  controller.attachLifecycle();
  let browsePath = '';
  let pickerPath = '';
  let creating = false;
  const expanded = new Set(['']);

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
    get('choose-folder').disabled = !draft;
    if (status === 'saved' || status === 'queued') void renderList().catch(fail);
    void renderOutbox().catch(fail);
  }

  async function renderOutbox() {
    const jobs = await controller.outbox();
    get('outbox-count').textContent = `${jobs.filter(job => job.status === 'queued').length} 筆`;
  }

  async function renderList() {
    const drafts = await controller.list();
    const visible = browsePath ? drafts.filter(draft => {
      const key = getFolderLookupKey(draft.folderPath || '');
      const selected = getFolderLookupKey(browsePath);
      return key === selected || key.startsWith(`${selected}/`);
    }) : drafts;
    const host = get('draft-list');
    host.replaceChildren();
    get('draft-count').textContent = `${visible.length} 份`;
    for (const draft of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `card kw-draft-card${controller.current?.draftId === draft.draftId ? ' active' : ''}`;
      const title = document.createElement('strong');
      title.textContent = draft.title || '未命名草稿';
      const detail = document.createElement('small');
      const location = validateFolderPath(draft.folderPath || '').valid ? describeFolderPath(draft.folderPath || '') : '位置待修正';
      detail.textContent = `${location} · ${new Date(draft.updatedAt).toLocaleString('zh-TW')} · ${draft.localState === 'ready-to-send' ? '待正式送出' : '本機草稿'}`;
      button.append(title, detail);
      button.addEventListener('click', () => void open(draft.draftId).catch(fail));
      host.append(button);
    }
    if (!visible.length) host.textContent = browsePath ? '此資料夾及子資料夾還沒有草稿。' : '還沒有草稿。按「新增知識」開始。';
  }

  function expandPath(path) { for (const ancestor of getAncestorPaths(path)) expanded.add(ancestor); }

  function appendFolderNode(host, node, depth, selected, onSelect) {
    const row = document.createElement('div');
    row.className = 'kw-folder-row';
    row.style.setProperty('--kw-depth', String(depth));
    if (node.children.length) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'kw-folder-toggle';
      toggle.textContent = expanded.has(node.path) ? '▾' : '▸';
      toggle.setAttribute('aria-label', `${expanded.has(node.path) ? '收合' : '展開'} ${node.name}`);
      toggle.addEventListener('click', () => { expanded.has(node.path) ? expanded.delete(node.path) : expanded.add(node.path); void renderFolders().catch(fail); });
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'kw-folder-spacer';
      row.append(spacer);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `kw-folder-item${getFolderLookupKey(node.path) === getFolderLookupKey(selected) ? ' active' : ''}`;
    button.textContent = node.path ? `📁 ${node.name}` : '全部知識';
    button.addEventListener('click', () => onSelect(node.path));
    row.append(button);
    host.append(row);
    if (expanded.has(node.path)) for (const child of node.children) appendFolderNode(host, child, depth + 1, selected, onSelect);
  }

  async function renderFolders() {
    const tree = await getFolderTree();
    const browser = get('folder-browser');
    const picker = get('picker-tree');
    browser.replaceChildren();
    picker.replaceChildren();
    appendFolderNode(browser, tree, 0, browsePath, path => { browsePath = path; get('browse-crumb').textContent = describeFolderPath(path); void renderFolders().then(renderList).catch(fail); });
    appendFolderNode(picker, tree, 0, pickerPath, path => { pickerPath = path; get('picker-crumb').textContent = describeFolderPath(path); void renderFolders().catch(fail); });
    get('browse-crumb').textContent = describeFolderPath(browsePath);
    get('picker-crumb').textContent = describeFolderPath(pickerPath);
  }

  function showFolderDialog(forNew) {
    creating = forNew;
    const currentPath = controller.current?.folderPath || '';
    pickerPath = forNew || !validateFolderPath(currentPath).valid ? '' : currentPath;
    expandPath(pickerPath);
    get('folder-name').value = '';
    get('folder-error').textContent = '';
    void renderFolders().then(() => get('folder-dialog').showModal()).catch(fail);
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
    const path = draft?.folderPath || '';
    const valid = validateFolderPath(path).valid;
    get('choose-folder').textContent = !draft ? '選擇儲存位置' : valid ? (path ? '變更資料夾' : '根目錄 · 變更位置') : '修正資料夾位置';
    get('folder-crumb').textContent = !draft ? '尚未選擇' : valid ? describeFolderPath(path) : '位置待修正；請重新選擇資料夾';
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
    if (validateFolderPath(draft.folderPath || '').valid) expandPath(draft.folderPath || '');
    setDraftUrl(draft.draftId);
    fill(draft);
    await renderAttachments();
    await renderFolders();
    await renderList();
  }

  get('new').addEventListener('click', () => showFolderDialog(true));
  get('choose-folder').addEventListener('click', () => showFolderDialog(false));
  get('folder-cancel').addEventListener('click', () => get('folder-dialog').close());
  get('folder-create').addEventListener('click', () => void (async () => {
    const name = get('folder-name').value;
    const check = validateFolderPath(name);
    if (!name || !check.valid) { get('folder-error').textContent = name ? check.error : '請輸入資料夾名稱'; return; }
    const path = pickerPath ? `${pickerPath}/${name}` : name;
    const result = await ensureFolder(path);
    pickerPath = result.path;
    expandPath(pickerPath);
    get('folder-name').value = '';
    get('folder-error').textContent = result.added ? '資料夾已新增，請選用此位置。' : '資料夾已存在，已為你選取。';
    await renderFolders();
  })().catch(error => { get('folder-error').textContent = error.message; }));
  get('folder-confirm').addEventListener('click', () => void (async () => {
    if (creating) {
      const draft = await controller.create();
      controller.update({folderPath: pickerPath});
      await controller.flush();
      setDraftUrl(draft.draftId);
    } else {
      controller.update({folderPath: pickerPath});
      await controller.flush();
    }
    get('folder-dialog').close();
    fill(controller.current);
    await renderAttachments();
    await renderFolders();
    await renderList();
    if (creating) get('title').focus();
  })().catch(fail));

  function updateFromForm() {
    controller.update({title: get('title').value,
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
    const bootstrap = await ensureFoldersFromDrafts(await controller.list());
    if (bootstrap.warnings.length) {
      get('folder-warnings').hidden = false;
      get('folder-warnings').textContent = `${bootstrap.warnings.length} 份舊草稿的位置不符合資料夾規則；草稿內容未變動，開啟後可重新選擇位置。`;
    }
    await renderFolders();
    const draftId = new URLSearchParams(location.search).get('draft');
    if (draftId) await open(draftId);
    else await renderList();
    await renderOutbox();
  })().catch(fail);
  return controller;
}
