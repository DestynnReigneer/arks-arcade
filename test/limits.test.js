'use strict';

// Limits last as long as a server does, so the tests that use one up run on a
// server of their own, after everything else. A limit used up here can't make
// a test somewhere else wait.
//
// Every lobby limits how often one address can try to join, so nobody can
// hammer a game's join route.

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

  console.log('\n-- limits: joining over and over --');
  for (const [name, game] of [['Rambler', 'rambler'], ['Shuffle Scuffle', 'scuffle'], ['Know-It-All', 'trivia'], ['Uh-Oh: Part Deux', 'partdeux'], ['Dare Devil', 'daredevil']]) {
    const tries = [];
    for (let k = 0; k < 70; k++) tries.push((await api(`/api/${game}/rooms/ZZZZ/join`, 'POST', { name: 'Guest' })).status);
    const stopped = tries.indexOf(429);
    ok(`${name}: after enough tries at joining, the address has to wait`,
      stopped > 0 && stopped <= 60 && tries.slice(stopped).every(s => s === 429), `first wait at try ${stopped + 1}, answers ${[...new Set(tries)].join()}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
