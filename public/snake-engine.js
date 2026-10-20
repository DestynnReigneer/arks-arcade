'use strict';

// Snake's rules, with no idea how it's drawn. The page calls step() on a
// timer and draws whatever comes back; the tests call it directly.
//
// Classic: hit a wall or yourself and it's over. Wrap-around: walls take you
// to the other side, so only your own tail can stop you. Every apple is worth
// more at faster speeds, and every fifth apple brings a golden one that
// disappears if you're too slow.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakeEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SPEEDS = {
    chill: { label: 'Chill', ms: 150, mult: 1 },
    normal: { label: 'Normal', ms: 105, mult: 2 },
    fast: { label: 'Fast', ms: 72, mult: 3 }
  };
  const MODES = { classic: 'Classic', wrap: 'Wrap-around' };
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const GOLD_TICKS = 45;

  function create({ cols = 20, rows = 20, mode = 'classic', speed = 'normal', rand = Math.random } = {}) {
    const x = Math.floor(cols / 2), y = Math.floor(rows / 2);
    const g = {
      cols, rows, rand,
      mode: MODES[mode] ? mode : 'classic',
      speed: SPEEDS[speed] ? speed : 'normal',
      snake: [{ x, y }, { x: x - 1, y }, { x: x - 2, y }],
      dir: 'right', queue: [], grow: 0,
      apples: 0, golds: 0, score: 0,
      food: null, gold: null,
      over: false, won: false, ticks: 0, events: []
    };
    g.food = emptyCell(g);
    return g;
  }

  const same = (a, b) => a && b && a.x === b.x && a.y === b.y;

  function emptyCell(g) {
    const taken = new Set(g.snake.map(s => s.y * g.cols + s.x));
    if (g.food) taken.add(g.food.y * g.cols + g.food.x);
    if (g.gold) taken.add(g.gold.y * g.cols + g.gold.x);
    const free = g.cols * g.rows - taken.size;
    if (free <= 0) return null;
    let n = Math.floor(g.rand() * free);
    for (let i = 0; i < g.cols * g.rows; i++) {
      if (taken.has(i)) continue;
      if (n-- === 0) return { x: i % g.cols, y: Math.floor(i / g.cols) };
    }
    return null;
  }

  // Queue a turn. Up to three quick presses are remembered, so a fast
  // down-left still works between ticks. You can't reverse into yourself.
  function turn(g, dir) {
    if (!DIRS[dir] || g.over) return false;
    const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
    if (dir === last || dir === OPPOSITE[last] || g.queue.length >= 3) return false;
    g.queue.push(dir);
    return true;
  }

  function die(g, why) {
    g.over = true;
    g.events.push(why);
    return g;
  }

  function step(g) {
    g.events = [];
    if (g.over) return g;
    if (g.queue.length) g.dir = g.queue.shift();
    const [dx, dy] = DIRS[g.dir];
    const head = g.snake[0];
    let x = head.x + dx, y = head.y + dy;
    if (g.mode === 'wrap') {
      x = (x + g.cols) % g.cols;
      y = (y + g.rows) % g.rows;
    } else if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) {
      return die(g, 'wall');
    }
    // The tail moves out of the way this tick unless we're growing.
    const growing = g.grow > 0;
    const body = growing ? g.snake : g.snake.slice(0, -1);
    if (body.some(s => s.x === x && s.y === y)) return die(g, 'self');

    g.snake.unshift({ x, y });
    if (growing) g.grow--;
    else g.snake.pop();
    g.ticks++;

    const mult = SPEEDS[g.speed].mult;
    if (same(g.food, { x, y })) {
      g.apples++;
      g.score += 10 * mult;
      g.grow += 1;
      g.events.push('eat');
      g.food = null;
      g.food = emptyCell(g);
      if (g.apples % 5 === 0 && !g.gold) {
        g.gold = emptyCell(g);
        if (g.gold) { g.gold.ttl = GOLD_TICKS; g.events.push('gold-appears'); }
      }
    } else if (g.gold && same(g.gold, { x, y })) {
      g.golds++;
      g.score += 50 * mult;
      g.grow += 2;
      g.gold = null;
      g.events.push('gold');
    }
    if (g.gold && --g.gold.ttl <= 0) { g.gold = null; g.events.push('gold-gone'); }
    // Filled the whole board: nowhere left to put an apple.
    if (!g.food && !g.gold) { g.won = true; return die(g, 'won'); }
    return g;
  }

  // A little faster as the snake gets longer.
  function interval(g) {
    return Math.round(SPEEDS[g.speed].ms * Math.max(0.62, 1 - g.apples * 0.006));
  }

  return { SPEEDS, MODES, DIRS, create, turn, step, interval, GOLD_TICKS };
});
