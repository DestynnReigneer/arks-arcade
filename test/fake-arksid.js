'use strict';

// A pretend ARKS ID for the tests: just enough of its contract (v14) for the
// arcade's sign-in, "whose device is this?", sessions, the clip inbox, the
// feedback inbox, TVs (the pairing code sign-in and adults' night), and
// the photos and team pictures people pick (served from /avatars/).
// Whoever is in `next` signs in on the next /signin; `deviceOwner` is who owns
// the next device that asks /device (null for a visitor's phone).

const http = require('node:http');
const crypto = require('node:crypto');

// port: a fixed port (the browser tests use one, so they can reach /test/...).
function startFakeArksId({ secret, arcadeBase, port = 0 }) {
  const users = {
    sam: { id: 'u_sam0000001', name: 'Sam', role: 'admin', boardName: 'Sam' },
    alex: { id: 'u_alex000001', name: 'Alex', role: 'adult', boardName: 'Alex', avatar: { icon: 'cat', color: 'teal', image: null, art: null } },
    milo: { id: 'u_milo000001', name: 'Milo', role: 'kid', boardName: 'MIL', avatar: { icon: 'rocket', color: 's1', image: null, art: 'toon:2' } },
    // A photo; its address is filled in once the fake knows where it lives.
    kim: { id: 'u_kim0000001', name: 'Kim', role: 'adult', boardName: 'Kim', avatar: { icon: 'star', color: 'pink', image: null, art: null } },
    // A TV's own account (v14): always the kid role.
    tv: { id: 'u_tv00000001', name: 'Living room TV', role: 'kid', kind: 'tv', boardName: '', avatar: { icon: 'controller', color: 'turquoise', image: null, art: null } },
    // More TVs, so browser tests in different files can each set one up
    // at the same time (setting a TV up again signs its old sign-in out).
    den: { id: 'u_tv00000002', name: 'Den TV', role: 'kid', kind: 'tv', boardName: '', avatar: { icon: 'controller', color: 'pink', image: null, art: null } },
    kitchen: { id: 'u_tv00000003', name: 'Kitchen TV', role: 'kid', kind: 'tv', boardName: '', avatar: { icon: 'controller', color: 'gold', image: null, art: null } },
    playroom: { id: 'u_tv00000004', name: 'Playroom TV', role: 'kid', kind: 'tv', boardName: '', avatar: { icon: 'controller', color: 'teal', image: null, art: null } }
  };
  // The pictures, as ARKS ID serves them: real 1-pixel pictures, so a browser can draw them.
  const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const pictures = {
    '/avatars/u_kim0000001.webp': ['image/webp', WEBP],
    '/avatars/teams/faithful.png': ['image/png', PNG],
    // Says it's a picture but isn't one.
    '/avatars/u_fake000001.webp': ['image/webp', Buffer.from('<script>alert(1)</script>')]
  };
  const fake = { users, next: 'milo', deviceOwner: null, inbox: {}, sessions: new Map(), base: '', prefills: new Map(), lastPrefill: null, photoFetches: 0,
    // The feedback inbox (v10), and what the admin does in ARKS ID's console.
    notes: [], feedbackDown: false, inboxMissing: false,
    // Status reports and events for ARKS ID's admin console (v12).
    reports: [], events: [],
    // Switches and the banner (v13): the arcade's list of games, what the
    // admin set in the console (set[key] = { all, roles, people }), and the
    // banner showing.
    features: null, set: {}, banner: null,
    // TVs (v14): pairings waiting for an adult's phone (pollToken -> pairing),
    // adults' night per TV session, unlock codes showing, and every TV call.
    pairs: new Map(), pairInterval: 2, adult: new Map(), unlocks: new Map(), tvCalls: [],
    // Notifications (v15): each person's phones (user id -> subscriptions), every
    // send asked for, and pushDown to act like the push service can't be reached.
    pushSubs: {}, pushes: [], pushDown: false, pushKey: null,
    // An adult approves the code on their phone: the TV signs in as `tv`
    // (or as another TV account, by its key in users).
    approvePair(userCode, as = 'tv') {
      const p = [...fake.pairs.values()].find(x => x.userCode === userCode && x.status === 'pending');
      if (!p || !users[as] || users[as].kind !== 'tv') return false;
      p.status = 'approved';
      p.code = code();
      p.key = as;
      codes.set(p.code, as);
      return true;
    },
    // An adult (by: a key in users) unlocks adults' night from their phone.
    approveUnlock(userCode, by = 'alex') {
      const sessionId = fake.unlocks.get(userCode);
      if (!sessionId || !['admin', 'adult'].includes(users[by].role)) return false;
      fake.unlocks.delete(userCode);
      fake.adult.set(sessionId, { until: Date.now() + 30 * 60 * 1000, by: { id: users[by].id, name: users[by].name }, since: Date.now() });
      return true;
    },
    latest: { pair: null, unlock: null },
    adminReply(id, text) { fake.notes.find(n => n.id === id).replies.push({ id: 99, fromAdmin: true, name: 'Sam', body: text, at: Date.now() }); },
    setStage(id, stage) { fake.notes.find(n => n.id === id).stage = stage; } };
  const codes = new Map(), deviceCodes = new Map();
  // The real ARKS ID gives one browser the same session each time it signs in
  // (until that session ends), so the pretend one does too: a cookie on its own
  // /signin says which browser this is.
  const browserOfCode = new Map(), sessionOfBrowser = new Map();
  const tvAdult = sessionId => { const a = fake.adult.get(sessionId); return a && a.until > Date.now() ? a : null; };
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
      fake.lastPrefill = q.get('prefill') ? fake.prefills.get(q.get('prefill')) || 'unknown' : null;
      // Silent sign-in (v8) with nobody signed in: straight back, saying so.
      if (u.pathname === '/signin' && q.get('silent') === '1' && !fake.next) {
        const miss = new URL('/auth/callback', arcadeBase);
        miss.searchParams.set('error', 'signin_needed');
        miss.searchParams.set('return', q.get('return') || '/');
        if (q.get('state')) miss.searchParams.set('state', q.get('state'));
        return back(res, miss.href);
      }
      const c = code();
      // A browser test can sign one person in with the next sign-in someone taps (fake.once, set by
      // POST /test/next-once), without the silent sign-ins of other tests picking them up.
      const who = u.pathname === '/signin' && q.get('silent') !== '1' && fake.once ? fake.once : fake.next;
      if (who === fake.once) fake.once = null;
      if (u.pathname === '/signin') codes.set(c, who); else deviceCodes.set(c, fake.deviceOwner);
      let browser = (/(?:^|;\s*)fake_browser=([0-9a-f]{16})/.exec(req.headers.cookie || '') || [])[1];
      const fresh = !browser;
      if (fresh) browser = crypto.randomBytes(8).toString('hex');
      if (u.pathname === '/signin') browserOfCode.set(c, browser);
      const to = new URL('/auth/callback', arcadeBase);
      to.searchParams.set(u.pathname === '/signin' ? 'code' : 'device', c);
      to.searchParams.set('return', q.get('return') || '/');
      if (q.get('state')) to.searchParams.set('state', q.get('state'));
      if (fresh) res.setHeader('Set-Cookie', `fake_browser=${browser}; Path=/; HttpOnly`);
      return back(res, to.href);
    }
    // Its own sign-out page, where the arcade sends a browser after signing it out:
    // that browser's sign-ins end here too, so signing in again starts a new one.
    if (req.method === 'GET' && u.pathname === '/signout') {
      const browser = (/(?:^|;\s*)fake_browser=([0-9a-f]{16})/.exec(req.headers.cookie || '') || [])[1];
      if (browser) {
        for (const [who, id] of sessionOfBrowser) {
          if (!who.startsWith(`${browser} `)) continue;
          if (fake.sessions.has(id)) fake.sessions.get(id).valid = false;
          sessionOfBrowser.delete(who);
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><title>Signed out</title><p>Signed out.</p>');
    }
    if (req.method === 'GET' && pictures[u.pathname]) {
      fake.photoFetches++;
      const [type, body] = pictures[u.pathname];
      res.writeHead(200, { 'Content-Type': type });
      return res.end(body);
    }
    // For the browser tests, which can't reach this object: play the admin in
    // the sign-in service's console. POST /test/switches { set }.
    if (req.method === 'POST' && u.pathname === '/test/switches') { fake.set = (await readBody(req)).set || {}; return json(res, 200, { ok: true }); }
    // The same for TVs: the codes showing now, and an adult's phone saying yes.
    if (req.method === 'POST' && u.pathname === '/test/next-once') { fake.once = (await readBody(req)).as || null; return json(res, 200, { ok: true }); }
    if (req.method === 'GET' && u.pathname === '/test/tv') return json(res, 200, fake.latest);
    if (req.method === 'POST' && u.pathname === '/test/tv/approve') return json(res, 200, { ok: await readBody(req).then(b => fake.approvePair(b.userCode, b.as || 'tv')) });
    if (req.method === 'POST' && u.pathname === '/test/tv/unlock') { const b = await readBody(req); return json(res, 200, { ok: fake.approveUnlock(b.userCode, b.by || 'alex') }); }
    if (!u.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
    if (req.headers.authorization !== `Bearer ${secret}`) return json(res, 401, { error: 'no' });
    if (req.method === 'POST' && u.pathname === '/api/prefill') {
      const b = await readBody(req);
      const token = code();
      fake.prefills.set(token, { name: b.name, art: b.art });
      return json(res, 200, { prefill: token, expiresAt: Date.now() + 15 * 60 * 1000 });
    }
    if (req.method === 'POST' && u.pathname === '/api/token') {
      const b = await readBody(req);
      const key = codes.get(b.code);
      codes.delete(b.code);
      if (!key) return json(res, 400, { error: 'bad code' });
      // The same browser signing the same person in again gets the session it already has.
      const browser = browserOfCode.get(b.code);
      browserOfCode.delete(b.code);
      const known = browser ? sessionOfBrowser.get(`${browser} ${key}`) : null;
      const sessionId = known && (fake.sessions.get(known) || {}).valid ? known : 's_' + crypto.randomBytes(12).toString('hex');
      if (browser) sessionOfBrowser.set(`${browser} ${key}`, sessionId);
      // Signing a TV in again ends its old sign-in (and any adults' night).
      if (users[key].kind === 'tv') for (const [id, s] of fake.sessions) if (s.key === key) { s.valid = false; fake.adult.delete(id); }
      fake.sessions.set(sessionId, { key, valid: true });
      const tvPart = users[key].kind === 'tv' ? { adultMode: null } : {};
      return json(res, 200, { user: { ...users[key], device: 'personal' }, sessionId, expiresAt: Date.now() + 15 * 864e5, ...tvPart });
    }
    let m = /^\/api\/session\/(s_[0-9a-f]+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) {
      const s = fake.sessions.get(m[1]);
      if (!s || !s.valid) return json(res, 200, { valid: false });
      const tvPart = users[s.key].kind === 'tv' ? { adultMode: tvAdult(m[1]) } : {};
      return json(res, 200, { valid: true, user: { ...users[s.key], device: 'personal' }, expiresAt: Date.now() + 15 * 864e5, ...tvPart });
    }
    // TVs (contract v14): the pairing code sign-in.
    if (req.method === 'POST' && u.pathname === '/api/tv/pair') {
      const pollToken = crypto.randomBytes(32).toString('base64url');
      const userCode = Array.from({ length: 6 }, () => 'BCDFGHJKLMNPQRSTVWXZ'[crypto.randomInt(20)]).join('');
      fake.pairs.set(pollToken, { userCode, status: 'pending', code: null, lastPoll: 0, interval: fake.pairInterval });
      fake.latest.pair = userCode;
      fake.tvCalls.push('pair');
      return json(res, 200, { userCode, pairUrl: `${fake.base}/tv/${userCode}`, enterUrl: `${fake.base}/tv`, pollToken, expiresIn: 600, interval: fake.pairInterval });
    }
    if (req.method === 'POST' && u.pathname === '/api/tv/pair/poll') {
      const p = fake.pairs.get((await readBody(req)).pollToken);
      fake.tvCalls.push('poll');
      if (!p || p.status === 'done') return json(res, 200, { status: 'expired' });
      const early = Date.now() - p.lastPoll < p.interval * 1000 - 300;
      p.lastPoll = Date.now();
      if (p.status === 'approved') { p.status = 'done'; return json(res, 200, { status: 'approved', code: p.code, tv: { id: users[p.key].id, name: users[p.key].name } }); }
      if (early) { p.interval += 5; return json(res, 200, { status: 'slow_down', interval: p.interval, expiresAt: Date.now() + 600000 }); }
      return json(res, 200, { status: 'pending', interval: p.interval, expiresAt: Date.now() + 600000 });
    }
    // Adults' night: an unlock code, games being played, and Back to family.
    if (req.method === 'POST' && ['/api/tv/unlock', '/api/app/tv/activity', '/api/app/tv/lock'].includes(u.pathname)) {
      const b = await readBody(req);
      const s = fake.sessions.get(b.session);
      if (!s || !s.valid) return json(res, 401, { error: 'That session isn\'t valid.' });
      if (users[s.key].kind !== 'tv') return json(res, 400, { error: 'That\'s a person\'s session, not a TV\'s.' });
      fake.tvCalls.push(u.pathname);
      if (u.pathname === '/api/tv/unlock') {
        for (const [c, sid] of fake.unlocks) if (sid === b.session) fake.unlocks.delete(c);
        const userCode = Array.from({ length: 6 }, () => 'BCDFGHJKLMNPQRSTVWXZ'[crypto.randomInt(20)]).join('');
        fake.unlocks.set(userCode, b.session);
        fake.latest.unlock = userCode;
        return json(res, 200, { userCode, unlockUrl: `${fake.base}/tv/${userCode}`, enterUrl: `${fake.base}/tv`, expiresIn: 600, adultMode: tvAdult(b.session) });
      }
      if (u.pathname === '/api/app/tv/lock') { fake.adult.delete(b.session); return json(res, 200, { ok: true, adultMode: null }); }
      const a = tvAdult(b.session);
      if (a) a.until = Date.now() + 30 * 60 * 1000;
      return json(res, 200, { ok: true, adultMode: a });
    }
    if (req.method === 'POST' && u.pathname === '/api/device') {
      const b = await readBody(req);
      if (!deviceCodes.has(b.code)) return json(res, 400, { error: 'bad code' });
      const owner = deviceCodes.get(b.code);
      deviceCodes.delete(b.code);
      return json(res, 200, owner ? { known: true, owner: { id: users[owner].id, name: users[owner].name, role: users[owner].role } } : { known: false, owner: null });
    }
    // Notifications (v15).
    if (req.method === 'GET' && u.pathname === '/api/app/push/key') return json(res, 200, { publicKey: fake.pushKey || 'B' + 'A'.repeat(86) });
    if (req.method === 'POST' && ['/api/app/push/subscribe', '/api/app/push/unsubscribe'].includes(u.pathname)) {
      const b = await readBody(req);
      const s = fake.sessions.get(b.session);
      if (!s || !s.valid || users[s.key].kind === 'tv') return json(res, 401, { error: "That sign-in isn't one this app holds." });
      const id = users[s.key].id, list = fake.pushSubs[id] = fake.pushSubs[id] || [];
      if (u.pathname.endsWith('/unsubscribe')) { fake.pushSubs[id] = b.endpoint ? list.filter(x => x.endpoint !== b.endpoint) : []; return json(res, 200, { ok: true }); }
      if (!b.subscription || !/^https:\/\/fcm\.googleapis\.com\//.test(b.subscription.endpoint || '')) return json(res, 400, { error: "That isn't a push address." });
      if (!list.some(x => x.endpoint === b.subscription.endpoint)) list.push(b.subscription);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/app/push/send') {
      const b = await readBody(req);
      fake.pushes.push(b);
      if (fake.pushDown) return json(res, 500, { error: 'down' });
      return json(res, 200, { sent: (fake.pushSubs[b.to] || []).length });
    }
    // v16: a new #1 for Discord's #trophies channel.
    if (req.method === 'POST' && u.pathname === '/api/app/discord/trophy') { (fake.trophies = fake.trophies || []).push(await readBody(req)); return json(res, 200, { posted: true }); }
    if (req.method === 'POST' && u.pathname === '/api/clips') {
      const b = await readBody(req);
      const keys = b.to === 'everyone' ? Object.keys(users) : Object.keys(users).filter(k => users[k].id === b.to);
      if (!keys.length) return json(res, 400, { error: 'nobody' });
      keys.forEach(k => { (fake.inbox[k] = fake.inbox[k] || []).push(b.clip); });
      return json(res, 200, { sent: keys.length });
    }
    // Status reports and events (contract v12).
    if (req.method === 'POST' && u.pathname === '/api/app/status') {
      fake.reports.push(await readBody(req));
      return json(res, 200, { ok: true, every: 300 });
    }
    if (req.method === 'POST' && u.pathname === '/api/app/event') {
      const b = await readBody(req);
      if (b.kind !== 'console-opened') return json(res, 400, { error: 'kind has to be console-opened.' });
      fake.events.push(b);
      return json(res, 201, { ok: true });
    }
    // Switches and the banner (contract v13).
    if (req.method === 'PUT' && u.pathname === '/api/app/features') {
      fake.features = (await readBody(req)).features;
      return json(res, 200, { ok: true, count: fake.features.length });
    }
    if (req.method === 'GET' && u.pathname === '/api/app/switches') {
      const s = fake.sessions.get(q.get('session'));
      const user = s && s.valid ? users[s.key] : null;
      const switches = {}, decided = [];
      for (const f of fake.features || []) {
        const st = fake.set[f.key] || {};
        const own = user && (st.people || {})[user.id];
        const role = user ? user.role : 'guest';
        const roleSet = typeof (st.roles || {})[role] === 'boolean';
        if (own) { switches[f.key] = own === 'on'; decided.push(f.key); continue; }
        const all = typeof st.all === 'boolean' ? st.all : f.on;
        switches[f.key] = !!(all && (roleSet ? st.roles[role] : f.roles[role]));
        if (typeof st.all === 'boolean' || roleSet) decided.push(f.key);
      }
      return json(res, 200, { switches, decided, signedIn: !!user });
    }
    if (req.method === 'GET' && u.pathname === '/api/app/banner') return json(res, 200, { banner: fake.banner });
    // The one feedback inbox (contract v10). feedbackDown answers 503 (the
    // arcade keeps the note in its queue); inboxMissing answers 404, like an
    // ARKS ID older than v10 (the arcade keeps the note itself).
    if (u.pathname === '/api/app/feedback' || u.pathname.startsWith('/api/app/feedback/')) {
      if (fake.inboxMissing) return json(res, 404, { error: 'Not found.' });
      if (fake.feedbackDown) return json(res, 503, { error: 'down' });
      const b = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const route = u.pathname.slice('/api/app/feedback'.length);
      if (req.method === 'POST' && route === '') {
        const dup = fake.notes.find(n => n.appRef === b.appRef);
        if (dup) return json(res, 200, { id: dup.id, duplicate: true });
        const n = { id: fake.notes.length + 1, kind: b.kind, body: b.body, picture: !!b.picture, details: b.details, person: b.person,
          appRef: b.appRef, stage: 'new', replies: [], at: Date.now(), editedAt: null, hidden: false };
        fake.notes.push(n);
        return json(res, 201, { id: n.id });
      }
      const s = fake.sessions.get(req.method === 'GET' || req.method === 'DELETE' ? q.get('session') : b.session);
      if (!s || !s.valid) return json(res, 401, { error: 'Sign in again to see your feedback.' });
      const uid = users[s.key].id;
      const closed = n => ['fixed', 'wontfix'].includes(n.stage);
      const view = (n, full) => ({ id: n.id, kind: n.kind, body: n.body, at: n.at, editedAt: n.editedAt, stage: n.stage, closed: closed(n),
        picture: n.picture, app: 'arcade', appName: 'Arcade', replyCount: n.replies.length, ...(full ? { replies: n.replies } : {}) });
      if (req.method === 'GET' && route === '') {
        const archive = q.get('view') === 'archive';
        return json(res, 200, { items: fake.notes.filter(n => n.person && n.person.user === uid && !n.hidden && closed(n) === archive).reverse().map(n => view(n)) });
      }
      const fm = /^\/(\d+)(\/replies)?$/.exec(route);
      const n = fm && fake.notes.find(x => x.id === Number(fm[1]) && x.person && x.person.user === uid && !x.hidden);
      if (!n) return json(res, 404, { error: "That feedback isn't there anymore." });
      if (req.method === 'GET') return json(res, 200, { thread: view(n, true) });
      if (req.method === 'PUT') {
        if (closed(n)) return json(res, 409, { error: "That one is closed already, so it can't be changed. Send a new one instead." });
        n.body = b.body; n.editedAt = Date.now();
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && fm[2]) { n.replies.push({ id: n.replies.length + 1, fromAdmin: false, name: users[s.key].name, body: b.body, at: Date.now() }); return json(res, 201, { ok: true }); }
      if (req.method === 'DELETE') { n.hidden = true; return json(res, 200, { ok: true }); }
      return json(res, 404, { error: 'Not found.' });
    }
    m = /^\/api\/clips\/(s_[0-9a-f]+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) {
      const s = fake.sessions.get(m[1]);
      return json(res, 200, { clip: s && s.valid ? (fake.inbox[s.key] || []).shift() || null : null });
    }
    json(res, 404, { error: 'Not found.' });
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    fake.base = `http://127.0.0.1:${server.address().port}`;
    users.kim.avatar.image = `${fake.base}/avatars/u_kim0000001.webp?v=2`;
    fake.close = () => server.close();
    resolve(fake);
  }));
}

module.exports = { startFakeArksId };
