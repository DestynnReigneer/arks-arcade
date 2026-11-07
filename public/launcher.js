'use strict';

// ARKS Launcher's page: the game (cab-launcher.js) runs in the cabinet frame (cab-frame.js), and GameShell handles the
// game-over panel and the high scores. The page sends the points it counted; the server refuses a score no real game
// could reach (arcade/scores.js), the deliberate exception the 3D cabinet games make to "the server decides".
(() => {
  const $ = id => document.getElementById(id);

  const shell = GameShell.create({
    game: 'launcher', boards: { points: 'Points' }, mount: $('cab'),
    onAgain: () => frame.start()
  });

  const frame = CabFrame.run({
    game: CAB.games[0], root: $('cab'), muteBtn: $('muteBtn'), musicBtn: $('musicBtn'),
    onStart: () => shell.hideOver(),
    onOver: g => {
      const f = g.final();
      setTimeout(() => shell.over({ score: f.score, board: f.board, detail: f.detail, title: `Out of balls on level ${g.level || 1}` }), 1600);
    }
  });

  $('scoresBtn').addEventListener('click', () => shell.openScores('points'));
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));

  // ---- how to play -------------------------------------------------------------------------------
  const help = Tutorial.create('launcher', [
    {
      emoji: '🚀', title: 'Pull back and launch',
      html: `<p><b>Hold</b> the game or the big button to pull the plunger back, and <b>let go</b> to launch the ball up the lane. The longer you hold, the harder it goes; the power bar on the right shows it, and a white line marks your last pull.</p>
        <p>The ball pushes through the clear gates on the way up, but they won't let it back down. When it stops, the last gate it passed is what you win.</p>
        <table>
          <tr><td>📱 Phone</td><td>Hold the game or the big button, and let go.</td></tr>
          <tr><td>⌨️ Keyboard</td><td>Hold <b>Space</b> and let go. <b>P</b> pauses.</td></tr>
          <tr><td>🎮 Controller</td><td>Hold <b>A</b>, <b>X</b>, <b>R1</b> or the right trigger. <b>Start</b> pauses.</td></tr>
        </table>`
    },
    {
      emoji: '🎰', title: 'The Super Bonus and the levels',
      html: `<p>The glowing green gate is the <b>Super Bonus</b>. It has tight gates on both sides, so too soft stops short and too hard sails past. Its jackpot grows every time you miss it.</p>
        <p>Land in it and you move up a level: the first five refill all 8 balls, and from level 6 on a refill is 4. There are 20 levels with ramps, bead curtains, potholes, a headwind and a jackpot that slides back and forth, and after the last one it starts over.</p>`
    },
    {
      emoji: '⚙️', title: 'Settings',
      html: `<p><b>Start at</b> jumps straight to any level (your score says where you started). <b>After a roll</b> picks whether the gates open and the ball rolls back to you, or it just disappears. <b>View</b> is the TV camera, from the side, or a close-up of the jackpot.</p>
        <p>The game ends when you're out of balls.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => { frame.pause(); help.open(); });
  help.autoOpen();
})();
