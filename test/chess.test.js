'use strict';

// Chess on two phones with the lobby: hosting, inviting people by name, the
// Invites row, the lobby only the host can change, starting, the chat and its
// family filter, muting, leaving, a seat following its profile to another
// device, and the Continue row.

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
  for (const name of ['Sam', 'Milo', 'Kim']) {
    const asked = await api('/profiles', 'POST', { name: `Chess ${name}`, avatar: 'shiba:1' });
    await api(`/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
    const used = await api(`/profiles/${asked.data.id}/use`, 'POST', {});
    people[name] = { id: asked.data.id, h: { 'X-Profile-Token': used.data.token } };
  }
  const { Sam, Milo, Kim } = people;
  const seat = t => ({ playerId: t.playerId, token: t.token });
  const room = code => `/chess/rooms/${code}`;

  console.log('\n-- chess: the lobby --');
  const host = (await api('/chess/rooms', 'POST', { color: 'w' }, Sam.h)).data;
  const code = host.code;
  let s = (await api(`${room(code)}?playerId=${host.playerId}&token=${host.token}`)).data;
  ok('a new room waits in its lobby, with the host in it', s.phase === 'lobby' && s.host && s.seats.length === 1 && s.seats[0].name === 'Chess Sam');
  ok('the host can\'t start alone', (await api(`${room(code)}/start`, 'POST', seat(host))).status === 409);

  console.log('\n-- chess: invites --');
  ok('the people you can invite are everyone but you',
    (await api('/invites/people', 'GET', null, Sam.h)).data.people.some(p => p.id === Milo.id) &&
    !(await api('/invites/people', 'GET', null, Sam.h)).data.people.some(p => p.id === Sam.id));
  ok('…and only for someone with a profile', (await api('/invites/people')).status === 401);
  const sent = await api(`${room(code)}/invite`, 'POST', { ...seat(host), to: [Milo.id, Kim.id] });
  ok('the host invites people by name', sent.status === 200 && sent.data.sent.length === 2 && sent.data.state.invited.length === 2);
  const miloInv = (await api('/invites', 'GET', null, Milo.h)).data.invites;
  ok('the invite shows in their Invites row, with a link to the lobby',
    miloInv.length === 1 && miloInv[0].game === 'chess' && miloInv[0].href === `chess.html?room=${code}` && /Chess Sam is waiting/.test(miloInv[0].detail));
  ok('nobody else sees it', !(await api('/invites', 'GET', null, Sam.h)).data.invites.length && !(await api('/invites')).data.invites.length);

  // Milo joins straight from the invite, with no code to type.
  const milo = (await api(`${room(code)}/join`, 'POST', {}, Milo.h)).data;
  ok('joining with a profile takes its name', milo.playerId && milo.color === null);
  ok('the invite goes away once Milo is in', !(await api('/invites', 'GET', null, Milo.h)).data.invites.length);
  ok('Kim\'s invite closes once the lobby is full', !(await api('/invites', 'GET', null, Kim.h)).data.invites.length);
  ok('a third player is turned away', (await api(`${room(code)}/join`, 'POST', { name: 'Alex' })).status === 409);

  console.log('\n-- chess: only the host changes the lobby --');
  ok('a player who isn\'t the host can\'t change the color', (await api(`${room(code)}/settings`, 'POST', { ...seat(milo), color: 'b' })).status === 403);
  ok('…or start the game', (await api(`${room(code)}/start`, 'POST', seat(milo))).status === 403);
  s = (await api(`${room(code)}/settings`, 'POST', { ...seat(host), color: 'b' })).data;
  ok('the host can', s.settings.color === 'b');
  s = (await api(`${room(code)}?playerId=${milo.playerId}&token=${milo.token}`)).data;
  ok('the player sees the setting, and that they aren\'t the host', s.settings.color === 'b' && !s.host && s.hostName === 'Chess Sam');

  console.log('\n-- chess: the chat --');
  const say = (who, text) => api(`${room(code)}/chat`, 'POST', { ...seat(who), text });
  ok('a player can chat in the lobby', (await say(milo, 'I\'m gonna win 😎')).status === 200);
  await say(host, 'well shit, we\'ll see about that');
  s = (await api(`${room(code)}?playerId=${host.playerId}&token=${host.token}`)).data;
  const lines = s.chat.filter(m => !m.system);
  ok('everyone in the room sees it, marked as theirs or not', lines.length === 2 && !lines[0].mine && lines[1].mine && lines[0].name === 'Chess Milo');
  ok('the family filter stars out rude words', lines[1].text === 'well s***, we\'ll see about that', lines[1].text);
  ok('it notes who joined', s.chat.some(m => m.system && m.text === 'Chess Milo joined'));
  ok('an empty message is refused', (await say(milo, '   ')).status === 400);
  ok('a stranger can\'t chat in the room', (await api(`${room(code)}/chat`, 'POST', { playerId: milo.playerId, token: 'nope', text: 'hi' })).status === 403);
  ok('a player who isn\'t the host can\'t mute', (await api(`${room(code)}/mute`, 'POST', { ...seat(milo), seat: host.playerId, on: true })).status === 403);
  s = (await api(`${room(code)}/mute`, 'POST', { ...seat(host), seat: milo.playerId, on: true })).data;
  ok('the host can mute someone', s.seats.find(x => x.id === milo.playerId).muted);
  ok('…and their messages don\'t go out', (await say(milo, 'hello?')).status === 403);
  await api(`${room(code)}/mute`, 'POST', { ...seat(host), seat: milo.playerId, on: false });
  ok('…until the host turns it off', (await say(milo, 'I\'m back')).status === 200);
  let burst = 0;
  for (let i = 0; i < 6; i++) if ((await say(milo, `spam ${i}`)).status === 429) burst++;
  ok('five messages in ten seconds is the most', burst >= 1);

  console.log('\n-- chess: playing --');
  ok('moves wait for the game to start', (await api(`${room(code)}/move`, 'POST', { ...seat(host), from: 'e2', to: 'e4' })).status === 409);

  console.log('\n-- chess: ready, then start --');
  s = (await api(`${room(code)}?playerId=${host.playerId}&token=${host.token}`)).data;
  ok('the host is always ready, whoever joins starts out not ready', s.seats.find(x => x.host).ready === true &&
    s.seats.find(x => !x.host).ready === false && s.allReady === false);
  ok('the host can\'t start until everyone is ready', (await api(`${room(code)}/start`, 'POST', seat(host))).status === 409);
  s = (await api(`${room(code)}/ready`, 'POST', { ...seat(milo), ready: true })).data;
  ok('tapping Ready marks the seat ready', s.seats.find(x => !x.host).ready === true && s.allReady === true);
  s = (await api(`${room(code)}/ready`, 'POST', { ...seat(milo), ready: false })).data;
  ok('…and tapping it again takes it back', s.allReady === false);
  await api(`${room(code)}/ready`, 'POST', { ...seat(milo), ready: true });
  s = (await api(`${room(code)}/start`, 'POST', seat(host))).data;
  ok('the host starts it, with the color they chose', s.phase === 'playing' && s.you === 'b' && s.players.w.name === 'Chess Milo');
  const move = (who, from, to) => api(`${room(code)}/move`, 'POST', { ...seat(who), from, to });
  ok('White (Milo) moves first', (await move(milo, 'e2', 'e4')).status === 200);
  ok('nobody can join once it started', (await api(`${room(code)}/join`, 'POST', { name: 'Alex' })).status === 409);

  console.log('\n-- chess: your seat follows you --');
  const other = (await api(`${room(code)}/seat`, 'POST', {}, Sam.h)).data;
  ok('Sam on another device gets the same seat', other.playerId === host.playerId && other.color === 'b');
  ok('joining again with a profile gives back the same seat too', (await api(`${room(code)}/join`, 'POST', {}, Sam.h)).data.playerId === host.playerId);
  ok('someone without a seat there gets none', (await api(`${room(code)}/seat`, 'POST', {}, Kim.h)).status === 404);
  ok('…and a seat needs a profile', (await api(`${room(code)}/seat`, 'POST', {})).status === 401);

  console.log('\n-- chess: the Continue row --');
  const cont = who => api('/continue', 'GET', null, who.h).then(r => (r.data.games || []).filter(g => g.game === 'chess'));
  const samRow = (await cont(Sam))[0];
  ok('the game shows in Sam\'s Continue row as his move', samRow && samRow.title === 'Chess with Chess Milo' && samRow.yourTurn && samRow.href === `chess.html?room=${code}`,
    JSON.stringify(samRow));
  const miloRow = (await cont(Milo))[0];
  ok('…and in Milo\'s as waiting on Sam', miloRow && !miloRow.yourTurn && miloRow.detail === 'Chess Sam\'s move');
  ok('…and not in Kim\'s', !(await cont(Kim)).length);
  ok('a game in progress isn\'t on the Join a game board', !(await api('/lobby')).data.rooms.some(r => r.code === code));

  console.log('\n-- chess: limits --');
  {
    // The host takes someone out of a seat in the lobby.
    const h3 = (await api('/chess/rooms', 'POST', { name: 'Host Three' })).data;
    const g3 = (await api(`${room(h3.code)}/join`, 'POST', { name: 'Sneaky' })).data;
    ok('only the host can take someone out', (await api(`${room(h3.code)}/remove`, 'POST', { ...seat(g3), seat: h3.playerId })).status === 403);
    s = (await api(`${room(h3.code)}/remove`, 'POST', { ...seat(h3), seat: g3.playerId })).data;
    ok('the host can take someone out of a seat in the lobby', s.seats.length === 1 && s.chat.some(m => m.system && m.text === 'Sneaky was taken out of the game'));
    ok('…and their seat stops working', (await api(`${room(h3.code)}/chat`, 'POST', { ...seat(g3), text: 'hi' })).status === 403);
    await api(`${room(h3.code)}/leave`, 'POST', seat(h3));
    // Five unfinished games each.
    const mine = [];
    for (let i = 0; i < 5; i++) mine.push((await api('/chess/rooms', 'POST', {}, Kim.h)));
    ok('someone can have five unfinished games going', mine.every(r => r.status === 201));
    const sixth = await api('/chess/rooms', 'POST', {}, Kim.h);
    ok('…but not a sixth', sixth.status === 409 && /5 chess games/.test(sixth.data.error), JSON.stringify(sixth.data));
    for (const r of mine) await api(`${room(r.data.code)}/leave`, 'POST', seat(r.data));
  }

  console.log('\n-- chess: leaving the lobby --');
  const h2 = (await api('/chess/rooms', 'POST', { name: 'Guest Host' })).data;
  ok('a guest can host too, and the room is on the Join a game board', (await api('/lobby')).data.rooms.some(r => r.code === h2.code && r.status === 'open'));
  ok('…but can\'t invite by name without a profile', (await api(`${room(h2.code)}/invite`, 'POST', { ...seat(h2), to: [Kim.id] })).status === 401);
  const g2 = (await api(`${room(h2.code)}/join`, 'POST', { name: 'Friend' })).data;
  await api(`${room(h2.code)}/leave`, 'POST', seat(g2));
  s = (await api(`${room(h2.code)}?playerId=${h2.playerId}&token=${h2.token}`)).data;
  ok('a player leaving the lobby frees the seat', s.seats.length === 1 && s.chat.some(m => m.system && m.text === 'Friend left'));
  ok('the host leaving closes the room', (await api(`${room(h2.code)}/leave`, 'POST', seat(h2))).data.closed &&
    (await api(`${room(h2.code)}?playerId=${h2.playerId}&token=${h2.token}`)).status === 404);

  console.log('\n-- chess: who can join --');
  ok('Only People Selected needs at least one person', (await api('/chess/rooms', 'POST', { who: 'selected', allowed: [] }, Sam.h)).status === 400);
  ok('…and the host\'s profile', (await api('/chess/rooms', 'POST', { name: 'X', who: 'selected', allowed: [Milo.id] })).status === 401);
  const only = (await api('/chess/rooms', 'POST', { who: 'selected', allowed: [Milo.id] }, Sam.h)).data;
  const listFor = async h => (await api('/chess/lobbies', 'GET', undefined, h || {})).data.lobbies.map(l => l.code);
  ok('a lobby for picked people is listed for them', (await listFor(Milo.h)).includes(only.code));
  ok('…and not for anyone else, with or without a profile', !(await listFor(Kim.h)).includes(only.code) && !(await listFor()).includes(only.code));
  ok('…the same on the home page\'s Join a game', (await api('/lobby', 'GET', undefined, Milo.h)).data.rooms.some(r => r.code === only.code) &&
    !(await api('/lobby', 'GET', undefined, Kim.h)).data.rooms.some(r => r.code === only.code));
  ok('the people picked get an invite', (await api('/invites', 'GET', undefined, Milo.h)).data.invites.some(i => i.href.includes(only.code)));
  ok('someone else can\'t join it', (await api(`${room(only.code)}/join`, 'POST', {}, Kim.h)).status === 403 &&
    (await api(`${room(only.code)}/join`, 'POST', { name: 'Sneaky' })).status === 403);
  const picked = await api(`${room(only.code)}/join`, 'POST', {}, Milo.h);
  ok('…but someone picked can', picked.status === 200);
  s = (await api(`${room(only.code)}?playerId=${only.playerId}&token=${only.token}`)).data;
  ok('the lobby says only the people selected can join', s.settings.who === 'selected' && s.max === 2);
  await api(`${room(only.code)}/leave`, 'POST', seat(only));
  ok('someone who isn\'t a profile here can\'t be picked', (await api('/chess/rooms', 'POST', { who: 'selected', allowed: [Milo.id, 'x'.repeat(5000)] }, Sam.h)).status === 400);
  ok('…and no more than 12 people', (await api('/chess/rooms', 'POST', { who: 'selected', allowed: Array.from({ length: 13 }, (_, i) => `id${i}`) }, Sam.h)).status === 400);
  // Someone invited after the lobby opened is let in too.
  const later = (await api('/chess/rooms', 'POST', { who: 'selected', allowed: [Milo.id] }, Sam.h)).data;
  ok('Kim isn\'t in before being invited', (await api(`${room(later.code)}/join`, 'POST', {}, Kim.h)).status === 403);
  await api(`${room(later.code)}/invite`, 'POST', { ...seat(later), to: [Kim.id] });
  const kimIn = (await api(`${room(later.code)}/join`, 'POST', {}, Kim.h)).data;
  ok('…and is after', !!(kimIn && kimIn.playerId));
  // Changing the color asks everyone to be ready again.
  await api(`${room(later.code)}/ready`, 'POST', { ...seat(kimIn), ready: true });
  s = (await api(`${room(later.code)}/settings`, 'POST', { ...seat(later), color: 'b' })).data;
  ok('a new color puts Ready back to Not ready', s.allReady === false && s.seats.find(x => !x.host).ready === false);
  await api(`${room(later.code)}/leave`, 'POST', seat(later));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
