// Public cloud chat. Only a successful database response means cloud-saved.
const CHAT_API = 'https://dtgtkrlzufylyvcbgggw.supabase.co/rest/v1';
// Publishable browser key, not a service-role/admin credential.
const CHAT_PUBLIC_KEY = 'sb_publishable_srv3yVIAjEQne-p0qhw19A_feAFnV6s';
function chatStoreKey(suffix) { return `lizhi-chat-${suffix}:${chat.roomCode}`; }
function readLocalJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocalJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast('裝置儲存空間不足，請先備份資料'); return false; }
}
function initializeDelivery() {
  chat.outbox = readLocalJson(chatStoreKey('outbox'), []);
  if (!Array.isArray(chat.outbox)) chat.outbox = [];
  chat.draft = readLocalJson(chatStoreKey('draft'), '');
  chat.composing = false; chat.syncBusy = false; chat.lastError = ''; chat.failureCount = 0;
  window.addEventListener('online', retryChatConnection);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryChatConnection(); });
  window.addEventListener('storage', event => {
    if (event.key === chatStoreKey('outbox')) {
      chat.outbox = readLocalJson(event.key, []);
      if (state.route === 'chat') render();
      retryChatConnection();
    }
  });
}
function persistChatDraft(value) {
  chat.draft = value;
  return writeLocalJson(chatStoreKey('draft'), value);
}
function queueChatText(text) {
  const content = String(text || '').trim();
  if (!content || chat.composing) return false;
  if (content.length > 10000) { toast('文字超過 10,000 字，請分段傳送'); return false; }
  const pending = readLocalJson(chatStoreKey('outbox'), chat.outbox);
  if (pending.length >= 100) { toast('已有 100 段待上傳，請等網路恢復'); return false; }
  const message = {id:uid(), deviceId:chat.deviceId, deviceName:chat.deviceName.trim().slice(0,40) || '訪客裝置', content, createdAt:now(), delivery:'pending'};
  if (!writeLocalJson(chatStoreKey('outbox'), [...pending, message])) return false;
  chat.outbox = [...pending, message];
  persistChatDraft('');
  if (state.route === 'chat') render();
  retryChatConnection();
  return true;
}
async function chatRequest(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(CHAT_API + path, {
      method: body ? 'POST' : 'GET', cache:'no-store', signal:controller.signal,
      headers:{apikey:CHAT_PUBLIC_KEY, ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.message === 'rate_limit' || response.status === 429) throw new Error('傳送較頻繁，稍後會自動補送');
      if (error.message === 'storage_limit') throw new Error('共用紀錄已達容量上限，文字仍留在此裝置');
      throw new Error('雲端暫時無法同步，文字先保存在此裝置');
    }
    return await response.json();
  } finally { clearTimeout(timer); }
}
function cloudMessage(row) {
  if (!row || typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(row.id) || typeof row.content !== 'string' || row.content.length > 10000 || !Number.isFinite(Date.parse(row.created_at))) throw new Error('雲端資料格式異常，稍後重試');
  return {id:row.id, deviceId:row.device_id, deviceName:String(row.device_name || '訪客裝置').slice(0,40), content:row.content, createdAt:row.created_at, delivery:'cloud'};
}
async function flushChatOutbox() { return syncCloudChat(); }
function retryChatConnection() {
  if (!chat.started) return;
  clearTimeout(chat.retryTimer);
  void syncCloudChat();
}
async function startReliableChat() {
  if (chat.started) return;
  chat.started = true;
  void syncCloudChat();
}
async function syncCloudChat() {
  if (!chat.started || chat.syncBusy) return;
  clearTimeout(chat.retryTimer); chat.syncBusy = true;
  try {
    if (!navigator.onLine) throw new Error('目前離線，文字先保存在此裝置');
    // Retry the same ID after timeouts: the database does not duplicate a write.
    for (const message of chat.outbox.slice(0,10)) {
      const row = await chatRequest('/rpc/lizhi_send_message', {p_id:message.id,p_device_id:message.deviceId,p_device_name:message.deviceName,p_content:message.content});
      const saved = cloudMessage(row);
      if (saved.id !== message.id || saved.content !== message.content) throw new Error('雲端接收確認不符，文字仍保留');
      chat.messages = [...chat.messages.filter(m => m.id !== saved.id), saved].slice(-80);
      saveChatHistory();
      const pending = readLocalJson(chatStoreKey('outbox'), chat.outbox).filter(m => m.id !== saved.id);
      if (!writeLocalJson(chatStoreKey('outbox'), pending)) throw new Error('本機儲存失敗，稍後重試');
      chat.outbox = pending;
    }
    const latest = await chatRequest('/lizhi_cloud_messages?select=id&order=created_at.desc,id.desc&limit=1');
    if (!Array.isArray(latest)) throw new Error('雲端資料格式異常，稍後重試');
    const latestId = latest[0]?.id || '';
    if (chat.latestCloudId !== latestId) {
      const rows = await chatRequest('/lizhi_cloud_messages?select=id,device_id,device_name,content,created_at&order=created_at.desc,id.desc&limit=80');
      if (!Array.isArray(rows)) throw new Error('雲端資料格式異常，稍後重試');
      chat.messages = rows.map(cloudMessage).reverse();
      chat.latestCloudId = rows[0]?.id || '';
      saveChatHistory();
    }
    chat.status = 'online'; chat.lastError = ''; chat.failureCount = 0; chat.lastSyncedAt = Date.now();
  } catch (error) {
    chat.status = 'offline';
    chat.lastError = error.name === 'AbortError' ? '連線逾時，文字先保存在此裝置' : error.message || '連線中斷，稍後自動重試';
    chat.failureCount++;
  } finally {
    chat.syncBusy = false;
    if (state.route === 'chat') render();
    const delay = chat.failureCount ? Math.min(30000,5000 * chat.failureCount) : chat.outbox.length ? 500 : document.hidden || state.route !== 'chat' ? 15000 : 3000;
    chat.retryTimer = setTimeout(() => void syncCloudChat(), delay);
  }
}
function autoQueueChat(text, immediate = false) {
  clearTimeout(chat.autoSendTimer);
  persistChatDraft(text);
  if (chat.composing || !String(text || '').trim()) return;
  chat.autoSendTimer = setTimeout(() => {
    const input = document.querySelector('.chat-compose textarea');
    if (!chat.composing && input && input.value === text && queueChatText(text)) input.value = '';
  }, immediate ? 80 : 850);
}
