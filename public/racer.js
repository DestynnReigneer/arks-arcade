'use strict';

// ARKS Racer's page: the game (cab-racer.js) runs in the cabinet frame (cab-frame.js), and GameShell handles the
// game-over panel and the boards, one per track. The score is the finishing time in thousandths of a second, and lower
// is better. The page sends the time it measured; the server refuses one no real race could take (arcade/scores.js),
// the deliberate exception the 3D cabinet games make to "the server decides".
(() => {
  const $ = id => document.getElementById(id);
  const game = CAB.games[0];
  const tracks = game.options.find(o => o.id === 'track').choices;
  // 62345 -> "1:02.35"
  const time = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };

  const shell = GameShell.create({
    game: 'racer', boards: Object.fromEntries(tracks), mount: $('cab'),
    format: time, lowerIsBetter: true,
    onAgain: () => frame.start(),
    onSetup: () => frame.setup()
  });

  const frame = CabFrame.run({
    game, root: $('cab'), muteBtn: $('muteBtn'), musicBtn: $('musicBtn'),
    onStart: () => shell.hideOver(),
    onSetup: () => shell.hideOver(),
    onOver: g => {
      const f = g.final();
      // a race that ran out of time shows no score and isn't saved
      setTimeout(() => shell.over({ score: f.score, board: f.board, detail: f.detail, title: f.score ? 'Finished!' : `Time's up on lap ${Math.min(3, (g.lap || 0) + 1)}` }), 1600);
    }
  });

  $('scoresBtn').addEventListener('click', () => shell.openScores(game.opt.track));
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));

  // ---- how to play -------------------------------------------------------------------------------
  const help = Tutorial.create('racer', [
    {
      emoji: '🏎️', title: 'Three laps against the clock',
      html: `<p>Race three laps before the clock runs out. You start with 32 seconds, and every lap you finish adds 24 more. The faster you finish, the better your time on that track's board.</p>
        <p>Let off the gas to slow down for a turn; there's no brake. Driving off the road slows you down, and on Star Road it drops you into space until you're beamed back.</p>`
    },
    {
      emoji: '🕹️', title: 'Steering',
      html: `<table>
          <tr><td>📱 Touch screen</td><td>With <b>Touch: Tap like the keys</b>, tap or hold the left or right half of the game to steer: a tap is a small nudge, more taps turn more, and letting go straightens out. With <b>Slide</b>, put a finger down and slide it left or right. The arrow and GAS buttons under the game work too.</td></tr>
          <tr><td>⌨️ Keyboard</td><td><b>↑</b> or <b>W</b> is the gas, and <b>←</b> <b>→</b> or <b>A</b> <b>D</b> steer. <b>P</b> pauses.</td></tr>
          <tr><td>🎮 Controller</td><td>The D-pad or left stick steers, and <b>A</b> or the right trigger is the gas. <b>Start</b> pauses.</td></tr>
        </table>
        <p>The steering bar at the bottom shows how far you're turning.</p>`
    },
    {
      emoji: '⚙️', title: 'Tracks and settings',
      html: `<p><b>Track</b> picks one of eight, each its own place with its own music, and some have speed pads on the straights. <b>Gas</b> is held (touching the game or holding the key) or always on. Each track has its own board.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => { frame.pause(); help.open(); });
  help.autoOpen();
})();
