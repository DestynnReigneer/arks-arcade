'use strict';

// The party card games' lobby (Uh-Oh: Part Deux and Dare Devil share it):
// who can join, the list, one seat per profile, Ready, the chat, the host's
// Mute and Remove Player, and a family lobby staying family once people join.

async function run({ base }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  async function api(p, method = 'GET', body, headers = {}) {
    const res = await fetch(base + '/api' + p, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  const people = {};
  for (const name of ['Ann', 'Bob', 'Cal']) {
    const asked = await api('/profiles', 'POST', { name: `Party ${name}`, avatar: 'shiba:1' });
    await api(`/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
    const used = await api(`/profiles/${asked.data.id}/use`, 'POST', {});
    people[name] = { id: asked.data.id, h: { 'X-Profile-Token': used.data.token } };
  }
  const { Ann, Bob, Cal } = people;
  const seat = t => ({ playerId: t.playerId, token: t.token });
  const view = (game, code, who) => api(`/${game}/rooms/${code}?playerId=${who.playerId}&token=${who.token}`);

  for (const game of ['partdeux', 'daredevil']) {
    const room = code => `/${game}/rooms/${code}`;
    console.log(`\n-- ${game}: who can join --`);
    const host = (await api(`/${game}/rooms`, 'POST', { name: 'Ann', level: 'kids', who: 'selected', allowed: [Bob.id] }, Ann.h)).data;
    ok('a lobby for only the people picked is made', !!host.code, JSON.stringify(host).slice(0, 200));
    const listed = async h => (await api(`/${game}/lobbies`, 'GET', null, h)).data.lobbies.some(l => l.code === host.code);
    ok('the person picked sees it in List Hosted Games', await listed(Bob.h));
    ok('…someone who wasn\'t picked doesn\'t', !(await listed(Cal.h)));
    ok('…and neither does a guest', !(await listed({})));
    ok('…nor the home page\'s Join a game list for them', !(await api('/lobby', 'GET', null, Cal.h)).data.rooms.some(r => r.code === host.code));
    ok('someone who wasn\'t picked can\'t join', (await api(`${room(host.code)}/join`, 'POST', { name: 'Cal' }, Cal.h)).status === 403);
    const lobbyRow = (await api(`/${game}/lobbies`, 'GET', null, Bob.h)).data.lobbies.find(l => l.code === host.code);
    ok('the list never shows a password, token or the people picked', !JSON.stringify(lobbyRow).match(/token|password|allowed/i));
    const bob = (await api(`${room(host.code)}/join`, 'POST', { name: 'Bob' }, Bob.h)).data;
    ok('the person picked joins', !!bob.playerId);
    const again = (await api(`${room(host.code)}/join`, 'POST', { name: 'Bob' }, Bob.h)).data;
    ok('joining again with the same profile gets the same seat, not a second one', again.playerId === bob.playerId);

    console.log(`\n-- ${game}: Ready, the chat, Mute and Remove --`);
    ok('the host can\'t start until everyone is ready', (await api(`${room(host.code)}/start`, 'POST', seat(host))).status === 409);
    ok('someone else can\'t mute', (await api(`${room(host.code)}/mute`, 'POST', { ...seat(bob), seat: host.playerId, on: true })).status === 403);
    ok('…or remove', (await api(`${room(host.code)}/remove`, 'POST', { ...seat(bob), seat: host.playerId })).status === 403);
    ok('a player can chat', (await api(`${room(host.code)}/chat`, 'POST', { ...seat(bob), text: 'deal me in' })).status === 200);
    await api(`${room(host.code)}/mute`, 'POST', { ...seat(host), seat: bob.playerId, on: true });
    ok('a muted player\'s chat is refused', (await api(`${room(host.code)}/chat`, 'POST', { ...seat(bob), text: 'hey' })).status === 403);
    await api(`${room(host.code)}/mute`, 'POST', { ...seat(host), seat: bob.playerId, on: false });
    ok('the family lobby can\'t turn adult once someone has joined',
      (await api(`${room(host.code)}/settings`, 'POST', { ...seat(host), level: 'filthy', password: 'lime' }, { 'X-Adult-Pin': '246810' })).status === 409);
    await api(`${room(host.code)}/lobby-ready`, 'POST', { ...seat(bob), ready: true });
    const s = (await view(game, host.code, host)).data;
    ok('Ready shows for the host', s.allReady === true);
    await api(`${room(host.code)}/remove`, 'POST', { ...seat(host), seat: bob.playerId });
    ok('the host can remove a player, whose seat stops working', (await api(`${room(host.code)}/chat`, 'POST', { ...seat(bob), text: 'still here?' })).status === 403);
    ok('…and who\'s gone from the lobby', !(await view(game, host.code, host)).data.players.some(p => p.id === bob.playerId));

    console.log(`\n-- ${game}: an adult lobby --`);
    const adult = (await api(`/${game}/rooms`, 'POST', { name: 'Ann', level: 'filthy', password: 'lime' }, { ...Ann.h, 'X-Adult-Pin': '246810' })).data;
    ok('an adult lobby still needs its password to join', (await api(`${room(adult.code)}/join`, 'POST', { name: 'Cal' }, Cal.h)).status === 401);
    ok('…and lets someone in with it', !!(await api(`${room(adult.code)}/join`, 'POST', { name: 'Cal', password: 'lime' }, Cal.h)).data.playerId);
    await api(`${room(adult.code)}/leave`, 'POST', seat(adult));
    await api(`${room(host.code)}/leave`, 'POST', seat(host));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
