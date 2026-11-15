'use strict';

// The party card games' lobby (Uh-Oh: Part Deux and Dare Devil share it):
// the list everyone sees, one seat per profile, Ready, the chat, the host's
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
    console.log(`\n-- ${game}: a lobby is open to anyone, and found in the lists --`);
    // A page that still sends the old "only these people" choice gets an ordinary lobby.
    const host = (await api(`/${game}/rooms`, 'POST', { name: 'Ann', level: 'kids', who: 'selected', allowed: [Bob.id] }, Ann.h)).data;
    ok('a lobby is made', !!host.code, JSON.stringify(host).slice(0, 200));
    const listed = async h => (await api(`/${game}/lobbies`, 'GET', null, h)).data.lobbies.some(l => l.code === host.code);
    ok('everyone sees it in List Hosted Games: other profiles, and a guest', (await listed(Bob.h)) && (await listed(Cal.h)) && (await listed({})));
    ok('…and in the home page\'s list of lobbies', (await api('/lobby', 'GET', null, Cal.h)).data.rooms.some(r => r.code === host.code) &&
      (await api('/lobby')).data.rooms.some(r => r.code === host.code));
    const lobbyRow = (await api(`/${game}/lobbies`, 'GET', null, Bob.h)).data.lobbies.find(l => l.code === host.code);
    ok('the list never shows a password or a token, and has nothing about who may join', !JSON.stringify(lobbyRow).match(/token|password|allowed|"who"/i));
    const cal = (await api(`${room(host.code)}/join`, 'POST', { name: 'Cal' }, Cal.h)).data;
    ok('someone the host never named joins', !!cal.playerId);
    await api(`${room(host.code)}/leave`, 'POST', seat(cal));
    const bob = (await api(`${room(host.code)}/join`, 'POST', { name: 'Bob' }, Bob.h)).data;
    ok('and so does anyone else', !!bob.playerId);
    ok('there is no list of people to pick from, and no lobbies only for one person',
      (await api('/invites/people', 'GET', null, Ann.h)).status === 404 && (await api('/invites', 'GET', null, Bob.h)).status === 404);
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
    ok('…and the chat says so in the words the player sees', (await view(game, host.code, host)).data.chat.some(m => m.system && /Bob was removed\.$/.test(m.text)));

    // It's the host's lobby, so the host can turn it adult with people in it. Anyone can play an
    // adult game but a kid's or a teen's device, and this arcade has no ARKS ID to know one, so
    // everyone stays, and nobody types a password.
    console.log(`
-- ${game}: the host turns a family lobby adult --`);
    const fam = (await api(`/${game}/rooms`, 'POST', { name: 'Ann', level: 'kids' }, Ann.h)).data;
    const calIn = (await api(`${room(fam.code)}/join`, 'POST', { name: 'Cal' }, Cal.h)).data;
    const gusIn = (await api(`${room(fam.code)}/join`, 'POST', { name: 'Gus' })).data;
    await api(`${room(fam.code)}/seats`, 'POST', { ...seat(gusIn), name: 'Gus Jr' });
    const asAdult = { 'X-Adult-Pin': '246810' };
    ok("someone who isn't the host can't switch it", (await api(`${room(fam.code)}/settings`, 'POST', { ...seat(calIn), level: 'filthy' }, asAdult)).status === 403);
    ok("the host can't either without the adult pass", (await api(`${room(fam.code)}/settings`, 'POST', { ...seat(fam), level: 'filthy' })).status === 403 &&
      (await view(game, fam.code, fam)).data.players.length === 4);
    const turned = await api(`${room(fam.code)}/settings`, 'POST', { ...seat(fam), level: 'filthy' }, asAdult);
    ok('the host turns a family lobby adult with people in it, no password asked', turned.status === 200, JSON.stringify(turned.data));
    const now = (await view(game, fam.code, fam)).data;
    ok('…and everyone stays', now.players.length === 4, JSON.stringify(now.players.map(p => p.name)));
    ok("…and the lobby isn't locked", !now.locked && !(await api(`/${game}/lobbies`)).data.lobbies.find(l => l.code === fam.code).locked);
    ok('switching back to a family level moves nobody', (await api(`${room(fam.code)}/settings`, 'POST', { ...seat(fam), level: 'kids' })).status === 200 &&
      (await view(game, fam.code, fam)).data.players.length === 4);
    await api(`${room(fam.code)}/leave`, 'POST', seat(fam));

    console.log(`
-- ${game}: an adult lobby --`);
    const adult = (await api(`/${game}/rooms`, 'POST', { name: 'Ann', level: 'filthy' }, { ...Ann.h, 'X-Adult-Pin': '246810' })).data;
    ok('someone joins an adult lobby with nothing to type', !!(await api(`${room(adult.code)}/join`, 'POST', { name: 'Cal' }, Cal.h)).data.playerId);
    await api(`${room(adult.code)}/leave`, 'POST', seat(adult));
    await api(`${room(host.code)}/leave`, 'POST', seat(host));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
