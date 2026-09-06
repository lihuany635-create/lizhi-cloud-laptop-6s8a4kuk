// Keep active DOM nodes mounted: menu changes must not replace players or iframes.
const workspacePanels = new Map();
let modalMarkup = "";
let uploadReport = null;
let uploadReportError = "";
let mediaPrefs;
let currentMediaPlayer = null;
function prefsFor(row) {
  mediaPrefs ??= readLocalJson("lizhi-media-preferences", {});
  const key = row.remoteUrl || row.id;
  return mediaPrefs[key] ||= {position:0,rate:1,favorite:false,completed:false};
}
function persistMediaPrefs() { writeLocalJson("lizhi-media-preferences", mediaPrefs); }
function setMenuState() {
  const shell = document.querySelector('.shell');
  shell.className = `shell route-${state.route} ${state.sidebar ? "drawer-open" : ""}`;
  document.querySelector('.sidebar').classList.toggle('open', state.sidebar);
  document.querySelector('.sidebar').inert = !state.sidebar;
  const handle = document.querySelector('.drawer-handle');
  handle.textContent = state.sidebar ? "›" : "‹";
  handle.setAttribute('aria-label', state.sidebar ? "關閉收藏庫選單" : "拉出收藏庫選單");
  document.querySelector('.library-menu-button').setAttribute('aria-expanded', String(state.sidebar));
  document.querySelectorAll('[data-route]').forEach(el => el.classList.toggle('active', el.dataset.route === state.route));
  document.querySelector('.local-pill').textContent = IS_CLOUD_SITE ? `${state.cloudMedia.length} 集雲端影音` : "僅此裝置";
}
function renderWorkspace() {
  if(!document.querySelector('.shell')) {
    app.innerHTML = layout("");
    const dock = document.createElement('div');
    dock.className = 'playback-dock'; dock.hidden = true;
    dock.innerHTML = '<span data-playing-title></span><button class="button" data-action="toggle-playback">暫停</button><button class="button" data-route="media">回影音庫</button>';
    app.append(dock);
  }
  setMenuState();
  let panel = workspacePanels.get(state.route);
  if(!panel) {
    panel = document.createElement('div');
    panel.className = 'workspace-panel'; panel.dataset.panel = state.route;
    document.querySelector('.main').append(panel);
    workspacePanels.set(state.route, panel);
  }
  for(const [route, el] of workspacePanels) el.hidden = route !== state.route;
  if(state.route === 'media') updateMediaPanel(panel);
  else if(state.route === 'chat') updateChatPanel(panel);
  else if(state.route === 'study' || state.route === 'a4') {
    if(!panel.hasChildNodes()) {
      panel.innerHTML = state.route === 'study' ? renderStudy() : renderA4Editor();
      if(state.route === 'study') {
        const label = panel.querySelector('.study-online');
        label.textContent = '讀書室載入中';
        panel.querySelector('iframe').addEventListener('load', () => { label.textContent = '讀書室頁面已載入 · AI 狀態請見室內'; });
      }
    }
  } else {
    const renderers = {home:renderHome,knowledge:renderKnowledge,trash:renderTrash,settings:renderSettings,uploads:renderUploads};
    const focused = document.activeElement;
    const searchFocused = panel.contains(focused) && focused.matches('[data-search]');
    const selection = searchFocused ? [focused.selectionStart, focused.selectionEnd] : null;
    panel.innerHTML = (renderers[state.route] || renderHome)();
    if(selection) { const input = panel.querySelector('[data-search]'); input?.focus(); input?.setSelectionRange(...selection); }
  }
  const nextModal = renderModal();
  if(nextModal !== modalMarkup) {
    document.querySelector('.modal-backdrop')?.remove();
    if(nextModal) app.insertAdjacentHTML('beforeend', nextModal);
    modalMarkup = nextModal;
  }
  if(state.route === 'chat') startRealtimeChat();
  if(state.route === 'uploads' && !uploadReport && !uploadReportError) loadUploadReport();
}
function updateChatPanel(panel) {
  const history = chat.messages;
  chat.messages = [...history, ...chat.outbox.filter(item => !history.some(message => message.id === item.id))];
  const template = document.createElement('template'); template.innerHTML = renderChat();
  chat.messages = history;
  if(!panel.hasChildNodes()) {
    panel.append(template.content.cloneNode(true));
    panel.querySelector('textarea').value = chat.draft || '';
    const input = panel.querySelector('textarea');
    input.addEventListener('compositionstart', () => { chat.composing = true; clearTimeout(chat.autoSendTimer); });
    input.addEventListener('compositionend', () => { chat.composing = false; scheduleChatAutoSend(input.value); });
    const pairing = document.createElement('details'); pairing.className='chat-pairing';
    pairing.innerHTML = `<summary>配對／確認兩台是否同一房間（版本 17）</summary><p>第一次請在手機開啟筆電的「複製連線網址」。兩邊的配對識別必須相同。</p><p>此房間識別：<strong>${escapeHtml(chat.roomCode.slice(0,8))}</strong></p><label>完整配對碼<input readonly aria-label="本機完整配對碼" value="${escapeHtml(chat.roomCode)}"></label><p>也可把另一台的連線網址或完整配對碼貼在下方加入。原房間的內容會保留在原房間。</p><form data-form="join-chat-room"><label>另一台的配對碼或連線網址<input name="invite" required autocomplete="off" spellcheck="false" aria-label="另一台的配對碼或連線網址"></label><button class="button" type="submit">加入同一房間</button></form><p data-pair-error role="status"></p><button class="button" type="button" data-action="retry-chat">重新連線</button></details>`;
    panel.querySelector('.chat-share').after(pairing);
    pairing.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault();event.stopImmediatePropagation();
      const raw=event.target.elements.invite.value.trim();let code=raw;
      if(/^https?:\/\//i.test(raw)) { try { const url=new URL(raw);code=url.searchParams.get('room');if(url.origin!==new URL(CLOUD_APP_URL).origin && url.origin!==location.origin)code=''; } catch {code='';} }
      if(!validRoom(code)) { pairing.querySelector('[data-pair-error]').textContent='請貼上完整配對碼或「複製連線網址」取得的網址；一般首頁網址不含房間。';return; }
      const url=new URL(location.href);url.searchParams.set('open','chat');url.searchParams.set('room',code);url.searchParams.set('v','17');location.assign(url.href);
    });
  }
  const messages = panel.querySelector('.chat-messages');
  const scrollTop = messages.scrollTop;
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 70;
  const markup = template.content.querySelector('.chat-messages').innerHTML;
  if(messages.innerHTML !== markup) {
    messages.innerHTML = markup;
    messages.scrollTop = atBottom ? messages.scrollHeight : scrollTop;
  }
  messages.querySelectorAll('.chat-message.mine').forEach(el => {
    const id = el.querySelector('[data-copy-chat]').dataset.copyChat;
    const message = chat.messages.find(m => m.id === id) || chat.outbox.find(m => m.id === id);
    const status = document.createElement('small'); status.className = 'delivery-state';
    status.textContent = chat.outbox.some(m => m.id === id) ? '待傳送／等待接收確認' : message.delivery === 'received' ? '對方裝置已收到' : '舊訊息 · 未提供接收確認';
    el.append(status);
  });
  const count = [...chat.connections.values()].filter(c => c.open).length;
  const errors = {'library':'連線元件載入失敗，請重新整理','peer-unavailable':'找不到另一台裝置，正在重連','network':'連線服務暫時無法連上','webrtc':'目前網路未能建立裝置連線'};
  const knownPeer=[...chat.connections.values()].some(c=>c.open&&c.lizhiVersion);
  panel.querySelector('.chat-status').textContent = (count ? `已連線 · ${count + 1} 台裝置${knownPeer?' · 已配對':' · 等待對方版本確認'}` : chat.lastError ? errors[chat.lastError]||'連線未完成，正在重試' : chat.status === 'online' ? '尚未配對 · 請在手機開啟此房間的連線網址' : '連線中 · 文字會先保存在待傳佇列') + ` · 房間 ${chat.roomCode.slice(0,8)}`;
  panel.querySelector('textarea').disabled = false;
  panel.querySelector('.chat-compose small').textContent = '貼上立即排入傳送 · 打字停頓後自動傳送 · 中文選字時暫停 · 接收確認才算送達';
}
function updateMediaPanel(panel) {
  // Render all cards once; filters hide existing cards so playback and focus survive.
  for(const row of active('media')) if(row.cloud) row.favorite = !!prefsFor(row).favorite;
  const query = state.query, type = state.mediaType;
  state.query = ''; state.mediaType = 'all';
  const template = document.createElement('template'); template.innerHTML = renderMedia();
  state.query = query; state.mediaType = type;
  if(!panel.hasChildNodes()) panel.append(template.content.cloneNode(true));
  const grid = panel.querySelector('.grid');
  if(!grid && active('media').length) { panel.replaceChildren(template.content.cloneNode(true)); }
  const targetGrid = panel.querySelector('.grid');
  for(const source of template.content.querySelectorAll('[data-media-card]')) {
    const existing = [...panel.querySelectorAll('[data-media-card]')].find(el => el.dataset.mediaCard === source.dataset.mediaCard);
    if(!existing) targetGrid?.append(source.cloneNode(true));
  }
  let visible = 0;
  for(const card of panel.querySelectorAll('[data-media-card]')) {
    const row = active('media').find(r => r.id === card.dataset.mediaCard);
    if(!row) { card.querySelector('audio,video')?.pause(); card.remove(); continue; }
    card.hidden = !(matches(row) && (type === 'all' || (type === 'favorite' ? row.favorite : row.mediaType === type)));
    if(!card.hidden) visible++;
    const pref = prefsFor(row);
    let favorite = card.querySelector('[data-favorite]');
    if(!favorite) { favorite = document.createElement('button'); favorite.className = 'icon-button'; favorite.dataset.favorite = row.id; card.querySelector('.card-top').append(favorite); }
    favorite.textContent = row.favorite ? '★' : '☆'; favorite.title = row.favorite ? '取消收藏' : '收藏'; favorite.setAttribute('aria-pressed', String(!!row.favorite));
    if(!card.querySelector('.listening-progress')) {
      const info = document.createElement('p'); info.className = 'listening-progress'; card.append(info);
      card.querySelector('.card-actions').insertAdjacentHTML('beforeend', `<button class="button" data-next-media="${row.id}">下一集</button><button class="button" data-complete-media="${row.id}">標記已聽完</button>`);
    }
    updateProgressLabel(card, pref);
  }
  const stats = panel.querySelectorAll('.stat b');
  [visible, active('media').filter(r=>r.mediaType==='audio').length, active('media').filter(r=>r.mediaType==='video').length, formatBytes(active('media').reduce((s,r)=>s+(r.size||0),0))].forEach((v,i) => { if(stats[i]) stats[i].textContent = v; });
  panel.querySelector('.section-head .count').textContent = `${visible} 項 · ${active('media').filter(r=>r.favorite).length} 收藏`;
  let empty = panel.querySelector('.filter-empty');
  if(!empty) { empty = document.createElement('p'); empty.className = 'empty filter-empty'; empty.textContent = '沒有符合篩選條件的影音，請調整搜尋或類型'; panel.querySelector('.section').append(empty); }
  empty.hidden = visible > 0;
  const input = panel.querySelector('[data-search]'); if(input && input !== document.activeElement) input.value = query;
  panel.querySelector('[data-media-filter]').value = type;
  if(!panel.querySelector('[data-autoplay-next]')) {
    const label = document.createElement('label'); label.className = 'autoplay-option';
    label.innerHTML = '<input type="checkbox" data-autoplay-next> 自動播放下一集（依目錄順序）';
    label.querySelector('input').checked = readLocalJson('lizhi-autoplay-next', false);
    panel.querySelector('.toolbar').append(label);
    panel.querySelector('.page-head p').textContent += ' 收藏與播放進度保存在此裝置。';
    panel.querySelector('.actions').insertAdjacentHTML('beforeend', '<button class="button" data-route="uploads">上傳狀態</button>');
  }
  hydrateStableMedia(panel);
}
function updateProgressLabel(card, pref) {
  const seconds = Math.floor(pref.position || 0);
  card.querySelector('.listening-progress').textContent = pref.completed ? '✓ 已聽完' : seconds ? `上次聽到 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · 播放時自動續接` : '尚未收聽';
  card.querySelector('[data-complete-media]').textContent = pref.completed ? '改為未聽完' : '標記已聽完';
}
async function hydrateStableMedia(panel) {
  for(const slot of panel.querySelectorAll('[data-player]')) {
    if(slot.dataset.hydrating || slot.hasChildNodes()) continue;
    slot.dataset.hydrating = '1';
    const row = state.records.find(r => r.id === slot.dataset.player); if(!row) continue;
    let url = row.remoteUrl;
    if(!url) { const blob = await getBlob(row.id); if(!blob) { slot.textContent = '檔案本體不在此裝置，請重新匯入'; continue; } url = URL.createObjectURL(blob); }
    const player = document.createElement(row.mediaType === 'video' ? 'video' : 'audio');
    player.controls = true; player.preload = 'none'; player.src = url; player.dataset.playerElement = row.id;
    const pref = prefsFor(row);
    player.playbackRate = Number(pref.rate) || 1;
    slot.closest('.card').querySelector('[data-rate]').value = String(player.playbackRate);
    player.addEventListener('loadedmetadata', () => { if(pref.position > 0 && pref.position < player.duration - 1 && !pref.completed) player.currentTime = pref.position; });
    let lastSave = 0;
    const save = () => { if(player.readyState < 1) return; pref.position = player.currentTime; pref.rate = player.playbackRate; persistMediaPrefs(); updateProgressLabel(slot.closest('.card'), pref); };
    player.addEventListener('timeupdate', () => { if(Date.now()-lastSave > 5000) {lastSave = Date.now(); save();} });
    player.addEventListener('pause', () => { save(); updatePlaybackDock(); });
    player.addEventListener('seeked', save);
    player.addEventListener('ratechange', save);
    player.addEventListener('play', () => {
      if(currentMediaPlayer && currentMediaPlayer !== player) currentMediaPlayer.pause();
      currentMediaPlayer = player; pref.completed = false; updatePlaybackDock();
    });
    player.addEventListener('ended', () => { pref.completed = true; pref.position = 0; persistMediaPrefs(); updateProgressLabel(slot.closest('.card'), pref); updatePlaybackDock(); if(readLocalJson('lizhi-autoplay-next',false)) playNextMedia(row.id); });
    player.addEventListener('error', () => { slot.closest('.card').querySelector('.listening-progress').textContent = '音檔載入失敗，請檢查網路或使用下載'; });
    slot.append(player);
  }
}
function updatePlaybackDock() {
  const dock = document.querySelector('.playback-dock'); if(!dock) return;
  dock.hidden = !currentMediaPlayer;
  if(!currentMediaPlayer) return;
  const row = state.records.find(r=>r.id === currentMediaPlayer.dataset.playerElement);
  dock.querySelector('[data-playing-title]').textContent = `${currentMediaPlayer.paused ? '已暫停' : '正在播放'}：${row?.title || ''}`;
  dock.querySelector('[data-action]').textContent = currentMediaPlayer.paused ? '播放' : '暫停';
}
async function playNextMedia(id) {
  const rows = active('media'), index = rows.findIndex(r=>r.id === id);
  const next = rows[index+1]; if(!next) { toast('已到最後一集'); return; }
  const player = document.querySelector(`[data-player-element="${next.id}"]`);
  if(player) { try { await player.play(); } catch { toast('請按下一集的播放鍵繼續'); } }
}
let reportLoading = false;
async function loadUploadReport() {
  if(reportLoading) return; reportLoading = true;
  try {
    const response = await fetch('./upload-status.json', {cache:'no-store'});
    if(!response.ok) throw new Error('目前無法取得排程回報');
    uploadReport = await response.json(); uploadReportError = '';
  } catch(error) { uploadReportError = error.message; }
  finally { reportLoading = false; if(state.route === 'uploads') render(); }
}
function renderUploads() {
  const report = uploadReport;
  const stamp = value => value ? new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}) : '尚無回報';
  const stale = report?.checkedAt && Date.now()-Date.parse(report.checkedAt) > 26*60*60*1000;
  return `${head('UPLOAD STATUS','上傳狀態','這裡顯示上傳工作最近發布的回報；電腦上的即時執行狀態不會自動傳到網站。','<button class="button" data-action="refresh-upload-status">重新取得狀態</button>')}<section class="section"><p>固定時間：每天 21:20（台灣時間）· 執行電腦需開機並連網</p><p>網站影音目錄：${state.cloudMedia.length} 集</p>${report ? `<p>回報時間：${stamp(report.checkedAt)}${stale ? ' · 回報已過期，請檢查排程' : ''}</p><p>上次成功上傳：${stamp(report.lastSuccessAt)}</p><p>待上傳：${Number.isInteger(report.pendingCount) ? report.pendingCount + ' 集（截至回報時間）' : '未知，需由上傳工作掃描'}</p><p>結果：${escapeHtml(report.message)}</p><p>失敗原因：${escapeHtml(report.error || '回報中沒有錯誤')}</p>` : `<p>${escapeHtml(uploadReportError || '正在取得回報…')}</p>`}</section><section class="section"><h2>資料保存位置</h2><p>影音檔與節目清單：雲端，可跨裝置讀取。</p><p>收藏、收聽進度、傳字紀錄、知識庫筆記與上傳文件：此裝置的瀏覽器。更換裝置不會自動同步。</p></section>`;
}
function installWorkspaceEvents() {
  app.addEventListener('click', event => {
    const button = event.target.closest('button'); if(!button) return;
    const action = button.dataset.action;
    if(action === 'toggle-menu') { event.stopImmediatePropagation(); state.sidebar = !state.sidebar; setMenuState(); return; }
    if(action === 'retry-chat') scheduleChatReconnect();
    if(button.dataset.favorite && state.records.find(r=>r.id === button.dataset.favorite)?.cloud) {
      event.stopImmediatePropagation(); const row = state.records.find(r=>r.id === button.dataset.favorite);
      const pref = prefsFor(row); pref.favorite = !pref.favorite; persistMediaPrefs(); render();
    }
    if(button.dataset.completeMedia) { const row = state.records.find(r=>r.id === button.dataset.completeMedia); const pref = prefsFor(row); pref.completed = !pref.completed; persistMediaPrefs(); render(); }
    if(button.dataset.nextMedia) playNextMedia(button.dataset.nextMedia);
    if(action === 'toggle-playback' && currentMediaPlayer) { if(currentMediaPlayer.paused) currentMediaPlayer.play().catch(()=>toast('請回影音庫按播放')); else currentMediaPlayer.pause(); }
    if(action === 'refresh-upload-status') loadUploadReport();
    if(action === 'clear-chat' && chat.outbox.length) { event.stopImmediatePropagation(); toast('尚有待傳訊息，收到確認後再清除紀錄'); }
  }, true);
  app.addEventListener('change', event => { if(event.target.matches('[data-autoplay-next]')) writeLocalJson('lizhi-autoplay-next',event.target.checked); });
  window.addEventListener('pagehide', () => {
    if(currentMediaPlayer) { const row = state.records.find(r=>r.id === currentMediaPlayer.dataset.playerElement); if(row) { prefsFor(row).position = currentMediaPlayer.currentTime; persistMediaPrefs(); } }
  });
}
