'use strict';

// Bucket Drop's page: the game (cab-bucket.js) runs in the cabinet frame (cab-frame.js), and GameShell handles the
// game-over panel and the high scores. The page sends the points it counted; the server refuses a score no real game
// could reach, and a jackpot score must match a jackpot really won here (arcade/cab-jackpot.js).
(() => {
  const $ = id => document.getElementById(id);

  const shell = GameShell.create({
    game: 'bucketdrop', boards: { points: 'Points' }, mount: $('cab'),
    onAgain: () => frame.start()
  });

  const frame = CabFrame.run({
    game: CAB.games[0], root: $('cab'), muteBtn: $('muteBtn'), musicBtn: $('musicBtn'),
    onStart: () => shell.hideOver(),
    onOver: g => {
      const f = g.final();
      setTimeout(() => shell.over({ score: f.score, board: f.board, detail: f.detail, title: g.caught === 50 ? 'JACKPOT! All 50! 🏆' : `${g.caught} of 50 caught` }), 1600);
    }
  });

  $('scoresBtn').addEventListener('click', () => shell.openScores('points'));
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));

  // ---- how to play -------------------------------------------------------------------------------
  const help = Tutorial.create('bucketdrop', [
    {
      emoji: '🪣', title: 'Drop the balls in the cups',
      html: `<p>Five clear cups ride around on a spinning turntable. Every <b>tap</b> drops one ball from the clear tube above them, and you want each one to land in a cup. You have <b>50 balls</b> and <b>30 seconds</b>, and the clock starts on your first tap. The turntable speeds up as the time runs down.</p>
        <table>
          <tr><td>📱 Phone</td><td>Tap the game or the big Drop button.</td></tr>
          <tr><td>⌨️ Keyboard</td><td><b>Space</b> drops a ball. <b>P</b> pauses.</td></tr>
          <tr><td>🎮 Controller</td><td><b>A</b>, <b>X</b>, <b>R1</b> or the right trigger. <b>Start</b> pauses.</td></tr>
        </table>`
    },
    {
      emoji: '💯', title: 'Points and the jackpot',
      html: `<p>Every ball you catch is <b>10 points</b>, and every 5 in a row adds <b>25 more</b>. A ball that hits a rim or misses rolls off into the gutter and breaks your streak.</p>
        <p>Catch <b>all 50</b> to win the <b>jackpot</b> on the big screen. It's the whole arcade's jackpot: it starts at 1,000 and grows by 10 every game until somebody wins it.</p>`
    },
    {
      emoji: '⚙️', title: 'Make it easier or harder',
      html: `<p><b>Cups</b> sets how big the cups are, and <b>Speed</b> sets how fast the turntable spins. They're saved on this device, and your score on the board says which you played with.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => { frame.pause(); help.open(); });
  help.autoOpen();
})();
