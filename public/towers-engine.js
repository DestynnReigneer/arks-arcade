'use strict';

// Tower Defense's rules, with no idea how it's drawn: the map, the roads,
// towers, enemies, waves, gold and lives. The page calls step() every frame;
// the tests play whole games with it.
//
// Waves come on their own: after a wave is cleared there's a short break
// (BREAK seconds) to build, then the next one starts. Calling it before the
// timer runs out pays bonus gold, more the earlier you call. The first wave
// waits until you've built something (or pressed start).
//
// Distances are in grid squares and times in seconds.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TowersEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WAVES = 25;
  const FIRST_BREAK = 30, BREAK = 15;

  // '.' ground you can build on, '#' road, 'S' where enemies come from (a map
  // can have two), 'E' the castle they're after. 'T' trees or cactus, 'R'
  // rocks, '~' water, ice or lava: nothing can be built on those.
  // theme picks the colors and scenery on the page.
  const MAPS = {
    meadow: {
      label: 'Meadow', level: 'Easy', theme: 'grass', blurb: 'A long, winding road. A good place to start.', gold: 180, lives: 20, hp: 0.9,
      rows: ['S###......', '...#....R.', '...#...T..', '...######.', '.R......#.', '.T......#.', '.########.', '.#......T.', '.#....T...', '.#######..', '.......#.R', '..T....#..', '.......E..']
    },
    lake: {
      label: 'Frozen Lake', level: 'Easy', theme: 'snow', blurb: 'The road circles a frozen lake. Towers in the middle reach two roads at once.', gold: 170, lives: 20, hp: 1.3,
      rows: ['S########.', '........#.', '.T..R...#.', '.######.#.', '.#..~~#.#.', '.#.E~~#.#.', '.#.#~~#.#.', '.#.#~~#.#.', '.#.#~~#.#.', '.#.####.#.', '.#......#.', '.########.', '..T....T..']
    },
    canyon: {
      label: 'Canyon', level: 'Medium', theme: 'desert', blurb: 'Shorter road, tougher monsters.', gold: 150, lives: 20, hp: 1.15,
      rows: ['..R.......', '..T....T..', 'S######...', '......#.R.', '.T....#..T', '......#...', '..#####...', '..#....R..', '..#...T...', 'R.#.......', '..#######E', '.T......R.', '...R..T...']
    },
    swamp: {
      label: 'Swamp', level: 'Medium', theme: 'swamp', blurb: 'Two roads in! Monsters take turns coming from each side.', gold: 190, lives: 20, hp: 1.0,
      rows: ['.S......S.', '.#..~~..#.', '.#..~~..#.', '.#......#.', '.###..###.', '...#..#...', '.T.#..#.T.', '...####...', '....#.....', '.~..#..~..', '....####..', '.T.....#..', '.......E..']
    },
    castle: {
      label: 'Castle', level: 'Hard', theme: 'stone', blurb: 'They\'re almost at the gate. Good luck!', gold: 190, lives: 20, hp: 1.2,
      rows: ['.....S....', '..T..#..T.', '.....#....', '..####..R.', '..#.......', 'T.#....T..', '..#.......', '..#..R....', '..######..', '.......#..', '.T.....#.T', '.R.....#..', '.......E..']
    },
    volcano: {
      label: 'Volcano', level: 'Hard', theme: 'lava', blurb: 'Two short roads over the lava. Only for experts.', gold: 230, lives: 20, hp: 1.15,
      rows: ['~~~..R..~~', '~~...T...~', '..........', 'S###..###S', '...#..#...', '.~~#..#~~.', '.~~####~~.', '....#.....', '~~..#...R.', '~~..###...', '......#.~~', '.R....#.~~', '......E...']
    }
  };

  // Each tower: cost to build, then each level's stats (and its upgrade cost).
  const TOWERS = {
    archer: {
      label: 'Archer', emoji: '🏹', color: '#3ddc84', blurb: 'Quick shots at one enemy. Hits flyers.',
      levels: [
        { cost: 50, range: 2.6, damage: 9, rate: 1.6 },
        { cost: 60, range: 2.9, damage: 15, rate: 1.8 },
        { cost: 110, range: 3.2, damage: 26, rate: 2.1 }
      ]
    },
    cannon: {
      label: 'Cannon', emoji: '💣', color: '#ff9f2c', blurb: 'Big blasts that hit a crowd. Can\'t hit flyers.',
      levels: [
        { cost: 80, range: 2.3, damage: 24, rate: 0.6, splash: 0.9 },
        { cost: 90, range: 2.5, damage: 40, rate: 0.65, splash: 1.0 },
        { cost: 160, range: 2.7, damage: 72, rate: 0.7, splash: 1.15 }
      ]
    },
    frost: {
      label: 'Frost', emoji: '❄️', color: '#2de2e6', blurb: 'Slows down everything near it.',
      levels: [
        { cost: 65, range: 2.2, damage: 3, rate: 1, slow: 0.4 },
        { cost: 70, range: 2.4, damage: 5, rate: 1, slow: 0.5 },
        { cost: 120, range: 2.7, damage: 8, rate: 1, slow: 0.6 }
      ]
    },
    tesla: {
      label: 'Tesla', emoji: '⚡', color: '#c86bff', blurb: 'Lightning that jumps between enemies. Hits flyers.',
      levels: [
        { cost: 120, range: 2.4, damage: 20, rate: 0.9, chain: 3 },
        { cost: 120, range: 2.6, damage: 32, rate: 0.95, chain: 4 },
        { cost: 200, range: 2.8, damage: 50, rate: 1, chain: 5 }
      ]
    }
  };

  const ENEMIES = {
    slime: { label: 'Slime', emoji: '🟢', hp: 30, speed: 1.0, reward: 5, size: 0.32 },
    rat: { label: 'Rat', emoji: '🐀', hp: 18, speed: 1.9, reward: 4, size: 0.3 },
    knight: { label: 'Knight', emoji: '🛡️', hp: 85, speed: 0.72, reward: 12, armor: 4, size: 0.36 },
    bat: { label: 'Bat', emoji: '🦇', hp: 26, speed: 1.55, reward: 6, flying: true, size: 0.32 },
    ogre: { label: 'Ogre', emoji: '👹', hp: 520, speed: 0.55, reward: 80, armor: 6, size: 0.45, boss: true }
  };

  function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

  // Find the road from each S to the castle (the shortest way along road
  // squares, so two roads can join up).
  function parseMap(id) {
    const def = MAPS[id];
    if (!def) throw fail('Unknown map.');
    const rows = def.rows.length, cols = def.rows[0].length;
    const starts = [];
    let end = null;
    def.rows.forEach((r, y) => {
      if (r.length !== cols) throw fail(`Map ${id} row ${y} is the wrong length`);
      [...r].forEach((ch, x) => { if (ch === 'S') starts.push([x, y]); if (ch === 'E') end = [x, y]; });
    });
    if (!starts.length || !end) throw fail(`Map ${id} needs an S and an E`);
    const at = (x, y) => (def.rows[y] || '')[x];
    const walkable = (x, y) => at(x, y) === '#' || at(x, y) === 'E';
    const paths = starts.map(start => {
      const prev = new Map([[start.join(), null]]);
      const queue = [start];
      while (queue.length) {
        const [x, y] = queue.shift();
        if (x === end[0] && y === end[1]) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
          if (!prev.has(k) && walkable(nx, ny)) { prev.set(k, [x, y]); queue.push([nx, ny]); }
        }
      }
      if (!prev.has(end.join())) throw fail(`Map ${id}: no road from ${start} to the castle`);
      const path = [];
      for (let p = end; p; p = prev.get(p.join())) path.unshift(p);
      return path;
    });
    const pathSet = new Set(paths.flat().map(p => p.join()));
    return { id, cols, rows, tiles: def.rows, theme: def.theme, paths, path: paths[0], pathSet };
  }

  // Which monsters each wave sends.
  function waveList(n) {
    const out = [];
    if (n % 5 === 0) {
      const ogres = Math.floor(n / 10) + 1;
      for (let i = 0; i < ogres; i++) out.push('ogre');
      for (let i = 0; i < 4 + n / 5; i++) out.push(n >= 10 ? 'knight' : 'slime');
      return out;
    }
    const count = Math.round(6 + n * 1.25);
    for (let i = 0; i < count; i++) {
      let type = 'slime';
      if (n >= 3 && i % 3 === 1) type = 'rat';
      if (n >= 5 && i % 4 === 2) type = 'knight';
      if (n >= 7 && i % 5 === 3) type = 'bat';
      if (n >= 12 && i % 6 === 0) type = 'knight';
      out.push(type);
    }
    return out;
  }
  // Monsters get tougher every wave (a bit faster after wave 15).
  const hpScale = (n, map) => (1 + 0.12 * (n - 1) + 0.004 * (n - 1) * (n - 1)) * MAPS[map.id].hp;

  function create({ map = 'meadow', rand = Math.random } = {}) {
    const m = parseMap(map);
    const def = MAPS[map];
    return {
      map: m, rand,
      gold: def.gold, lives: def.lives, startLives: def.lives,
      wave: 0, phase: 'build', countdown: null, spawnQueue: [], spawnTimer: 0, spawned: 0,
      towers: [], enemies: [], shots: [], fx: [],
      score: 0, kills: 0, leaked: 0, time: 0, nextId: 1, events: []
    };
  }

  const tileAt = (g, x, y) => (g.map.tiles[y] || '')[x];
  const towerAt = (g, x, y) => g.towers.find(t => t.x === x && t.y === y);
  const over = g => g.phase === 'won' || g.phase === 'lost';

  function canBuild(g, x, y) {
    return tileAt(g, x, y) === '.' && !towerAt(g, x, y);
  }

  // The first wave's clock starts once there's something to defend with.
  function armFirstWave(g) {
    if (g.wave === 0 && g.countdown == null && !over(g)) g.countdown = FIRST_BREAK;
  }

  function build(g, type, x, y) {
    const def = TOWERS[type];
    if (!def) throw fail('Unknown tower.');
    if (over(g)) throw fail('The game is over.');
    if (!canBuild(g, x, y)) throw fail('You can\'t build there.');
    const cost = def.levels[0].cost;
    if (g.gold < cost) throw fail(`Not enough gold: ${def.label} costs ${cost}.`);
    g.gold -= cost;
    const t = { id: g.nextId++, type, x, y, level: 0, spent: cost, cooldown: 0, kills: 0, aim: -Math.PI / 2 };
    g.towers.push(t);
    g.events.push('build');
    armFirstWave(g);
    return t;
  }

  const stats = t => TOWERS[t.type].levels[t.level];
  const upgradeCost = t => (t.level + 1 < TOWERS[t.type].levels.length ? TOWERS[t.type].levels[t.level + 1].cost : null);
  const sellValue = t => Math.floor(t.spent * 0.7);

  function upgrade(g, id) {
    const t = g.towers.find(x => x.id === id);
    if (!t) throw fail('No tower there.');
    const cost = upgradeCost(t);
    if (cost == null) throw fail('Already fully upgraded.');
    if (g.gold < cost) throw fail(`Not enough gold: the upgrade costs ${cost}.`);
    g.gold -= cost;
    t.spent += cost;
    t.level++;
    g.events.push('upgrade');
    return t;
  }

  function sell(g, id) {
    const i = g.towers.findIndex(x => x.id === id);
    if (i < 0) throw fail('No tower there.');
    const t = g.towers[i];
    g.gold += sellValue(t);
    g.towers.splice(i, 1);
    g.events.push('sell');
    return sellValue(t);
  }

  // Can the next wave be called now? Not while one is still marching out.
  const canCall = g => !over(g) && !g.spawnQueue.length && g.wave < WAVES;

  // Bonus gold for calling the next wave now: the full amount while monsters
  // are still on the road, then less as the break's clock runs down.
  function earlyBonus(g) {
    if (!canCall(g) || g.wave === 0) return 0;
    const max = 10 + g.wave * 2;
    if (g.phase === 'wave') return max;
    return Math.round(max * Math.max(0, Math.min(1, (g.countdown || 0) / BREAK)));
  }

  function startWave(g) {
    if (!canCall(g)) return false;
    const bonus = earlyBonus(g);
    if (bonus > 0) { g.gold += bonus; g.events.push('early:' + bonus); }
    g.wave++;
    g.spawnQueue = waveList(g.wave);
    g.spawnTimer = 0;
    g.countdown = null;
    g.phase = 'wave';
    g.events.push('wave');
    return true;
  }

  // A point along a road, from 0 (the start) to path.length - 1 (the castle).
  function pointAt(g, d, road = 0) {
    const p = g.map.paths[road] || g.map.path;
    const i = Math.max(0, Math.min(p.length - 2, Math.floor(d)));
    const t = Math.max(0, Math.min(1, d - i));
    return { x: p[i][0] + (p[i + 1][0] - p[i][0]) * t + 0.5, y: p[i][1] + (p[i + 1][1] - p[i][1]) * t + 0.5 };
  }

  function spawn(g, type) {
    const def = ENEMIES[type];
    const hp = Math.round(def.hp * hpScale(g.wave, g.map));
    // Two roads: monsters take turns.
    const road = g.spawned++ % g.map.paths.length;
    const e = { id: g.nextId++, type, hp, maxHp: hp, d: 0, road, face: 1, slowFor: 0, slow: 0, ...pointAt(g, 0, road) };
    g.enemies.push(e);
  }

  function damage(g, e, amount, tower) {
    if (e.hp <= 0) return;
    const armor = ENEMIES[e.type].armor || 0;
    e.hp -= Math.max(1, amount - armor);
    e.hurt = 0.12;
    if (e.hp <= 0) {
      const def = ENEMIES[e.type];
      g.gold += def.reward;
      g.score += def.reward * 10;
      g.kills++;
      if (tower) tower.kills++;
      g.fx.push({ kind: 'pop', x: e.x, y: e.y, t: 0.5, reward: def.reward });
      g.events.push(def.boss ? 'boss-down' : 'kill');
    }
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function fire(g, t) {
    const s = stats(t);
    const c = { x: t.x + 0.5, y: t.y + 0.5 };
    const inRange = g.enemies.filter(e => e.hp > 0 && dist(c, e) <= s.range && !(t.type === 'cannon' && ENEMIES[e.type].flying));
    if (!inRange.length) return false;
    // Aim at whoever is closest to the castle.
    const left = e => (g.map.paths[e.road].length - 1) - e.d;
    inRange.sort((a, b) => left(a) - left(b));
    const target = inRange[0];
    t.aim = Math.atan2(target.y - c.y, target.x - c.x);
    if (t.type === 'archer') {
      g.shots.push({ kind: 'arrow', from: c, x: c.x, y: c.y, target: target.id, speed: 9, damage: s.damage, tower: t.id });
      g.events.push('arrow');
    } else if (t.type === 'cannon') {
      g.shots.push({ kind: 'ball', from: c, x: c.x, y: c.y, tx: target.x, ty: target.y, target: target.id, speed: 5, damage: s.damage, splash: s.splash, tower: t.id });
      g.events.push('cannon');
    } else if (t.type === 'frost') {
      for (const e of inRange) {
        damage(g, e, s.damage, t);
        // Bosses shrug off half the chill.
        e.slow = Math.max(e.slow, ENEMIES[e.type].boss ? s.slow / 2 : s.slow);
        e.slowFor = 1.6;
      }
      g.fx.push({ kind: 'frost', x: c.x, y: c.y, r: s.range, t: 0.5 });
      g.events.push('frost');
    } else if (t.type === 'tesla') {
      let hit = target, power = s.damage;
      const done = new Set();
      const points = [c];
      for (let i = 0; i < s.chain && hit; i++) {
        damage(g, hit, power, t);
        done.add(hit.id);
        points.push({ x: hit.x, y: hit.y });
        power *= 0.8;
        const from = hit;
        hit = g.enemies.filter(e => e.hp > 0 && !done.has(e.id) && dist(from, e) <= 1.6).sort((a, b) => dist(from, a) - dist(from, b))[0];
      }
      g.fx.push({ kind: 'zap', points, t: 0.18 });
      g.events.push('zap');
    }
    return true;
  }

  function step(g, dt) {
    g.events = [];
    if (over(g)) return g;
    g.time += dt;
    for (const f of g.fx) f.t -= dt;
    g.fx = g.fx.filter(f => f.t > 0);

    // The break between waves: when the clock runs out, here they come.
    if (g.phase === 'build') {
      if (g.countdown != null) {
        g.countdown -= dt;
        if (g.countdown <= 0) { g.countdown = 0; startWave(g); }
      }
      if (g.phase === 'build') return g;
    }

    // New monsters come out one by one.
    if (g.spawnQueue.length) {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawn(g, g.spawnQueue.shift());
        g.spawnTimer = Math.max(0.45, 0.85 - g.wave * 0.015);
      }
    }

    // Move them along the road.
    for (const e of g.enemies) {
      const def = ENEMIES[e.type];
      const end = g.map.paths[e.road].length - 1;
      if (e.slowFor > 0) { e.slowFor -= dt; if (e.slowFor <= 0) e.slow = 0; }
      if (e.hurt > 0) e.hurt -= dt;
      e.d += def.speed * (1 - e.slow) * dt;
      const p = pointAt(g, e.d, e.road);
      if (Math.abs(p.x - e.x) > 1e-4) e.face = p.x > e.x ? 1 : -1;
      e.x = p.x; e.y = p.y;
      if (e.d >= end && e.hp > 0) {
        e.hp = 0;
        e.leaked = true;
        const cost = def.boss ? 5 : 1;
        g.lives -= cost;
        g.leaked++;
        g.events.push('leak');
      }
    }

    // Towers shoot.
    for (const t of g.towers) {
      t.cooldown -= dt;
      if (t.cooldown <= 0 && fire(g, t)) t.cooldown = 1 / stats(t).rate;
    }

    // Arrows and cannonballs fly.
    for (const s of g.shots) {
      const target = g.enemies.find(e => e.id === s.target && e.hp > 0);
      if (s.kind === 'arrow') {
        if (!target) { s.done = true; continue; }
        const d = dist(s, target), stepLen = s.speed * dt;
        if (d <= stepLen + 0.1) { damage(g, target, s.damage, g.towers.find(t => t.id === s.tower)); s.done = true; }
        else { s.x += (target.x - s.x) / d * stepLen; s.y += (target.y - s.y) / d * stepLen; }
      } else {
        if (target) { s.tx = target.x; s.ty = target.y; }
        const d = Math.hypot(s.tx - s.x, s.ty - s.y), stepLen = s.speed * dt;
        if (d <= stepLen + 0.05) {
          const tower = g.towers.find(t => t.id === s.tower);
          for (const e of g.enemies) if (e.hp > 0 && !ENEMIES[e.type].flying && Math.hypot(e.x - s.tx, e.y - s.ty) <= s.splash) damage(g, e, s.damage, tower);
          g.fx.push({ kind: 'boom', x: s.tx, y: s.ty, r: s.splash, t: 0.35 });
          g.events.push('boom');
          s.done = true;
        } else { s.x += (s.tx - s.x) / d * stepLen; s.y += (s.ty - s.y) / d * stepLen; }
      }
    }
    g.shots = g.shots.filter(s => !s.done);
    g.enemies = g.enemies.filter(e => e.hp > 0);

    if (g.lives <= 0) {
      g.lives = 0;
      g.phase = 'lost';
      g.events.push('lost');
      return g;
    }
    if (!g.spawnQueue.length && !g.enemies.length && g.phase === 'wave') {
      const bonus = 20 + g.wave * 3;
      g.gold += bonus;
      g.score += 100 * g.wave;
      g.events.push('wave-clear:' + bonus);
      if (g.wave >= WAVES) {
        g.score += 5000 + g.lives * 100;
        g.phase = 'won';
        g.events.push('won');
      } else {
        g.phase = 'build';
        g.countdown = BREAK;
      }
    }
    return g;
  }

  return {
    WAVES, BREAK, FIRST_BREAK, MAPS, TOWERS, ENEMIES, create, parseMap, canBuild, build, upgrade, sell,
    startWave, canCall, earlyBonus, armFirstWave, step, stats, upgradeCost, sellValue, towerAt, tileAt, waveList, pointAt
  };
});
