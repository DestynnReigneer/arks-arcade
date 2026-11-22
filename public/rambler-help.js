'use strict';

// How to play Rambler. Opens on the first visit; the ? button brings it back.
window.ramblerTutorial = Tutorial.create('rambler', [
  {
    emoji: '🔠',
    title: 'The goal',
    html: `<p>You get a grid of letter tiles. <b>Ramble</b> from letter to letter, chaining them into <b>as many words as you can</b> before the timer runs out.</p>
      <p>Longer words score <b>a lot</b> more.</p>`
  },
  {
    emoji: '👆',
    title: 'Making a word',
    html: `<p><b>Drag your finger</b> across letters that <b>touch</b> — up, down, sideways or diagonally — then let go.</p>
      <p>Or just <b>type the word</b> in the box and tap Add.</p>
      <ul><li>Each letter tile can only be used <b>once</b> per word.</li>
        <li>Words need at least <b>3 letters</b> — sometimes more on harder settings or the big 5×5 board. The game shows the minimum while you play.</li></ul>`
  },
  {
    emoji: '🧮',
    title: 'Scoring',
    html: `<table>
        <tr><td>3–4 letters</td><td>1 point</td></tr>
        <tr><td>5 letters</td><td>2 points</td></tr>
        <tr><td>6 letters</td><td>3 points</td></tr>
        <tr><td>7 letters</td><td>5 points</td></tr>
        <tr><td>8+ letters</td><td>11 points 🤯</td></tr>
      </table>
      <p>When a <b>theme pack</b> is running, its words score <b>double</b>.</p>`
  },
  {
    emoji: '👥',
    title: 'Playing with others',
    html: `<p>The classic Boggle rule: if <b>more than one player</b> has the same word, <b>neither of them</b> score.</p>
      <p>So hunt for the words nobody else will think of.</p>`
  },
  {
    emoji: '🎮',
    title: 'Ways to play',
    html: `<table>
        <tr><td>📅 Daily challenge</td><td>One board a day for the whole house.</td></tr>
        <tr><td><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:1.2em;height:1.2em;vertical-align:-0.25em;margin-right:2px"><circle cx="16" cy="7" r="3.2"/><path d="M10 18.5c0-3.4 2.6-5.8 6-5.8s6 2.4 6 5.8"/><circle cx="6.5" cy="10" r="2.6"/><path d="M2 20c0-2.8 1.9-4.8 4.5-4.8"/><circle cx="25.5" cy="10" r="2.6"/><path d="M30 20c0-2.8-1.9-4.8-4.5-4.8"/><path d="M11 30l7-7"/><path d="M18 23a4 4 0 0 1 5.3-5l-2.4 2.4.5 2.2 2.2.5 2.4-2.4a4 4 0 0 1-5 5.3"/></svg> Create a game lobby</td><td>Choose your settings and open a lobby that others can join.</td></tr>
        <tr><td>🔎 List Hosted Games</td><td>Lobbies waiting for players, and games that still have room to join.</td></tr>
        <tr><td>🔥 Marathon</td><td>Each word buys more time, and the grid grows.</td></tr>
        <tr><td>🙂 Solo</td><td>You against the clock.</td></tr>
        <tr><td colspan="2" style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.7;padding-top:10px">📱 Multiplayer-Shared device</td></tr>
        <tr><td>🤝 Pass &amp; Play</td><td>One device, take turns on the same board.</td></tr>
      </table>`
  },
  {
    emoji: '💡',
    title: 'Hints, profiles and the board',
    html: `<p>Pick a <b>profile</b> (top right) to earn <b>coins</b>, streaks and badges as you play.</p>
      <p><b>Hint</b> spends coins to show you a word that's on the board.</p>
      <p>Score high enough and your score goes on the 🏆 board under your name, with nothing to type.</p>
      <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
  }
]);
