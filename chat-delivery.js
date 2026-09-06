// Persist messages before sending. Only a remote recipient can acknowledge delivery.
function chatStoreKey(suffix) { return `lizhi-chat-${suffix}:${chat.roomCode}`; }
function readLocalJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocalJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast("裝置儲存空間不足，請先備份資料"); return false; }
}
function initializeDelivery() {
  chat.outbox = readLocalJson(chatStoreKey("outbox"), []);
  if (!Array.isArray(chat.outbox)) chat.outbox = [];
  chat.draft = readLocalJson(chatStoreKey("draft"), "");
  chat.composing = false;
  chat.received = readLocalJson(chatStoreKey("received"), []);
  if (!Array.isArray(chat.received)) chat.received = [];
  chat.messages = [...chat.messages.filter(m => !chat.outbox.some(p => p.id === m.id)), ...chat.outbox];
  setInterval(() => flushChatOutbox(), 4000);
  window.addEventListener("online", () => { if(chat.started) scheduleChatReconnect(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && chat.started) {
      if (!chat.peer || chat.peer.destroyed || chat.peer.disconnected) scheduleChatReconnect();
      else flushChatOutbox();
    }
  });
}
function persistChatDraft(value) {
  chat.draft = value;
  return writeLocalJson(chatStoreKey("draft"), value);
}
function queueChatText(text) {
  const content = String(text || "").trim();
  if (!content || chat.composing) return false;
  if (content.length > 10000) { toast("文字超過 10,000 字，請分段傳送"); return false; }
  if (chat.outbox.length >= 100) { toast("已有 100 段等待接收，請先連接另一台裝置"); return false; }
  const message = {id:uid(), deviceId:chat.deviceId, deviceName:chat.deviceName, content, createdAt:now(), delivery:"pending"};
  const pending = [...chat.outbox, message];
  if (!writeLocalJson(chatStoreKey("outbox"), pending)) return false;
  chat.outbox = pending;
  persistChatDraft("");
  addChatMessage(message);
  flushChatOutbox();
  return true;
}
function flushChatOutbox() {
  if (!chat.outbox?.length) return;
  for (const message of chat.outbox) {
    sendToConnections({...message, protocol:"lizhi-chat-v2", kind:"message"});
  }
}
function receiveChatPacket(packet, connection, connectionId) {
  if (!packet || typeof packet !== "object") return;
  if(packet.protocol === 'lizhi-chat-v2' && packet.kind === 'hello') {
    connection.lizhiVersion = 17;
    if(!connection.historySent && connection.open) {
      connection.historySent = true;
      // History only crosses the existing private room's data channel.
      const items = [...chat.messages, ...chat.outbox.filter(m=>!chat.messages.some(h=>h.id===m.id))].slice(-80);
      try { connection.send({protocol:'lizhi-chat-v2',kind:'history',items}); } catch {}
    }
    if(state.route === 'chat') render();
    return;
  }
  if(packet.protocol === 'lizhi-chat-v2' && packet.kind === 'history') {
    if(!connection.lizhiVersion || !Array.isArray(packet.items) || packet.items.length > 80) return;
    for(const item of packet.items) receiveChatPacket({...item,protocol:'lizhi-chat-v2',kind:'message'},connection,connectionId);
    chat.messages.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
    saveChatHistory();
    if(state.route === 'chat') render();
    return;
  }
  if (packet.kind === "ack" && packet.protocol === "lizhi-chat-v2") {
    if (typeof packet.id !== "string" || typeof packet.recipientId !== 'string' || packet.recipientId === chat.deviceId) return;
    const pending = chat.outbox.find(m => m.id === packet.id);
    if (pending) {
      const remaining = chat.outbox.filter(m => m.id !== packet.id);
      if (!writeLocalJson(chatStoreKey("outbox"), remaining)) return;
      chat.outbox = remaining;
      const message = chat.messages.find(m => m.id === packet.id);
      if(message) message.delivery = "received";
      saveChatHistory();
      if(state.route === "chat") render();
    }
    const historical = chat.messages.find(m=>m.id === packet.id && m.deviceId === chat.deviceId);
    if(historical && historical.delivery !== 'received') { historical.delivery='received';saveChatHistory();if(state.route==='chat')render(); }
    if(chat.host) sendToConnections(packet, connectionId);
    return;
  }
  if (typeof packet.id !== "string" || packet.id.length > 100 || typeof packet.content !== "string" || packet.content.length > 10000 ||
      typeof packet.deviceId !== "string" || !Number.isFinite(Date.parse(packet.createdAt))) return;
  if (packet.deviceId === chat.deviceId) return;
  const message = {id:packet.id, deviceId:packet.deviceId, deviceName:String(packet.deviceName || "其他裝置").slice(0,40), content:packet.content, createdAt:packet.createdAt};
  if (!chat.received.includes(message.id) && !chat.messages.some(item=>item.id===message.id)) {
    // Do not acknowledge data which could not be saved on this device.
    const next = [...chat.messages, message].slice(-80);
    if (!writeLocalJson(CHAT_HISTORY_PREFIX + chat.roomCode, next)) return;
    chat.received = [...chat.received, message.id].slice(-2000);
    writeLocalJson(chatStoreKey("received"), chat.received);
    addChatMessage(message);
  }
  if (packet.protocol === "lizhi-chat-v2" && connection.open) {
    try { connection.send({protocol:"lizhi-chat-v2",kind:"ack",id:message.id,recipientId:chat.deviceId}); } catch {}
  }
  if(chat.host) sendToConnections(packet, connectionId);
}
function attachChatConnection(connection, id) {
  chat.connections.set(id, connection);
  connection.on("open", () => {
    chat.lastError = '';
    try { connection.send({protocol:'lizhi-chat-v2',kind:'hello',version:17}); } catch {}
    updateChatStatus("online"); flushChatOutbox();
  });
  connection.on("data", packet => receiveChatPacket(packet, connection, id));
  const closed = () => {
    if(chat.connections.get(id) !== connection) return;
    chat.connections.delete(id);
    if(chat.host) updateChatStatus("online"); else scheduleChatReconnect();
  };
  connection.on("close", closed);
  connection.on("error", closed);
}
function retryChatConnection() {
  if(chat.retryTimer) return;
  chat.status = "connecting";
  chat.retryTimer = setTimeout(() => {
    chat.retryTimer = null;
    const previous = chat.peer;
    chat.peer = null;
    chat.connections.clear();
    try { previous?.destroy(); } catch {}
    chat.started = false;
    startRealtimeChat();
  }, 3000);
  if(state.route === "chat") render();
}
function startChatClient() {
  const peer = new Peer(undefined, {debug:0});
  chat.peer = peer; chat.host = false;
  peer.on("open", () => {
    if(chat.peer !== peer) return;
    const connection = peer.connect(chat.hostId, {reliable:true,metadata:{deviceId:chat.deviceId}});
    attachChatConnection(connection, "host");
    setTimeout(() => { if(chat.peer === peer && !connection.open) scheduleChatReconnect(); }, 12000);
  });
  peer.on("error", error => { if(chat.peer === peer) {chat.lastError=error?.type||'network';scheduleChatReconnect();} });
  peer.on("disconnected", () => { if(chat.peer === peer) scheduleChatReconnect(); });
}
async function startReliableChat() {
  if(chat.started) return;
  chat.started = true;
  updateChatStatus("connecting");
  if(!window.Peer) { chat.lastError='library';scheduleChatReconnect(); return; }
  chat.hostId = await chatPeerId();
  const peer = new Peer(chat.hostId, {debug:0});
  chat.peer = peer; chat.host = true;
  peer.on("connection", connection => attachChatConnection(connection, connection.peer + "-" + uid()));
  peer.on("open", () => { if(chat.peer === peer) updateChatStatus("online"); });
  peer.on("disconnected", () => { if(chat.peer === peer) scheduleChatReconnect(); });
  peer.on("error", error => {
    if(chat.peer !== peer) return;
    if(error?.type === "unavailable-id") {
      chat.peer = null;
      peer.destroy();
      startChatClient();
    } else { chat.lastError=error?.type||'network'; scheduleChatReconnect(); }
  });
}
function autoQueueChat(text, immediate = false) {
  clearTimeout(chat.autoSendTimer);
  persistChatDraft(text);
  if(chat.composing || !String(text || "").trim()) return;
  chat.autoSendTimer = setTimeout(() => {
    const input = document.querySelector('.chat-compose textarea');
    if(!chat.composing && input && input.value === text && queueChatText(text)) input.value = "";
  }, immediate ? 80 : 850);
}
