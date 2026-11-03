'use strict';

// Optional: game switches and the banner from ARKS ID's admin console, when
// the arcade signs in through ARKS ID (arcade/arksid.js). Without ARKS ID
// nothing here runs, and the arcade's own game switches (the admin page's
// Arcade tab, arcade/home-games.js) work exactly as before.
//
// With it on:
//   - The arcade tells ARKS ID which games it has, each with the arcade's own
//     setting as the default (on, unless it's turned off on the admin page).
//     ARKS ID's console can then turn a game on or off for everyone, for a
//     role, or for one person.
//   - For each game, a setting made in ARKS ID's console decides. A game
//     nobody set there follows the arcade's own switch, so turning a game off
//     on the admin page keeps working.
//   - A game that's off shows the "Pardon our dust" sign, the same as one
//     turned off on the admin page (public/dust-sign.js).
//   - The banner typed in ARKS ID's console shows at the top of every page
//     (public/banner.js asks /api/banner).
//
// Answers are kept for a minute (the shared kit's kit/switches.js). When ARKS
// ID can't be reached, the last answer stands; with none, the arcade's own
// switches decide.

const homeGames = require('./home-games');
const { createSwitches, createBanner } = require('../kit/switches');

// The games' names as the console shows them. A game added later without a
// name here shows its id until one is added.
const NAMES = {
  wordless: 'Wordless', rambler: 'Rambler', spinsolve: 'Spin & Solve', chess: 'Chess', dino: 'Dino Dash',
  trivia: 'Know-It-All', partdeux: 'Uh-Oh: Part Deux', daredevil: 'Dare Devil', snake: 'Snake',
  bricks: 'Brick Breaker', blocks: 'Block Drop', towers: 'Tower Defense', sudoku: 'Sudoku', scuffle: 'Shuffle Scuffle', crisscross: 'Words with Family',
  clueless: 'Clueless Crosswords', tumbler: 'Tumbler Rumble', discodrop: 'Disco Drop', royale: 'Roll Royale', moonshot: 'Moonshot'
};
const ALL = { guest: true, kid: true, teen: true, adult: true, admin: true };
const keyOf = id => `game.${id}`;

function gameFeatures() {
  const { closed } = homeGames.get();
  return homeGames.GAMES.map(id => ({
    key: keyOf(id), name: NAMES[id] || id, group: 'Games', on: !closed.includes(id), roles: ALL,
    about: 'Off shows the "Pardon our dust" sign instead of the game.'
  }));
}

let current = null;

// client: arcade/arksid.js's client. -> null without one.
function createArcadeSwitches({ client, now = Date.now }) {
  if (!client || !client.appCall) return null;
  const sw = createSwitches({ call: (method, p, body) => client.appCall(method, p, body), features: gameFeatures, now });
  const banner = createBanner({ call: (method, p) => client.appCall(method, p), now });

  // Which games are closed for this person (their ARKS ID session id), or for
  // nobody signed in (null).
  async function closedFor(sessionId) {
    const own = homeGames.get().closed;
    let answer = null;
    try { answer = await sw.forSession(sessionId || null); } catch { /* the arcade's own */ }
    if (!answer) return own;
    return homeGames.GAMES.filter(id => (answer.decided.includes(keyOf(id)) ? answer.switches[keyOf(id)] === false : own.includes(id)));
  }

  current = {
    closedFor,
    banner: () => banner.get(),
    // The admin page saved: ask afresh for the banner too.
    changed: () => { banner.forget(); return sw.changed(); },
    register: () => sw.register(true),
    start: () => sw.start(),
    stop: () => sw.stop()
  };
  return current;
}

// The admin page turned a game on or off: tell ARKS ID the new default now.
function changed() {
  if (current) current.changed().catch(() => {});
}
// For the admin page's game list: whether ARKS ID's console can switch games too.
function adminNote() {
  return { arksId: !!current };
}

module.exports = { createArcadeSwitches, gameFeatures, changed, adminNote, NAMES, current: () => current };
