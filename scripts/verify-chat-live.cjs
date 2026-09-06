// Compatibility entry point for the current cloud transport, not PeerJS.
process.env.LIVE_CHAT = '1';
require('./verify-cloud-chat.cjs');
