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
    html: `<p>The classic Boggle rule: if <b>more than one player</b> finds the same word, <b>nobody</b> scores it.</p>
      <p>So hunt for the words nobody else will think of.</p>`
  },
  {
    emoji: '🎮',
    title: 'Ways to play',
    html: `<table>
        <tr><td>🙂 Solo</td><td>You against the clock.</td></tr>
        <tr><td>🤝 Pass &amp; Play</td><td>One phone, take turns on the same board.</td></tr>
        <tr><td>📝 Tabletop</td><td>Everyone writes on paper, then types their lists in.</td></tr>
        <tr><td>📱 Own Phones</td><td>Everyone on their own phone with a room code.</td></tr>
        <tr><td>🔥 Marathon</td><td>Each word buys more time, and the grid grows.</td></tr>
        <tr><td>📅 Today's Board</td><td>One board a day for the whole house.</td></tr>
      </table>`
  },
  {
    emoji: '💡',
    title: 'Hints, profiles and the board',
    html: `<p>Pick a <b>profile</b> (top right) to earn <b>coins</b>, streaks and badges as you play.</p>
      <p><b>Hint</b> spends coins to show you a word that's on the board.</p>
      <p>Score high enough and you'll be asked for your initials to get on the 🏆 board.</p>
      <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
  }
]);
