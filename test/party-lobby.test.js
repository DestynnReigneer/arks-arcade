'use strict';

// The party card games' lobby (Uh-Oh: Part Deux and Dare Devil share it):
// who can join, the list, one seat per profile, Ready, the chat, the host's
// Mute and Remove Player, and the host turning a family lobby adult (which
// moves out everyone the arcade doesn't know to be an adult).

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
    await api(`${room(host.code)}/lobby-ready`, 'POST', { ...seat(bob), ready: true });
    const s = (await view(game, host.code, host)).data;
    ok('Ready shows for the host', s.allReady === true);
    await api(`${room(host.code)}/remove`, 'POST', { ...seat(host), seat: bob.playerId });
    ok('the host can remove a player, whose seat stops working', (await api(`${room(host.code)}/chat`, 'POST', { ...seat(bob), text: 'still here?' })).status === 403);
    ok('…and who\'s gone from the lobby', !(await view(game, host.code, host)).data.players.some(p => p.id === bob.playerId));
    ok('…and the chat says so in the words the player sees', (await view(game, host.code, host)).data.chat.some(m => m.system && /Bob was removed from the lobby/.test(m.text)));

    // It's the host's lobby, so the host can turn it adult with people in it. This arcade
    // has no ARKS ID sign-in, so nobody is known to be an adult: everyone else is moved out,
    // with the players they added on their own device, and can come back with the password.
    console.log(`\n-- ${game}: the host turns a family lobby adult --`);
    const fam = (await api(`/${game}/rooms`, 'POST', { name: 'Ann', level: 'kids' }, Ann.h)).data;
    const calIn = (await api(`${room(fam.code)}/join`, 'POST', { name: 'Cal' }, Cal.h)).data;
    const gusIn = (await api(`${room(fam.code)}/join`, 'POST', { name: 'Gus' })).data;
    await api(`${room(fam.code)}/seats`, 'POST', { ...seat(gusIn), name: 'Gus Jr' });
    const asAdult = { 'X-Adult-Pin': '246810' };
    ok('without a lobby password the switch is refused, and nobody moves',
      (await api(`${room(fam.code)}/settings`, 'POST', { ...seat(fam), level: 'filthy' }, asAdult)).status === 400 &&
      (await view(game, fam.code, fam)).data.players.length === 4);
    ok('someone who isn\'t the host can\'t switch it', (await api(`${room(fam.code)}/settings`, 'POST', { ...seat(calIn), level: 'filthy', password: 'lime' }, asAdult)).status === 403);
    ok('the host can\'t either without being allowed adult levels', (await api(`${room(fam.code)}/settings`, 'POST', { ...seat(fam), level: 'filthy', password: 'lime' })).status === 403 &&
      (await view(game, fam.code, fam)).data.players.length === 4);
    const turned = await api(`${room(fam.code)}/settings`, 'POST', { ...seat(fam), level: 'filthy', password: 'lime' }, asAdult);
    ok('the host turns a family lobby adult with people in it', turned.status === 200, JSON.stringify(turned.data));
    const now = (await view(game, fam.code, fam)).data;
    ok('…and everyone else is moved out, with the players on their device', now.players.length === 1 && now.players[0].id === fam.playerId, JSON.stringify(now.players.map(p => p.name)));
    ok('…their seats stop working', (await api(`${room(fam.code)}/chat`, 'POST', { ...seat(calIn), text: 'hello?' })).status === 403 &&
      (await view(game, fam.code, gusIn)).status === 403);
    ok('…the chat says who was moved out and why', now.chat.some(m => m.system && /Cal, Gus and Gus Jr were moved out, because the host switched to an adult level/.test(m.text)), JSON.stringify(now.chat.slice(-2)));
    ok('…the lobby is locked', now.locked === true && (await api(`/${game}/lobbies`)).data.lobbies.find(l => l.code === fam.code).locked === true);
    ok('…and coming back takes the lobby password', (await api(`${room(fam.code)}/join`, 'POST', { name: 'Gus' })).status === 401 &&
      (await api(`${room(fam.code)}/join`, 'POST', { name: 'Gus', password: 'lime' })).status === 201);
    ok('switching back to a family level moves nobody', (await api(`${room(fam.code)}/settings`, 'POST', { ...seat(fam), level: 'kids' })).status === 200 &&
      (await view(game, fam.code, fam)).data.players.length === 2);
    await api(`${room(fam.code)}/leave`, 'POST', seat(fam));

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
