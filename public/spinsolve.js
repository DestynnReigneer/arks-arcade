'use strict';

// Spin & Solve: spin the wheel, call a consonant, buy vowels, solve the
// phrase. Solo plays for the high-score board; 2-4 players share a phone.

(() => {
  const { $, toast } = ArcadeKit;
  const VOWELS = 'AEIOU';
  const VOWEL_COST = 250;
  const SOLVE_MIN = 1000;     // solving always banks at least this much
  const MAX_STRIKES = 3;      // solo: three misses and the round is lost
  const COLS = 12;

  // 24 wedges, clockwise from the top.
  const WEDGES = [500, 900, 300, 650, 'BANKRUPT', 400, 700, 350, 550, 800, 'LOSE A TURN', 450,
    600, 1000, 300, 500, 750, 400, 850, 350, 500, 600, 450, 700];
  const WEDGE_COLORS = ['#ff4fa3', '#ffc72c', '#2e9bff', '#3ddc84', '#a46bff', '#ff8a3d'];
  const SLICE = 360 / WEDGES.length;

  const S = {
    names: ['', ''], rounds: 3, players: [], cur: 0, round: 0, puzzle: null,
    revealed: new Set(), used: new Set(), strikes: 0, wedge: null, busy: false,
    rotation: 0, usedPuzzles: new Set()
  };
  const solo = () => S.players.length === 1;
  const money = n => '$' + n.toLocaleString('en-US');
  const letters = s => s.replace(/[^A-Z]/g, '');

  // ---- setup --------------------------------------------------------------------

  function renderNames() {
    const list = $('nameList');
    list.innerHTML = '';
    S.names.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'name-row';
      row.innerHTML = `<input maxlength="12" placeholder="Player ${i + 1}"><button title="Remove">✕</button>`;
      const input = row.querySelector('input');
      input.value = n;
      input.addEventListener('input', () => { S.names[i] = input.value; });
      row.querySelector('button').addEventListener('click', () => {
        if (S.names.length > 1) { S.names.splice(i, 1); renderNames(); }
      });
      list.appendChild(row);
    });
    $('addPlayerBtn').classList.toggle('hidden', S.names.length >= 4);
  }

  function startGame() {
    Blip.unlock();
    S.players = S.names.map((n, i) => ({ name: n.trim() || `Player ${i + 1}`, round: 0, total: 0 }));
    S.round = 0;
    $('setup').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('overView').classList.add('hidden');
    nextRound();
  }

  function pickPuzzle() {
    let pool = SPIN_PUZZLES.filter(p => !S.usedPuzzles.has(p.answer));
    if (!pool.length) { S.usedPuzzles.clear(); pool = SPIN_PUZZLES; }
    const p = pool[Math.floor(Math.random() * pool.length)];
    S.usedPuzzles.add(p.answer);
    return p;
  }

  function nextRound() {
    $('roundView').classList.add('hidden');
    S.round++;
    if (S.round > S.rounds) return gameOver();
    S.puzzle = pickPuzzle();
    S.revealed = new Set();
    S.used = new Set();
    S.strikes = 0;
    S.wedge = null;
    S.players.forEach(p => { p.round = 0; });
    S.cur = (S.round - 1) % S.players.length;
    render();
    say(`${S.players[S.cur].name}, spin the wheel!`);
  }

  // ---- the board ------------------------------------------------------------------

  // Wraps the answer into lines of at most 12 tiles, without splitting words.
  function lines(answer) {
    const out = [];
    let line = '';
    for (const word of answer.split(' ')) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= COLS) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out;
  }

  function renderBoard(flash) {
    const board = $('puzzleBoard');
    board.style.setProperty('--cols', COLS);
    board.innerHTML = '';
    const rows = lines(S.puzzle.answer);
    while (rows.length < 3) rows[rows.length % 2 ? 'push' : 'unshift']('');
    for (const line of rows) {
      const pad = Math.floor((COLS - line.length) / 2);
      for (let c = 0; c < COLS; c++) {
        const ch = line[c - pad];
        const tile = document.createElement('div');
        if (ch === undefined || ch === ' ') tile.className = 'tile blank';
        else if (!/[A-Z]/.test(ch) || S.revealed.has(ch)) {
          tile.className = 'tile shown' + (flash === ch ? ' flip' : '');
          tile.textContent = ch;
        } else tile.className = 'tile covered';
        board.appendChild(tile);
      }
    }
  }

  function renderPlayers() {
    const list = $('playerList');
    list.innerHTML = '';
    S.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = i === S.cur ? 'now' : '';
      li.innerHTML = '<div class="pn"></div><div class="pr"></div><div class="pt"></div>';
      li.querySelector('.pn').textContent = p.name;
      li.querySelector('.pr').textContent = money(p.round);
      li.querySelector('.pt').textContent = `Total ${money(p.total)}`;
      list.appendChild(li);
    });
  }

  function remaining(set) {
    return [...new Set(letters(S.puzzle.answer))].filter(ch => set.includes(ch) && !S.revealed.has(ch));
  }
  const consonantsLeft = () => remaining('BCDFGHJKLMNPQRSTVWXYZ');
  const vowelsLeft = () => remaining(VOWELS);

  function render(flash) {
    renderBoard(flash);
    $('categoryLabel').textContent = S.puzzle.category;
    $('roundLabel').textContent = `Round ${S.round} of ${S.rounds}`;
    $('strikes').textContent = solo() ? '❌'.repeat(S.strikes) + '⬜'.repeat(MAX_STRIKES - S.strikes) : '';
    renderPlayers();
    const p = S.players[S.cur];
    $('spinBtn').disabled = S.busy || !consonantsLeft().length;
    $('vowelBtn').disabled = S.busy || p.round < VOWEL_COST || !vowelsLeft().length;
    $('solveBtn').disabled = S.busy;
    $('usedLetters').textContent = S.used.size ? 'Called: ' + [...S.used].sort().join(' ') : '';
  }

  function say(text) { $('turnLine').textContent = text; }

  // ---- the wheel ------------------------------------------------------------------

  function buildWheel() {
    const g = $('wheelSpin');
    const ns = 'http://www.w3.org/2000/svg';
    const pt = (deg, r) => {
      const a = (deg - 90) * Math.PI / 180;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    WEDGES.forEach((w, i) => {
      const [x1, y1] = pt(i * SLICE, 100);
      const [x2, y2] = pt((i + 1) * SLICE, 100);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M0 0 L${x1} ${y1} A100 100 0 0 1 ${x2} ${y2} Z`);
      path.setAttribute('fill', w === 'BANKRUPT' ? '#111' : w === 'LOSE A TURN' ? '#f4ecd0' : WEDGE_COLORS[i % WEDGE_COLORS.length]);
      path.setAttribute('stroke', '#12111c');
      path.setAttribute('stroke-width', '1');
      g.appendChild(path);
      const text = document.createElementNS(ns, 'text');
      const mid = i * SLICE + SLICE / 2;
      text.setAttribute('transform', `rotate(${mid}) translate(0 -62) rotate(-90)`);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', typeof w === 'number' ? '11' : '6.5');
      text.setAttribute('font-weight', '800');
      text.setAttribute('fill', w === 'BANKRUPT' ? '#fff' : '#12111c');
      text.textContent = typeof w === 'number' ? w : w;
      g.appendChild(text);
    });
    const hub = document.createElementNS(ns, 'circle');
    hub.setAttribute('r', '14');
    hub.setAttribute('fill', '#12111c');
    hub.setAttribute('stroke', '#ffc72c');
    hub.setAttribute('stroke-width', '3');
    $('wheel').appendChild(hub);
  }

  const wedgeAt = rot => Math.floor((((360 - rot) % 360) + 360) % 360 / SLICE) % WEDGES.length;

  function spin() {
    if (S.busy) return;
    Blip.unlock();
    S.busy = true;
    $('landed').classList.add('hidden');
    render();
    const target = Math.floor(Math.random() * WEDGES.length);
    const jitter = (Math.random() - 0.5) * SLICE * 0.7;
    const want = 360 - (target * SLICE + SLICE / 2) + jitter;
    const startRot = S.rotation;
    const endRot = startRot + 360 * 4 + ((want - startRot) % 360 + 360) % 360;
    const duration = 3600;
    const t0 = performance.now();
    let lastWedge = wedgeAt(startRot);
    const g = $('wheelSpin');
    const frame = now => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      S.rotation = startRot + (endRot - startRot) * eased;
      g.setAttribute('transform', `rotate(${S.rotation})`);
      const w = wedgeAt(S.rotation);
      if (w !== lastWedge) { lastWedge = w; Blip.tone(1400, 0.015, { type: 'square', volume: 0.05 }); }
      if (t < 1) requestAnimationFrame(frame);
      else landed(WEDGES[wedgeAt(S.rotation)]);
    };
    requestAnimationFrame(frame);
  }

  function showLanded(text) {
    $('landed').innerHTML = '<span></span>';
    $('landed').firstChild.textContent = text;
    $('landed').classList.remove('hidden');
  }

  function landed(w) {
    const p = S.players[S.cur];
    if (w === 'BANKRUPT') {
      showLanded('💸 BANKRUPT');
      Blip.tune([[300, 0.15], [200, 0.15], [120, 0.4]], { type: 'sawtooth', volume: 0.08 });
      p.round = 0;
      S.busy = false;
      return endTurn(`${p.name} went bankrupt!`);
    }
    if (w === 'LOSE A TURN') {
      showLanded('🙅 LOSE A TURN');
      Blip.tone([400, 200], 0.3, { type: 'square', volume: 0.08 });
      S.busy = false;
      return endTurn(`${p.name} loses a turn.`);
    }
    showLanded(money(w));
    Blip.tone(880, 0.12, { type: 'triangle' });
    S.wedge = w;
    setTimeout(() => { S.busy = false; openLetters('consonant'); }, 650);
  }

  // ---- letters ------------------------------------------------------------------------

  let letterMode = 'consonant';
  function openLetters(mode) {
    letterMode = mode;
    $('letterTitle').textContent = mode === 'vowel' ? 'Buy a vowel' : `Pick a consonant for ${money(S.wedge)}`;
    $('letterHint').textContent = mode === 'vowel'
      ? `Costs ${money(VOWEL_COST)} from this round.`
      : 'Every time it\'s in the puzzle, you earn the amount you spun.';
    $('letterCancel').classList.toggle('hidden', mode !== 'vowel');
    const grid = $('letterGrid');
    grid.innerHTML = '';
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const b = document.createElement('button');
      b.textContent = ch;
      b.disabled = S.used.has(ch) || (mode === 'vowel') !== VOWELS.includes(ch);
      b.addEventListener('click', () => { $('letterView').classList.add('hidden'); callLetter(ch); });
      grid.appendChild(b);
    }
    $('letterView').classList.remove('hidden');
  }

  function callLetter(ch) {
    const p = S.players[S.cur];
    S.used.add(ch);
    const count = letters(S.puzzle.answer).split('').filter(c => c === ch).length;
    if (letterMode === 'vowel') p.round -= VOWEL_COST;
    if (!count) {
      Blip.tone([220, 140], 0.35, { type: 'sawtooth', volume: 0.08 });
      $('landed').classList.add('hidden');
      return endTurn(`No ${ch}. ${solo() ? 'Strike!' : 'Next player.'}`);
    }
    if (letterMode === 'consonant') p.round += S.wedge * count;
    S.revealed.add(ch);
    for (let i = 0; i < count; i++) Blip.tone(1046, 0.12, { type: 'triangle', delay: i * 0.18 });
    render(ch);
    $('landed').classList.add('hidden');
    say(`${count} ${ch}${count > 1 ? '\'s' : ''}! ${p.name}, go again: spin, buy a vowel, or solve.`);
    if (!consonantsLeft().length && !vowelsLeft().length) return solved();
    if (!consonantsLeft().length) say('No consonants left! Buy a vowel or solve.');
  }

  function endTurn(message) {
    if (solo()) {
      S.strikes++;
      render();
      if (S.strikes >= MAX_STRIKES) return roundLost();
      say(`${message} ${MAX_STRIKES - S.strikes} strike${MAX_STRIKES - S.strikes === 1 ? '' : 's'} left.`);
      return;
    }
    S.cur = (S.cur + 1) % S.players.length;
    render();
    say(`${message} ${S.players[S.cur].name}, your turn!`);
  }

  // ---- solving --------------------------------------------------------------------------

  function openSolve() {
    $('solveCategory').textContent = S.puzzle.category;
    $('solveInput').value = '';
    $('solveMsg').textContent = '';
    $('solveView').classList.remove('hidden');
    $('solveInput').focus();
  }

  function trySolve() {
    const guess = letters($('solveInput').value.toUpperCase());
    if (!guess) { $('solveMsg').textContent = 'Type your answer first.'; return; }
    $('solveView').classList.add('hidden');
    if (guess === letters(S.puzzle.answer)) return solved();
    Blip.tone([220, 140], 0.4, { type: 'sawtooth', volume: 0.08 });
    endTurn('Not quite!');
  }

  function solved() {
    const p = S.players[S.cur];
    const won = Math.max(p.round, SOLVE_MIN);
    p.total += won;
    for (const ch of letters(S.puzzle.answer)) S.revealed.add(ch);
    S.players.forEach(x => { x.round = 0; });
    render();
    Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]], { type: 'triangle' });
    showRound('🎉', `${p.name} solved it!`, `+${money(won)}`);
  }

  function roundLost() {
    for (const ch of letters(S.puzzle.answer)) S.revealed.add(ch);
    S.players.forEach(x => { x.round = 0; });
    render();
    showRound('😵', 'Three strikes!', 'This round banks nothing.');
  }

  function showRound(emoji, title, hint) {
    $('roundEmoji').textContent = emoji;
    $('roundTitle').textContent = title;
    $('roundAnswer').textContent = S.puzzle.answer;
    $('roundHint').textContent = hint;
    $('nextRoundBtn').textContent = S.round >= S.rounds ? 'See the results' : 'Next round';
    setTimeout(() => $('roundView').classList.remove('hidden'), 700);
  }

  // ---- the end -----------------------------------------------------------------------------

  let initials = null;
  function gameOver() {
    const ranked = S.players.slice().sort((a, b) => b.total - a.total);
    $('overTitle').textContent = solo() ? `You banked ${money(ranked[0].total)}!` : `${ranked[0].name} wins!`;
    $('finalList').innerHTML = '';
    for (const p of ranked) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><span></span>';
      li.firstChild.textContent = p.name;
      li.lastChild.textContent = money(p.total);
      $('finalList').appendChild(li);
    }
    const canSave = solo() && ranked[0].total > 0;
    $('overScore').classList.toggle('hidden', !canSave);
    $('saveScoreBtn').disabled = false;
    $('scoreMsg').textContent = '';
    $('overView').classList.remove('hidden');
    if (canSave) setTimeout(() => initials.reset(), 50);
  }

  async function saveScore() {
    const who = initials.value();
    if (!who) { $('scoreMsg').textContent = 'Type your initials first.'; return; }
    $('saveScoreBtn').disabled = true;
    try {
      const r = await ArcadeKit.saveScore('spinsolve', {
        initials: who, score: S.players[0].total, board: 'solo', detail: `${S.rounds} rounds`
      });
      initials.remember(who);
      $('overScore').classList.add('hidden');
      openScores(r.id);
      toast(r.rank === 1 ? '🏆 New #1!' : `Saved: #${r.rank}`);
    } catch (e) {
      $('scoreMsg').textContent = e.message;
      $('saveScoreBtn').disabled = false;
    }
  }

  function openScores(highlightId) {
    ArcadeKit.loadScores('spinsolve', 'solo', $('scoreList'), highlightId);
    $('scoresView').classList.remove('hidden');
  }

  function backToSetup() {
    $('overView').classList.add('hidden');
    $('roundView').classList.add('hidden');
    $('game').classList.add('hidden');
    $('setup').classList.remove('hidden');
  }

  // ---- how to play ----------------------------------------------------------------------

  const help = Tutorial.create('spinsolve', [
    {
      emoji: '🎯', title: 'The goal',
      html: `<p>Figure out the hidden <b>phrase</b> on the board. The <b>category</b> under it tells you what kind of thing it is.</p>
        <p>Bank the most money by the end of the last round to win.</p>`
    },
    {
      emoji: '🎡', title: 'Spin, then call a letter',
      html: `<p>Tap <b>Spin</b>. Where the wheel stops is what each letter is worth.</p>
        <p>Pick a <b>consonant</b> (not A E I O U). Every time it's in the puzzle, you earn that much, and you go again.</p>
        <p>If it isn't there, your turn ends.</p>`
    },
    {
      emoji: '💸', title: 'Watch out',
      html: `<table>
          <tr><td>💸 Bankrupt</td><td>You lose this round's money and your turn.</td></tr>
          <tr><td>🙅 Lose a turn</td><td>Your turn ends, but you keep your money.</td></tr>
        </table>`
    },
    {
      emoji: '🅰️', title: 'Vowels and solving',
      html: `<p><b>Buy a vowel</b> for $250 of this round's money. It shows every A, E, I, O or U you pick.</p>
        <p>Think you know it? Tap <b>Solve</b> and type the whole answer. Get it right and you bank this round's money (at least $1,000). Get it wrong and your turn ends.</p>`
    },
    {
      emoji: '🎮', title: 'Solo or together',
      html: `<p><b>Solo:</b> you get 3 strikes a round: a missing letter, a wrong answer, Bankrupt or Lose a Turn each cost one. Your total goes on the 🏆 board.</p>
        <p><b>2–4 players:</b> pass the phone. Only whoever solves keeps that round's money.</p>
        <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
    }
  ]);

  // ---- wiring ---------------------------------------------------------------------------

  $('addPlayerBtn').addEventListener('click', () => { if (S.names.length < 4) { S.names.push(''); renderNames(); } });
  for (const b of $('roundSeg').children) {
    b.addEventListener('click', () => {
      S.rounds = Number(b.dataset.rounds);
      for (const x of $('roundSeg').children) x.setAttribute('aria-pressed', String(x === b));
    });
  }
  $('goBtn').addEventListener('click', startGame);
  $('spinBtn').addEventListener('click', spin);
  $('vowelBtn').addEventListener('click', () => openLetters('vowel'));
  $('solveBtn').addEventListener('click', openSolve);
  $('letterCancel').addEventListener('click', () => $('letterView').classList.add('hidden'));
  $('solveOk').addEventListener('click', trySolve);
  $('solveInput').addEventListener('keydown', e => { if (e.key === 'Enter') trySolve(); });
  $('solveCancel').addEventListener('click', () => $('solveView').classList.add('hidden'));
  $('nextRoundBtn').addEventListener('click', nextRound);
  $('againBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', backToSetup);
  $('quitBtn').addEventListener('click', () => { if (confirm('Leave this game?')) backToSetup(); });
  $('saveScoreBtn').addEventListener('click', saveScore);
  $('scoresBtn').addEventListener('click', () => openScores());
  $('scoresClose').addEventListener('click', () => $('scoresView').classList.add('hidden'));
  $('helpBtn').addEventListener('click', () => help.open());
  Blip.muteButton($('muteBtn'));
  initials = ArcadeKit.wireInitials([...document.querySelectorAll('#overScore .ini')], saveScore);

  buildWheel();
  renderNames();
  help.autoOpen();
})();
