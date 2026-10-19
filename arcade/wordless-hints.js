'use strict';

// Wordless hints. Instead of only handing out letters, a puzzle has a title
// (a category, the way a game-show board does) and a ladder of hints that get
// you into the right neighborhood before they give anything away:
//   1. a clue sentence
//   2. a word that ends the same way
//   3. a letter
// Clues come from the theme itself (written by hand for the built-ins, or by
// the AI prompt for custom themes) and, for Classic, from WordNet definitions.

const fs = require('node:fs');
const path = require('node:path');

const CLUES_FILE = path.join(__dirname, '..', 'words', 'clues-common.tsv');

// Part of speech, said the way a kid would understand it.
const POS_LABEL = { noun: 'Thing', verb: 'Action word', adj: 'Describing word', adv: 'How or when word' };

let common = null;
function commonClues() {
  if (common) return common;
  common = new Map();
  if (!fs.existsSync(CLUES_FILE)) return common;
  for (const line of fs.readFileSync(CLUES_FILE, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [word, pos, clue] = line.split('\t');
    if (word && clue) common.set(word, { category: POS_LABEL[pos] || 'Word', clue: clue.trim() });
  }
  return common;
}

// [category, clue] for each built-in theme word.
const BUILTIN = {
  simpsons: {
    bart: ['Character', 'The family\'s spiky-haired troublemaker on a skateboard'],
    lisa: ['Character', 'The smartest kid in the family, saxophone in hand'],
    moe: ['Character', 'Grumpy bartender who keeps falling for prank calls'],
    apu: ['Character', 'Runs the Kwik-E-Mart: "Thank you, come again!"'],
    otto: ['Character', 'The school bus driver who loves heavy metal'],
    edna: ['Character', 'Bart\'s fourth-grade teacher\'s first name'],
    carl: ['Character', 'Lenny\'s best friend at the power plant'],
    duff: ['Thing', 'Springfield\'s favorite beer brand'],
    kang: ['Character', 'One of the two drooling one-eyed aliens'],
    troy: ['Character', 'First name of the actor who says "You may remember me from…"'],
    bobo: ['Thing', 'Mr. Burns\' long-lost teddy bear'],
    abe: ['Character', 'Grampa\'s first name'],
    kirk: ['Character', 'Milhouse\'s dad'],
    todd: ['Character', 'One of Ned\'s very polite little boys'],
    rod: ['Character', 'The other one of Ned\'s very polite little boys'],
    lou: ['Character', 'Chief Wiggum\'s sensible sidekick officer'],
    gil: ['Character', 'The down-on-his-luck salesman who never catches a break'],
    hans: ['Character', 'The unlucky Moleman\'s first name'],
    mona: ['Character', 'Homer\'s long-lost hippie mom'],
    doh: ['Catchphrase', 'What Homer yells when something goes wrong'],
    plow: ['Thing', 'Mr. ___ had the catchiest snow-clearing jingle in town'],
    nuke: ['Thing', 'Short word for the kind of power Homer\'s plant makes'],
    lard: ['Thing', 'Greasy kitchen fat Homer once tried to get rich selling'],
    cow: ['Thing', 'Bart says "Don\'t have a ___, man!"'],
    homer: ['Character', 'Donut-loving dad who works at the power plant'],
    marge: ['Character', 'The mom with the tall blue hair'],
    maggie: ['Character', 'The baby with the pacifier'],
    krusty: ['Character', 'Bart\'s favorite TV clown'],
    nelson: ['Character', 'The bully who points and laughs "Ha-ha!"'],
    burns: ['Character', 'The oldest, richest, meanest boss in town: "Excellent…"'],
    patty: ['Character', 'Marge\'s grumpy sister who isn\'t Selma'],
    selma: ['Character', 'Marge\'s grumpy sister who isn\'t Patty'],
    ralph: ['Character', 'Chief Wiggum\'s son: "I\'m learnding!"'],
    lenny: ['Character', 'Homer\'s work buddy who\'s always with Carl'],
    frink: ['Character', 'Springfield\'s nerdy professor and inventor'],
    maude: ['Character', 'Ned\'s sweet wife'],
    itchy: ['Character', 'The cartoon mouse who always wins'],
    kodos: ['Character', 'Kang\'s alien sibling'],
    snake: ['Character', 'Springfield\'s most frequent burglar'],
    jimbo: ['Character', 'Bully in the purple beanie with a skull on it'],
    dolph: ['Character', 'Bully with long bangs over one eye'],
    sherri: ['Character', 'One of the twin girls in Bart\'s class'],
    terri: ['Character', 'One of the twin girls in Bart\'s class'],
    agnes: ['Character', 'Principal Skinner\'s bossy mother'],
    cletus: ['Character', 'Slack-jawed yokel with a huge family'],
    willie: ['Character', 'The angry Scottish groundskeeper'],
    martin: ['Character', 'The class brainiac and teacher\'s pet'],
    quimby: ['Character', 'Springfield\'s mayor'],
    wiggum: ['Character', 'The police chief\'s last name'],
    barney: ['Character', 'Homer\'s burping friend at the bar'],
    gumble: ['Character', 'Barney\'s last name'],
    donut: ['Food', 'Homer\'s favorite pink-frosted snack'],
    donuts: ['Food', 'Homer can never have enough of these pink-frosted snacks'],
    jasper: ['Character', 'The old man with the very long beard'],
    comic: ['Thing', 'The kind of book Bart buys at the Android\'s Dungeon'],
    helen: ['Character', 'The reverend\'s wife: "Won\'t somebody please think of the children?"'],
    mapple: ['Thing', 'Springfield\'s version of a famous computer company'],
    skinner: ['Character', 'The school principal'],
    hibbert: ['Character', 'The town doctor with the jolly laugh'],
    duffman: ['Character', 'The beer mascot who shouts "Oh yeah!"'],
    lovejoy: ['Character', 'The town reverend\'s last name'],
    kearney: ['Character', 'Bully with stubble and a kid of his own'],
    moleman: ['Character', 'Unlucky old man who lives underground'],
    mcclure: ['Character', 'Troy, the washed-up actor\'s last name'],
    lardlad: ['Thing', 'Giant donut-holding statue that came to life'],
    milhouse: ['Character', 'Bart\'s nerdy best friend with blue hair'],
    smithers: ['Character', 'Mr. Burns\' loyal assistant'],
    flanders: ['Character', 'The cheery neighbor: "Hi-diddly-ho!"'],
    chalmers: ['Character', 'The superintendent who yells "SKINNER!"'],
    sideshow: ['Character', 'Bob and Mel both have this at the start of their name'],
    scratchy: ['Character', 'The cartoon cat who always loses'],
    squishee: ['Food', 'The Kwik-E-Mart\'s slushy frozen drink'],
    monorail: ['Thing', 'Lyle Lanley\'s song-and-dance train scheme'],
    simpsons: ['Family', 'The family\'s last name, for all of them'],
    spuckler: ['Character', 'Cletus\'s last name'],
    embiggen: ['Word', '"A noble spirit ___s the smallest man"'],
    krabappel: ['Character', 'Bart\'s teacher Edna\'s last name'],
    vanhouten: ['Character', 'Milhouse\'s family name'],
    evergreen: ['Place', '___ Terrace: the street the family lives on'],
    plutonium: ['Thing', 'Glowing green stuff from the power plant'],
    bumblebee: ['Character', 'The Spanish-language TV star in an insect costume'],
    sprinkles: ['Food', 'What\'s on top of Homer\'s pink donut'],
    cromulent: ['Word', 'A perfectly ___ word (it means acceptable)'],
    lunchlady: ['Character', 'Doris\'s job at the school cafeteria'],
    doughnuts: ['Food', 'The long spelling of Homer\'s favorite treats'],
    kwikemart: ['Place', 'Apu\'s convenience store'],
    embiggens: ['Word', '"A noble spirit ___ the smallest man"'],
    saxophone: ['Thing', 'Lisa\'s instrument'],
    treehouse: ['Place', 'Bart\'s backyard hideout, and the Halloween episodes'],
    powerplant: ['Place', 'Where Homer works']
  },
  dune: {
    paul: ['Character', 'The young duke\'s son who becomes Muad\'Dib'],
    leto: ['Character', 'Duke Atreides, Paul\'s father'],
    feyd: ['Character', 'The first part of the Baron\'s sly nephew\'s name'],
    alia: ['Character', 'Paul\'s eerie little sister'],
    yueh: ['Character', 'The Atreides doctor who betrays them'],
    worm: ['Creature', 'Giant creature beneath the desert'],
    sand: ['Thing', 'Arrakis is covered in it'],
    dune: ['Thing', 'A hill made by the wind in a desert'],
    duke: ['Title', 'Leto\'s noble title'],
    suk: ['Thing', 'The school whose doctors can\'t be turned against their patients'],
    liet: ['Character', 'Kynes\' Fremen name'],
    naib: ['Title', 'The leader of a Fremen sietch'],
    pyon: ['Thing', 'Word for a peasant or laborer'],
    shai: ['Thing', 'First part of the Fremen name for the sandworm'],
    crys: ['Thing', 'First part of the name of the Fremen\'s sacred blade'],
    usul: ['Name', 'Paul\'s secret sietch name, meaning "base of the pillar"'],
    gom: ['Thing', 'First word of the poisoned needle in the box test'],
    dew: ['Thing', 'Fremen collect it at dawn with traps'],
    bene: ['Thing', 'First word of the sisterhood\'s name'],
    chani: ['Character', 'Paul\'s Fremen love'],
    duncan: ['Character', 'Swordmaster Idaho\'s first name'],
    gurney: ['Character', 'Halleck, the warrior who plays the baliset'],
    baron: ['Title', 'Vladimir Harkonnen\'s title'],
    fremen: ['People', 'The desert people of Arrakis'],
    kynes: ['Character', 'The imperial planetologist'],
    irulan: ['Character', 'The Emperor\'s daughter who writes the history'],
    thufir: ['Character', 'Hawat\'s first name, the Atreides mentat'],
    hawat: ['Character', 'Thufir\'s last name'],
    piter: ['Character', 'De Vries, the Baron\'s twisted mentat'],
    spice: ['Thing', 'The most valuable substance in the universe'],
    sietch: ['Place', 'A hidden Fremen cave community'],
    shield: ['Thing', 'Personal force field that stops fast blows'],
    desert: ['Place', 'What Arrakis almost entirely is'],
    house: ['Thing', 'A noble family, like Atreides or Harkonnen'],
    guild: ['Group', 'The Spacing ___ controls space travel'],
    jamis: ['Character', 'The Fremen Paul beats in his first duel'],
    harah: ['Character', 'Jamis\'s widow, who joins Paul\'s household'],
    ghola: ['Thing', 'A person regrown from a dead body\'s cells'],
    maker: ['Thing', 'Fremen name for the great sandworm'],
    rabban: ['Character', 'The Baron\'s brutal nephew, "The Beast"'],
    mentat: ['Title', 'A human trained to think like a computer'],
    jabbar: ['Thing', 'Second word of the deadly poisoned needle\'s name'],
    giedi: ['Place', 'First word of the Harkonnen homeworld'],
    stilgar: ['Character', 'Naib of Sietch Tabr'],
    arrakis: ['Place', 'The desert planet'],
    sandworm: ['Creature', 'Giant beast that comes when you walk with a rhythm'],
    shaddam: ['Character', 'The Padishah Emperor\'s first name'],
    corrino: ['Family', 'The Emperor\'s house'],
    caladan: ['Place', 'The Atreides ocean homeworld'],
    atreides: ['Family', 'Paul\'s noble house'],
    gesserit: ['Group', 'Second word of the sisterhood\'s name'],
    ghanima: ['Character', 'Paul\'s daughter, twin of Leto II'],
    muaddib: ['Name', 'Paul\'s Fremen name, after a little desert mouse'],
    thopter: ['Vehicle', 'Flying machine with flapping wings, for short'],
    jessica: ['Character', 'Paul\'s mother, a Bene Gesserit'],
    tleilax: ['Place', 'Home of the gene-tinkerers and their Face Dancers'],
    fedaykin: ['Group', 'Paul\'s Fremen death commandos'],
    emperor: ['Title', 'Shaddam IV\'s title'],
    melange: ['Thing', 'The proper name for the spice'],
    kwisatz: ['Thing', 'First word of the long-awaited superbeing\'s title'],
    haderach: ['Thing', 'Second word of the long-awaited superbeing\'s title'],
    chakobsa: ['Language', 'The old hunting language the Fremen use'],
    imperium: ['Group', 'The whole galactic empire'],
    padishah: ['Title', 'Shaddam is the ___ Emperor'],
    weirding: ['Thing', 'The ___ way: the Bene Gesserit fighting style'],
    secundus: ['Place', 'Salusa ___: the harsh planet where soldiers are trained'],
    navigator: ['Character', 'Spice-mutated Guild pilot who folds space'],
    harkonnen: ['Family', 'The Baron\'s cruel house'],
    sardaukar: ['Group', 'The Emperor\'s terrifying soldiers'],
    crysknife: ['Thing', 'Sacred Fremen blade made from a sandworm\'s tooth'],
    stillsuit: ['Thing', 'Desert suit that recycles your body\'s water'],
    shaihulud: ['Creature', 'Fremen name for the great sandworm, said with respect'],
    heighliner: ['Vehicle', 'Gigantic Guild spaceship'],
    sayyadina: ['Title', 'A Fremen religious woman'],
    landsraad: ['Group', 'The council of noble houses'],
    guildsman: ['Character', 'A member of the Spacing Guild'],
    deathstill: ['Thing', 'Machine that recovers a dead body\'s water'],
    giediprime: ['Place', 'The Harkonnen homeworld'],
    mindkiller: ['Phrase', '"Fear is the ___"']
  }
};

// The built-in adult themes carry their clues with them.
for (const theme of require('./wordless-adult-themes')) BUILTIN[theme.id] = theme.clues;

// A theme's own clues win; Classic falls back on the dictionary. Other themes
// don't, because a dictionary clue for CREEPER is a plant, not a Minecraft mob.
function clueFor(theme, word) {
  const w = word.toLowerCase();
  const own = theme.clues && theme.clues[w];
  if (own && own.clue) return { category: own.category || null, clue: own.clue };
  const builtin = BUILTIN[theme.id] && BUILTIN[theme.id][w];
  if (builtin) return { category: builtin[0], clue: builtin[1] };
  if (theme.id === 'classic') return commonClues().get(w) || null;
  return null;
}

// A familiar word that ends the same way: "ends like CASTLE" for BOTTLE puts
// you in the right place without saying where the word starts. Picked from
// the kid-safe common list, most familiar first.
function endsLike(word, commonWords) {
  const w = word.toLowerCase();
  const tail = w.slice(-(w.length <= 4 ? 2 : 3));
  let best = null;
  for (const upper of commonWords) {
    const c = upper.toLowerCase();
    if (c === w || c.length < 3 || !c.endsWith(tail)) continue;
    if (c.includes(w) || w.includes(c)) continue;
    // Sharing the first letter too would give the game away.
    if (c[0] === w[0]) continue;
    const score = Math.abs(c.length - w.length);
    if (!best || score < best.score) best = { c, score };
    if (score === 0) break;
  }
  return best ? best.c.toUpperCase() : null;
}

function hintsFor(theme, word, commonWords) {
  const found = clueFor(theme, word);
  return {
    category: (found && found.category) || theme.subject || 'Word',
    clue: found ? found.clue : null,
    endsLike: endsLike(word, commonWords)
  };
}

// Admin-pasted clues arrive as { word: "clue" } or { word: { category, clue } }.
// Kept only for words that are in the theme, and never if the clue gives the
// word away.
function cleanClues(raw, words) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const inTheme = new Set(words.map(w => w.toLowerCase()));
  for (const [key, value] of Object.entries(raw)) {
    const w = String(key).toLowerCase().trim();
    if (!inTheme.has(w)) continue;
    const clue = String(typeof value === 'string' ? value : (value && value.clue) || '').trim().slice(0, 160);
    const category = typeof value === 'object' && value && value.category
      ? String(value.category).trim().slice(0, 30) : null;
    if (!clue || clue.toLowerCase().includes(w)) continue;
    out[w] = category ? { category, clue } : { clue };
  }
  return out;
}

module.exports = { hintsFor, clueFor, endsLike, cleanClues, BUILTIN };
