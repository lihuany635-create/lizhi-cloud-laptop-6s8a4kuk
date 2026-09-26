import {getBlob} from '../core/blob-store.js';
import {getFolderTree, describeFolderPath} from '../core/folder-catalog-store.js';
import {getFolderLookupKey} from '../core/folder-model.js';
import {isHttpUrl, putRelation} from '../core/resource-model.js';

export function mountResourcePanel(host, controller) {
  host.innerHTML = `
    <div class="section-head"><h2>相關資料</h2><span class="count">僅本機保存</span></div>
    <div class="kw-resource-grid">
      <section class="kw-resource-group"><h3>圖片</h3><label class="kw-file-label">＋ 加入圖片<input data-kw="image" type="file" accept="image/*" multiple></label><p data-kw="images-error" class="kw-resource-error" role="alert"></p><div data-kw="images" class="kw-image-list"></div></section>
      <section class="kw-resource-group"><h3>附件</h3><label class="kw-file-label">＋ 加入附件<input data-kw="attachment" type="file" multiple></label><p data-kw="attachments-error" class="kw-resource-error" role="alert"></p><ul data-kw="attachments" class="kw-attachments"></ul></section>
      <section class="kw-resource-group"><h3>外部網址</h3><div class="kw-link-form"><label>名稱<input data-kw="link-label" placeholder="例如：官方文件"></label><label>網址<input data-kw="link-url" placeholder="https://example.com/"></label><button class="button" type="button" data-kw="link-save">＋ 新增網址</button></div><p data-kw="links-error" class="kw-resource-error" role="alert"></p><ul data-kw="links" class="kw-resource-list"></ul></section>
      <section class="kw-resource-group"><h3>關聯筆記</h3><button class="button" type="button" data-kw="relation-add">＋ 加入關聯</button><p data-kw="relations-error" class="kw-resource-error" role="alert"></p><ul data-kw="relations" class="kw-resource-list"></ul></section>
    </div>
    <dialog class="kw-folder-dialog" data-kw="relation-dialog"><div class="kw-folder-dialog-body"><div class="section-head"><h2>手動選擇關聯知識</h2><button class="button" type="button" data-kw="relation-cancel">關閉</button></div><p class="kw-note">僅列出此瀏覽器的本機草稿；不會自動推薦或連接遠端知識。</p><div data-kw="relation-folders" class="kw-folder-tree"></div><p data-kw="relation-breadcrumb" class="kw-folder-crumb"></p><div data-kw="relation-candidates" class="kw-relation-candidates"></div><p data-kw="relation-picker-error" class="kw-resource-error" role="alert"></p></div></dialog>`;

  const get = key => host.querySelector(`[data-kw="${key}"]`);
  let editingLinkId = null;
  let replacingRelationId = null;
  let relationFolderPath = '';
  let renderSequence = 0;
  const objectUrls = new Set();
  const revokeUrls = () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); };
  const objectUrl = blob => { const url = URL.createObjectURL(blob); objectUrls.add(url); return url; };
  const fail = (key, error) => { get(key).textContent = error.message; };
  const commit = async patch => { controller.update(patch); await controller.flush(); await render(); };

  function fileText(item) {
    const name = item.originalName || item.name || '未命名檔案';
    const size = Number.isFinite(item.size) ? `${item.size} bytes` : '大小未知';
    return `${name} · ${item.mimeType || 'application/octet-stream'} · ${size}`;
  }

  async function renderAssets(draft, sequence) {
    for (const item of draft.images || []) {
      const card = document.createElement('div');
      card.className = 'kw-image-card';
      const blobRecord = item.blobId ? await getBlob(item.blobId) : null;
      if (sequence !== renderSequence) return;
      if (blobRecord?.draftId === draft.draftId) {
        const image = document.createElement('img');
        image.src = objectUrl(blobRecord.blob);
        image.alt = item.alt || item.originalName || '本機圖片';
        card.append(image);
      } else if (item.url && isHttpUrl(item.url)) {
        const image = document.createElement('img');
        image.src = item.url;
        image.alt = item.alt || item.originalName || '正式圖片';
        card.append(image);
      } else {
        const missing = document.createElement('p');
        missing.textContent = '圖片本體目前不可用；metadata 已保留。';
        card.append(missing);
      }
      const name = document.createElement('small');
      name.textContent = fileText(item);
      const alt = document.createElement('label');
      alt.textContent = '替代文字';
      const altInput = document.createElement('input');
      altInput.value = item.alt || '';
      altInput.dataset.imageAlt = item.assetId;
      alt.append(altInput);
      const caption = document.createElement('label');
      caption.textContent = '說明';
      const captionInput = document.createElement('input');
      captionInput.value = item.caption || '';
      captionInput.dataset.imageCaption = item.assetId;
      caption.append(captionInput);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'button danger'; remove.textContent = '移除圖片';
      remove.dataset.removeImage = item.assetId;
      card.append(name, alt, caption, remove);
      get('images').append(card);
    }
    for (const item of draft.attachments || []) {
      const row = document.createElement('li');
      row.className = 'kw-attachment-row';
      const name = document.createElement('span');
      name.textContent = `${fileText(item)}（${item.url ? '正式附件' : '僅本機'}）`;
      row.append(name);
      const blobRecord = item.blobId ? await getBlob(item.blobId) : null;
      if (sequence !== renderSequence) return;
      if (blobRecord?.draftId === draft.draftId) {
        const url = objectUrl(blobRecord.blob);
        const open = document.createElement('a');
        open.href = url; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = '開啟';
        const download = document.createElement('a');
        download.href = url; download.download = item.originalName || item.name || 'attachment'; download.textContent = '下載';
        row.append(open, download);
      } else if (item.url && isHttpUrl(item.url)) {
        const open = document.createElement('a');
        open.href = item.url; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = '開啟';
        row.append(open);
      } else {
        const missing = document.createElement('small'); missing.textContent = '檔案本體目前不可用'; row.append(missing);
      }
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'button danger'; remove.textContent = '移除';
      remove.dataset.removeAttachment = item.assetId || item.blobId;
      row.append(remove);
      get('attachments').append(row);
    }
  }

  function renderLinks(draft) {
    for (const link of draft.links || []) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = link.label || (isHttpUrl(link.url) ? new URL(link.url).hostname : link.url || '未命名網址');
      row.append(name);
      if (isHttpUrl(link.url)) {
        const anchor = document.createElement('a');
        anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
        anchor.textContent = link.url;
        row.append(anchor);
      } else {
        const invalid = document.createElement('small'); invalid.textContent = `${link.url || '空白網址'} · 送出前需修正`; row.append(invalid);
      }
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button'; edit.textContent = '編輯'; edit.dataset.editLink = link.linkId;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = '移除'; remove.dataset.removeLink = link.linkId;
      row.append(edit, remove); get('links').append(row);
    }
  }

  async function renderRelations(draft, sequence) {
    const byId = new Map((await controller.list()).map(candidate => [candidate.draftId, candidate]));
    if (sequence !== renderSequence) return;
    for (const relation of draft.relations || []) {
      const row = document.createElement('li');
      const target = byId.get(relation.targetId);
      const name = document.createElement('span');
      name.textContent = target ? `${target.title || '未命名草稿'} · ${target.folderPath || '根目錄'}` : `目標目前不可用 · ${relation.targetId}`;
      const replace = document.createElement('button'); replace.type = 'button'; replace.className = 'button'; replace.textContent = '重新選擇'; replace.dataset.replaceRelation = relation.relationId;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = '移除'; remove.dataset.removeRelation = relation.relationId;
      row.append(name, replace, remove); get('relations').append(row);
    }
  }

  async function render() {
    const sequence = ++renderSequence;
    revokeUrls();
    for (const key of ['images', 'attachments', 'links', 'relations']) get(key).replaceChildren();
    const draft = controller.current;
    for (const key of ['image', 'attachment', 'link-label', 'link-url', 'link-save', 'relation-add']) get(key).disabled = !draft;
    if (!draft) return;
    await renderAssets(draft, sequence);
    if (sequence !== renderSequence) return;
    renderLinks(draft);
    await renderRelations(draft, sequence);
  }

  async function showRelationPicker(replacingId = null) {
    replacingRelationId = replacingId;
    relationFolderPath = '';
    get('relation-picker-error').textContent = '';
    await renderRelationCandidates();
    get('relation-dialog').showModal();
  }

  async function renderRelationCandidates() {
    const tree = await getFolderTree();
    const folders = get('relation-folders');
    folders.replaceChildren();
    const append = (node, depth) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `kw-folder-item${node.path === relationFolderPath ? ' active' : ''}`;
      button.style.marginLeft = `${depth * 14}px`;
      button.textContent = node.path ? `📁 ${node.name}` : '全部知識';
      button.addEventListener('click', () => { relationFolderPath = node.path; void renderRelationCandidates().catch(error => fail('relation-picker-error', error)); });
      folders.append(button);
      node.children.forEach(child => append(child, depth + 1));
    };
    append(tree, 0);
    get('relation-breadcrumb').textContent = describeFolderPath(relationFolderPath);
    const candidates = get('relation-candidates');
    candidates.replaceChildren();
    const selected = getFolderLookupKey(relationFolderPath);
    const drafts = (await controller.list()).filter(item => {
      const path = getFolderLookupKey(item.folderPath || '');
      return !selected || path === selected || path.startsWith(`${selected}/`);
    });
    for (const item of drafts) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'card kw-relation-candidate';
      button.textContent = `${item.title || '未命名草稿'} · ${item.folderPath || '根目錄'}`;
      button.dataset.targetId = item.draftId;
      if (item.draftId === controller.current?.draftId) button.disabled = true;
      button.addEventListener('click', () => void (async () => {
        try {
          const relations = putRelation(controller.current.relations || [], controller.current.draftId, item.draftId, replacingRelationId);
          await commit({relations});
          get('relation-dialog').close();
          get('relations-error').textContent = '';
        } catch (error) { fail('relation-picker-error', error); }
      })());
      candidates.append(button);
    }
    if (!drafts.length) candidates.textContent = '這個資料夾目前沒有本機草稿。';
  }

  for (const [input, kind, errorKey] of [['image', 'image', 'images-error'], ['attachment', 'file', 'attachments-error']]) {
    get(input).addEventListener('change', () => void (async () => {
      get(errorKey).textContent = '';
      const files = [...get(input).files];
      get(input).value = '';
      for (const file of files) {
        try { await controller.addResource(file, kind); await render(); }
        catch (error) { fail(errorKey, error); break; }
      }
    })());
  }
  get('images').addEventListener('input', event => {
    const assetId = event.target.dataset.imageAlt || event.target.dataset.imageCaption;
    if (!assetId || !controller.current) return;
    const key = event.target.dataset.imageAlt ? 'alt' : 'caption';
    controller.update({images: (controller.current.images || []).map(item => item.assetId === assetId ? {...item, [key]: event.target.value} : item)});
  });
  get('images').addEventListener('focusout', () => void controller.flush().catch(error => fail('images-error', error)));
  get('images').addEventListener('click', event => void (async () => {
    const id = event.target.dataset.removeImage;
    if (!id || !confirm('確定移除這張本機圖片？')) return;
    try { await controller.removeResource(id, 'image'); await render(); }
    catch (error) { fail('images-error', error); }
  })());
  get('attachments').addEventListener('click', event => void (async () => {
    const id = event.target.dataset.removeAttachment;
    if (!id || !confirm('確定移除這個本機附件？')) return;
    try { await controller.removeResource(id, 'file'); await render(); }
    catch (error) { fail('attachments-error', error); }
  })());
  get('link-save').addEventListener('click', () => void (async () => {
    try {
      const url = get('link-url').value.trim();
      const label = get('link-label').value.trim();
      if (!url && !label) throw new Error('請輸入名稱或網址');
      const links = controller.current.links || [];
      if (links.some(link => link.url === url && link.linkId !== editingLinkId)) throw new Error('這個網址已加入');
      const next = editingLinkId
        ? links.map(link => link.linkId === editingLinkId ? {...link, label, url} : link)
        : [...links, {linkId: crypto.randomUUID(), label, url}];
      await commit({links: next});
      editingLinkId = null;
      get('link-label').value = ''; get('link-url').value = '';
      get('link-save').textContent = '＋ 新增網址';
      get('links-error').textContent = '';
    } catch (error) { fail('links-error', error); }
  })());
  get('links').addEventListener('click', event => void (async () => {
    const editId = event.target.dataset.editLink;
    if (editId) {
      const link = (controller.current.links || []).find(item => item.linkId === editId);
      if (!link) return;
      editingLinkId = editId; get('link-label').value = link.label; get('link-url').value = link.url;
      get('link-save').textContent = '儲存修改'; get('link-url').focus(); return;
    }
    const removeId = event.target.dataset.removeLink;
    if (!removeId) return;
    try { await commit({links: (controller.current.links || []).filter(item => item.linkId !== removeId)}); get('links-error').textContent = ''; }
    catch (error) { fail('links-error', error); }
  })());
  get('relation-add').addEventListener('click', () => void showRelationPicker().catch(error => fail('relations-error', error)));
  get('relation-cancel').addEventListener('click', () => get('relation-dialog').close());
  get('relations').addEventListener('click', event => void (async () => {
    const replaceId = event.target.dataset.replaceRelation;
    if (replaceId) { await showRelationPicker(replaceId); return; }
    const removeId = event.target.dataset.removeRelation;
    if (!removeId) return;
    try { await commit({relations: (controller.current.relations || []).filter(item => item.relationId !== removeId)}); get('relations-error').textContent = ''; }
    catch (error) { fail('relations-error', error); }
  })());
  window.addEventListener('pagehide', revokeUrls);
  return {render, showLinkErrors(errors) {
    get('links-error').textContent = Object.values(errors || {}).join('；');
  }, dispose: revokeUrls};
}
