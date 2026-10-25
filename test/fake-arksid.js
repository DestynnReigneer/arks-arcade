'use strict';

// A pretend ARKS ID for the tests: just enough of its contract (v5) for the
// arcade's sign-in, "whose device is this?", sessions and the clip inbox.
// Whoever is in `next` signs in on the next /signin; `deviceOwner` is who owns
// the next device that asks /device (null for a visitor's phone).

const http = require('node:http');
const crypto = require('node:crypto');

function startFakeArksId({ secret, arcadeBase }) {
  const users = {
    sam: { id: 'u_sam0000001', name: 'Sam', role: 'admin', boardName: 'Sam' },
    alex: { id: 'u_alex000001', name: 'Alex', role: 'adult', boardName: 'Alex' },
    milo: { id: 'u_milo000001', name: 'Milo', role: 'kid', boardName: 'MIL' }
  };
  const fake = { users, next: 'milo', deviceOwner: null, inbox: {}, sessions: new Map(), base: '' };
  const codes = new Map(), deviceCodes = new Map();
  const code = () => crypto.randomBytes(24).toString('base64url');
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const back = (res, url) => { res.writeHead(303, { Location: url }); res.end(); };
  const readBody = req => new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const q = u.searchParams;
    if (req.method === 'GET' && (u.pathname === '/signin' || u.pathname === '/device')) {
      if (q.get('app') !== 'arcade') return json(res, 400, { error: 'unknown app' });
      const c = code();
      if (u.pathname === '/signin') codes.set(c, fake.next); else deviceCodes.set(c, fake.deviceOwner);
      const to = new URL('/auth/callback', arcadeBase);
      to.searchParams.set(u.pathname === '/signin' ? 'code' : 'device', c);
      to.searchParams.set('return', q.get('return') || '/');
      if (q.get('state')) to.searchParams.set('state', q.get('state'));
      return back(res, to.href);
    }
    if (!u.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
    if (req.headers.authorization !== `Bearer ${secret}`) return json(res, 401, { error: 'no' });
    if (req.method === 'POST' && u.pathname === '/api/token') {
      const b = await readBody(req);
      const key = codes.get(b.code);
      codes.delete(b.code);
      if (!key) return json(res, 400, { error: 'bad code' });
      const sessionId = 's_' + crypto.randomBytes(12).toString('hex');
      fake.sessions.set(sessionId, { key, valid: true });
      return json(res, 200, { user: { ...users[key], device: 'personal' }, sessionId, expiresAt: Date.now() + 15 * 864e5 });
    }
    let m = /^\/api\/session\/(s_[0-9a-f]+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) {
      const s = fake.sessions.get(m[1]);
      if (!s || !s.valid) return json(res, 200, { valid: false });
      return json(res, 200, { valid: true, user: { ...users[s.key], device: 'personal' }, expiresAt: Date.now() + 15 * 864e5 });
    }
    if (req.method === 'POST' && u.pathname === '/api/device') {
      const b = await readBody(req);
      if (!deviceCodes.has(b.code)) return json(res, 400, { error: 'bad code' });
      const owner = deviceCodes.get(b.code);
      deviceCodes.delete(b.code);
      return json(res, 200, owner ? { known: true, owner: { id: users[owner].id, name: users[owner].name, role: users[owner].role } } : { known: false, owner: null });
    }
    if (req.method === 'POST' && u.pathname === '/api/clips') {
      const b = await readBody(req);
      const keys = b.to === 'everyone' ? Object.keys(users) : Object.keys(users).filter(k => users[k].id === b.to);
      if (!keys.length) return json(res, 400, { error: 'nobody' });
      keys.forEach(k => { (fake.inbox[k] = fake.inbox[k] || []).push(b.clip); });
      return json(res, 200, { sent: keys.length });
    }
    m = /^\/api\/clips\/(s_[0-9a-f]+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) {
      const s = fake.sessions.get(m[1]);
      return json(res, 200, { clip: s && s.valid ? (fake.inbox[s.key] || []).shift() || null : null });
    }
    json(res, 404, { error: 'Not found.' });
  });

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    fake.base = `http://127.0.0.1:${server.address().port}`;
    fake.close = () => server.close();
    resolve(fake);
  }));
}

module.exports = { startFakeArksId };
