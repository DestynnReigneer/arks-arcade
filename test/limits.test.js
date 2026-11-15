'use strict';

// Limits last as long as a server does, so the tests that use one up run on a
// server of their own, after everything else. A limit used up here can't make
// a test somewhere else wait.
//
// Every lobby that takes a password limits how often one address can try it,
// so nobody can sit and guess an adult lobby's password.

async function run({ base }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  async function api(p, method = 'GET', body, headers = {}) {
    const res = await fetch(base + p, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const PIN = { 'X-Adult-Pin': '246810' };

  console.log('\n-- limits: guessing a lobby password --');
  // Each game's adult lobby, made the way its page makes it.
  const games = [
    ['Rambler', 'rambler', { name: 'Host', profile: 'adult', password: 'limes' }],
    ['Shuffle Scuffle', 'scuffle', { name: 'Host', settings: { dictionary: 'adult' }, password: 'limes' }],
    ['Know-It-All', 'trivia', { name: 'Host', settings: { level: 'spicy', count: 5, style: 'together' }, password: 'limes' }],
    ['Uh-Oh: Part Deux', 'partdeux', { name: 'Host', level: 'spicy', password: 'limes' }],
    ['Dare Devil', 'daredevil', { name: 'Host', level: 'spicy', password: 'limes' }]
  ];
  for (const [name, game, lobby] of games) {
    const made = await api(`/api/${game}/rooms`, 'POST', lobby, PIN);
    const code = made.data && made.data.code;
    const join = password => api(`/api/${game}/rooms/${code}/join`, 'POST', { name: 'Guest', password });
    const tries = [];
    for (let k = 0; k < 70; k++) tries.push((await join(`wrong${k}`)).status);
    const stopped = tries.indexOf(429);
    ok(`${name}: a wrong lobby password is refused, and after enough of them the address has to wait`,
      made.status === 201 && !!code && tries[0] === 401 && stopped > 0 && stopped <= 60 &&
      tries.slice(0, stopped).every(s => s === 401) && tries.slice(stopped).every(s => s === 429),
      `made ${made.status}, first wait at try ${stopped + 1}, answers ${[...new Set(tries)].join()}`);
    const right = await join('limes');
    ok('…and then the right password waits too, with a line that says so',
      right.status === 429 && typeof right.data.error === 'string' && right.data.error.length > 0, JSON.stringify(right.data));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
