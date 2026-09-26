import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');
const safeEqual = (a, b) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function createAuth(secret, {now = () => Date.now(), ttlMs = 30 * 60_000} = {}) {
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('KNOWLEDGE_WRITE_SECRET 至少需要 24 個字元');
  const attempts = new Map();
  return {
    exchange(candidate, ip = '') {
      const key = ip || 'unknown';
      const item = attempts.get(key) || {count: 0, until: 0};
      if (item.until > now()) return {status: 429, retryAfter: Math.ceil((item.until - now()) / 1000)};
      if (!safeEqual(String(candidate || ''), secret)) {
        item.count += 1;
        if (item.count >= 5) { item.until = now() + 15 * 60_000; item.count = 0; }
        attempts.set(key, item);
        return {status: 401};
      }
      attempts.delete(key);
      const expiresAt = new Date(now() + ttlMs).toISOString();
      const payload = encode({exp: now() + ttlMs, nonce: randomUUID()});
      return {status: 200, accessToken: `${payload}.${sign(payload, secret)}`, expiresAt};
    },
    verify(header) {
      if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
      const [payload, signature, extra] = header.slice(7).split('.');
      if (!payload || !signature || extra || !safeEqual(signature, sign(payload, secret))) return false;
      try { return Number(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp) > now(); }
      catch { return false; }
    },
  };
}
