'use strict';

// Spin & Solve's robot co-hosts. A different one runs each round. They're
// original characters (nods to famous movie robots, not copies), each drawn
// as SVG on a 60 x 110 canvas with the same named parts so the same poses
// work for all of them:
//   .h-body  everything that bobs    .h-head  tilts when things go wrong
//   .h-arm-r reaches up to the tiles .h-arm-l joins in for a cheer
//   .h-eyes  blinks                  .h-smile flips to a frown
// Each part's pivot is set inline (transform-origin). `hand` is how far right
// of the middle the reaching hand ends up, in screen pixels, so the host can
// stand with it under a tile.

const SPIN_HOSTS = {
  vee: {
    name: 'Vee', hand: 14,
    voice: { notes: [[1200, 0.05], [1600, 0.07]], type: 'sine' },
    intro: ['Hi, I\'m Vee! Let\'s play!', 'Vee here. Spin to win!'],
    lines: {},
    svg: `<svg class="host-svg" viewBox="0 0 60 110">
      <defs>
        <linearGradient id="vee-chrome" x1="0" x2="1"><stop offset="0" stop-color="#dfe9ff"/><stop offset=".45" stop-color="#fff"/><stop offset="1" stop-color="#9fb1d6"/></linearGradient>
        <linearGradient id="vee-gown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4fa3"/><stop offset=".6" stop-color="#a46bff" stop-opacity=".85"/><stop offset="1" stop-color="#2de2e6" stop-opacity="0"/></linearGradient>
        <linearGradient id="vee-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ac0"/><stop offset="1" stop-color="#b23cff"/></linearGradient>
        <radialGradient id="vee-glow"><stop offset="0" stop-color="#2de2e6" stop-opacity=".9"/><stop offset="1" stop-color="#2de2e6" stop-opacity="0"/></radialGradient>
      </defs>
      <ellipse class="h-shadow" cx="30" cy="105" rx="17" ry="4" fill="url(#vee-glow)"/>
      <g class="h-body">
        <path class="h-gown" d="M23 55 Q30 58 37 55 L49 99 Q30 106 11 99 Z" fill="url(#vee-gown)"/>
        <g class="h-arm-l" style="transform-origin:21px 38px"><path d="M21 38 Q14 47 16 57" stroke="url(#vee-chrome)" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="16" cy="58" r="2.3" fill="#ff4fa3"/></g>
        <path d="M20 35 Q30 32 40 35 L37 56 Q30 58.5 23 56 Z" fill="url(#vee-chrome)"/>
        <path d="M21.5 39 L38.5 49" stroke="#2de2e6" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="27" y="29" width="6" height="5" rx="1" fill="#9fb1d6"/>
        <g class="h-head" style="transform-origin:30px 30px">
          <path d="M17 19 Q15 3 30 3 Q46 3 44 19 L47 31 Q41 28 40.5 21 Q30 12 19.5 21 Q19 28 13 31 Z" fill="url(#vee-hair)"/>
          <ellipse cx="30" cy="19" rx="11" ry="12" fill="url(#vee-chrome)"/>
          <rect x="19.5" y="14.5" width="21" height="7.5" rx="3.75" fill="#12111c"/>
          <g class="h-eyes"><rect x="23" y="16.6" width="5" height="3.2" rx="1.6" fill="#2de2e6"/><rect x="32" y="16.6" width="5" height="3.2" rx="1.6" fill="#2de2e6"/></g>
          <path class="h-smile" style="transform-origin:30px 27px" d="M26 25.5 Q30 28.5 34 25.5" stroke="#ff4fa3" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          <circle class="h-antenna" cx="44.5" cy="9" r="1.6" fill="#2de2e6"/>
        </g>
        <g class="h-arm-r" style="transform-origin:39px 38px"><path d="M39 38 Q46 47 44 57" stroke="url(#vee-chrome)" stroke-width="4" stroke-linecap="round" fill="none"/><circle class="h-hand" cx="44" cy="58" r="2.6" fill="#2de2e6"/></g>
      </g>
    </svg>`
  },

  // A sarcastic tin-can bot.
  tinny: {
    name: 'Tinny', hand: 15,
    voice: { notes: [[180, 0.08], [140, 0.11]], type: 'square' },
    intro: ['Tinny\'s hosting. Try to keep up.', 'Ugh, fine. I\'m Tinny. Let\'s go.'],
    lines: {
      hello: ['Let\'s get this over with.', 'I\'m only here for the money.', 'Spin it, human.'],
      hit: () => ['Not bad… for a human.', 'Fine. You got one.', 'Lucky guess.'],
      miss: ['Ha! Nope.', 'Wow. Just wow.', 'Nailed it. Not.'],
      bankrupt: ['Ha ha! Bankrupt!', 'I\'ll hold that money for you.', 'Best. Spin. Ever.'],
      lose: ['Skipped! Ha!'],
      spin: ['Spin harder, flesh-thing.', 'Wake me when it stops.'],
      solved: ['Show-off.', 'OK… that was pretty good.'],
      wrong: ['Not even close, pal.']
    },
    svg: `<svg class="host-svg" viewBox="0 0 60 110">
      <defs><linearGradient id="tn-metal" x1="0" x2="1"><stop offset="0" stop-color="#9aa4b5"/><stop offset=".45" stop-color="#e6ebf2"/><stop offset="1" stop-color="#6d7688"/></linearGradient></defs>
      <ellipse class="h-shadow" cx="30" cy="104" rx="16" ry="3" fill="rgba(0,0,0,.45)"/>
      <g class="h-body">
        <rect x="21" y="66" width="6" height="32" rx="3" fill="url(#tn-metal)"/>
        <rect x="33" y="66" width="6" height="32" rx="3" fill="url(#tn-metal)"/>
        <ellipse cx="24" cy="100" rx="6" ry="3" fill="#6d7688"/><ellipse cx="36" cy="100" rx="6" ry="3" fill="#6d7688"/>
        <g class="h-arm-l" style="transform-origin:18px 38px"><path d="M18 38 q-6 6 -3 12 q3 6 -2 12" stroke="url(#tn-metal)" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="13" cy="63" r="2.6" fill="#6d7688"/></g>
        <rect x="16" y="33" width="28" height="35" rx="7" fill="url(#tn-metal)"/>
        <rect x="22" y="42" width="16" height="16" rx="2" fill="none" stroke="#6d7688" stroke-width="1"/>
        <g class="h-head" style="transform-origin:30px 32px">
          <line x1="30" y1="7" x2="30" y2="1.5" stroke="#6d7688" stroke-width="1.5"/>
          <circle class="h-antenna" cx="30" cy="1.5" r="2" fill="#c9d1de"/>
          <path d="M20 32 L20 14 Q20 6 30 6 Q40 6 40 14 L40 32 Z" fill="url(#tn-metal)"/>
          <rect x="17" y="13" width="26" height="10" rx="5" fill="#1b2433"/>
          <circle cx="24" cy="18" r="4" fill="#fff8d6"/><circle cx="36" cy="18" r="4" fill="#fff8d6"/>
          <g class="h-eyes"><rect x="22.5" y="16.5" width="3" height="3" fill="#111"/><rect x="34.5" y="16.5" width="3" height="3" fill="#111"/></g>
          <g class="h-smile" style="transform-origin:30px 27.5px"><rect x="23" y="25" width="14" height="5" rx="1" fill="#f1f4f9"/><path d="M26.5 25 v5 M30 25 v5 M33.5 25 v5 M23 27.5 h14" stroke="#6d7688" stroke-width=".6"/></g>
        </g>
        <g class="h-arm-r" style="transform-origin:42px 38px"><path d="M42 38 q6 6 3 12 q-3 6 2 12" stroke="url(#tn-metal)" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle class="h-hand" cx="47" cy="63" r="2.6" fill="#6d7688"/></g>
      </g>
    </svg>`
  },

  // A beeping dome droid. Speaks in beeps, with subtitles.
  bleep: {
    name: 'Bleep', hand: 22,
    voice: { beeps: true },
    intro: ['Bweep-boop! (I\'m Bleep, your host!)', 'Dweet-dweet! (Bleep is hosting!)'],
    lines: {
      hello: ['Bweep-boop! (Let\'s play!)', 'Dee-dweet! (Good luck!)'],
      hit: () => ['Bee-doo-dee! (Nice!)', 'Dwee-dwee! (Found it!)'],
      miss: ['Bwoooo… (Nope.)', 'Doo-dwop. (Not there.)'],
      bankrupt: ['BWAAAAH! (Bankrupt!)', 'Wheeoo-wop… (Ouch.)'],
      lose: ['Boo-dop. (Skip!)'],
      spin: ['Wheeeeooo!', 'Dwee-dwee-dwee!'],
      solved: ['Dee-doo-dweep! (You did it!)'],
      wrong: ['Bwop-bwop. (Nope.)'],
      vowel: ['Bip! (One vowel!)']
    },
    svg: `<svg class="host-svg" viewBox="0 0 60 110">
      <defs>
        <linearGradient id="bl-dome" x1="0" x2="1"><stop offset="0" stop-color="#9fb0c8"/><stop offset=".5" stop-color="#f4f7ff"/><stop offset="1" stop-color="#7f8ea8"/></linearGradient>
        <linearGradient id="bl-body" x1="0" x2="1"><stop offset="0" stop-color="#cfd8e6"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#b5c0d3"/></linearGradient>
      </defs>
      <ellipse class="h-shadow" cx="30" cy="105" rx="22" ry="3" fill="rgba(0,0,0,.45)"/>
      <g class="h-body">
        <rect x="6" y="50" width="8" height="46" rx="3" fill="url(#bl-body)" stroke="#8a97ad" stroke-width=".6"/>
        <rect x="46" y="50" width="8" height="46" rx="3" fill="url(#bl-body)" stroke="#8a97ad" stroke-width=".6"/>
        <path d="M2 104 L6 94 L14 94 L18 104 Z" fill="#8a97ad"/><path d="M42 104 L46 94 L54 94 L58 104 Z" fill="#8a97ad"/>
        <rect x="15" y="46" width="30" height="44" rx="4" fill="url(#bl-body)"/>
        <rect x="19" y="52" width="9" height="12" rx="1" fill="#2a6cff"/><rect x="31" y="52" width="10" height="5" rx="1" fill="#2a6cff"/>
        <rect x="31" y="59" width="10" height="5" rx="1" fill="#9fb0c8"/><rect x="19" y="68" width="22" height="3" fill="#2a6cff"/>
        <rect x="19" y="74" width="22" height="10" rx="1" fill="#dde3ee" stroke="#9fb0c8" stroke-width=".6"/>
        <path d="M24 90 L36 90 L38 100 L22 100 Z" fill="#8a97ad"/>
        <g class="h-arm-l" style="transform-origin:16px 64px"><rect x="10" y="62" width="6" height="4" rx="1" fill="#9fb0c8"/></g>
        <g class="h-head" style="transform-origin:30px 46px">
          <path d="M14 46 A16 16 0 0 1 46 46 Z" fill="url(#bl-dome)"/>
          <rect x="17" y="40" width="5" height="4" fill="#2a6cff"/><rect x="38" y="40" width="5" height="4" fill="#2a6cff"/>
          <rect x="25" y="32.5" width="10" height="3" fill="#2a6cff"/>
          <circle cx="30" cy="40" r="4.2" fill="#0d0f18"/>
          <g class="h-eyes"><circle cx="31" cy="39" r="1.5" fill="#ff4f4f"/></g>
          <circle class="h-antenna" cx="37.5" cy="35.5" r="1.3" fill="#2de2e6"/>
        </g>
        <g class="h-arm-r" style="transform-origin:45px 64px">
          <path d="M45 64 L53 64" stroke="#9fb0c8" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M53 61.5 L56 64 L53 66.5" stroke="#9fb0c8" stroke-width="1.6" fill="none"/>
          <circle class="h-hand" cx="56" cy="64" r="1.2" fill="#2de2e6"/>
        </g>
      </g>
    </svg>`
  },

  // A fussy gold butler bot who always knows the odds.
  brass: {
    name: 'Brass', hand: 12,
    voice: { notes: [[620, 0.06], [720, 0.06], [660, 0.09]], type: 'triangle' },
    intro: ['Oh! Hello! I am Brass, your host.', 'Brass, at your service. How thrilling!'],
    lines: {
      hello: ['Oh, how exciting! A game!', 'I do hope nobody goes bankrupt.'],
      hit: () => ['Splendid!', 'Oh, well done, well done!'],
      miss: ['Oh dear. Oh dear, oh dear.', 'Oh my, how unfortunate.'],
      bankrupt: ['Oh no! The odds were 24 to 1!', 'I can\'t bear to watch!'],
      lose: ['Oh! Dreadfully sorry.'],
      spin: ['The odds of a good spin are… oh, never mind.', 'I can\'t look!'],
      solved: ['Simply splendid!', 'Marvelous! Absolutely marvelous!'],
      wrong: ['Oh dear, that\'s not it at all.']
    },
    svg: `<svg class="host-svg" viewBox="0 0 60 110">
      <defs><linearGradient id="br-gold" x1="0" x2="1"><stop offset="0" stop-color="#a7741c"/><stop offset=".45" stop-color="#ffe08a"/><stop offset="1" stop-color="#8a5c12"/></linearGradient></defs>
      <ellipse class="h-shadow" cx="30" cy="104" rx="15" ry="3" fill="rgba(0,0,0,.45)"/>
      <g class="h-body">
        <rect x="22" y="62" width="6" height="36" rx="2.5" fill="url(#br-gold)"/><rect x="32" y="62" width="6" height="36" rx="2.5" fill="url(#br-gold)"/>
        <circle cx="25" cy="80" r="2.2" fill="#8a5c12"/><circle cx="35" cy="80" r="2.2" fill="#8a5c12"/>
        <ellipse cx="25" cy="100" rx="5" ry="2.6" fill="#8a5c12"/><ellipse cx="35" cy="100" rx="5" ry="2.6" fill="#8a5c12"/>
        <g class="h-arm-l" style="transform-origin:19px 33px"><path d="M19 33 L15 46 L17 58" stroke="url(#br-gold)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17" cy="59" r="2.4" fill="#8a5c12"/></g>
        <rect x="24" y="49" width="12" height="14" fill="#8a5c12"/>
        <path d="M25 52 q5 3 10 0 M25 56 q5 3 10 0" stroke="#c0c6d4" stroke-width=".8" fill="none"/>
        <path d="M18 31 Q30 27 42 31 L39 50 Q30 53 21 50 Z" fill="url(#br-gold)"/>
        <circle cx="30" cy="40" r="3.5" fill="#c0c6d4" stroke="#8a5c12" stroke-width=".6"/>
        <g class="h-head" style="transform-origin:30px 27px">
          <rect x="28" y="22" width="4" height="6" fill="#8a5c12"/>
          <ellipse cx="30" cy="14.5" rx="9" ry="10.5" fill="url(#br-gold)"/>
          <path d="M22 11 Q30 8 38 11" stroke="#8a5c12" stroke-width="1" fill="none"/>
          <g class="h-eyes"><circle cx="26" cy="15" r="2.7" fill="#fff3a0"/><circle cx="34" cy="15" r="2.7" fill="#fff3a0"/></g>
          <rect class="h-smile" style="transform-origin:30px 21.3px" x="27.5" y="20.5" width="5" height="1.6" rx=".8" fill="#5a3b0a"/>
        </g>
        <g class="h-arm-r" style="transform-origin:41px 33px"><path d="M41 33 L45 46 L43 58" stroke="url(#br-gold)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle class="h-hand" cx="43" cy="59" r="2.4" fill="#8a5c12"/></g>
      </g>
    </svg>`
  },

  // A little trash-compactor bot on treads with binocular eyes.
  scrappy: {
    name: 'Scrappy', hand: 15,
    voice: { notes: [[[300, 900], 0.22]], type: 'sine' },
    intro: ['Wooo! Scrappy! Hi-hi!', 'Ooooh! Scrappy\'s turn!'],
    lines: {
      hello: ['Wooo! Hi-hi!', 'Ooooh, shiny wheel!'],
      hit: () => ['Ta-da!', 'Ooh! I\'ll keep that one!', 'Wheee!'],
      miss: ['Awww…', 'Oh-nooo…'],
      bankrupt: ['Uh-oh…', 'Waaah! All gone!'],
      lose: ['Awww, skip.'],
      spin: ['Wheeeeee!', 'Round and rouuund!'],
      solved: ['Wheee! Yay! Yay!', 'Woo-hoo!'],
      wrong: ['Hmm… nope!']
    },
    svg: `<svg class="host-svg" viewBox="0 0 60 110">
      <defs><linearGradient id="sc-rust" x1="0" x2="1"><stop offset="0" stop-color="#b8792a"/><stop offset=".5" stop-color="#f0bf55"/><stop offset="1" stop-color="#9a5f1c"/></linearGradient></defs>
      <ellipse class="h-shadow" cx="30" cy="104" rx="22" ry="3" fill="rgba(0,0,0,.45)"/>
      <g class="h-body">
        <rect x="8" y="86" width="19" height="17" rx="7" fill="#3a3530"/><rect x="33" y="86" width="19" height="17" rx="7" fill="#3a3530"/>
        <path d="M11 94.5 h13 M36 94.5 h13" stroke="#6b625a" stroke-width="1.2" stroke-dasharray="2 2"/>
        <g class="h-arm-l" style="transform-origin:14px 62px"><path d="M14 62 L10 73" stroke="#8a8f99" stroke-width="2.5" stroke-linecap="round"/><path d="M7 73 L10 77 L13 73" stroke="#8a8f99" stroke-width="1.6" fill="none"/></g>
        <rect x="13" y="54" width="34" height="33" rx="2" fill="url(#sc-rust)" stroke="#7a4a14" stroke-width=".8"/>
        <rect x="17" y="58" width="26" height="12" fill="none" stroke="#7a4a14" stroke-width=".8"/>
        <circle cx="38" cy="78" r="2.5" fill="#ffd23f"/>
        <g class="h-head" style="transform-origin:30px 52px">
          <rect x="28.5" y="38" width="3" height="16" fill="#8a8f99"/>
          <rect x="15" y="24" width="13" height="15" rx="4" fill="#9aa1ad"/><rect x="32" y="24" width="13" height="15" rx="4" fill="#9aa1ad"/>
          <rect x="27" y="29" width="6" height="4" fill="#6d737e"/>
          <circle cx="21.5" cy="31.5" r="5" fill="#1a1d24" stroke="#6d737e" stroke-width="1"/>
          <circle cx="38.5" cy="31.5" r="5" fill="#1a1d24" stroke="#6d737e" stroke-width="1"/>
          <g class="h-eyes"><circle cx="23" cy="30" r="1.7" fill="#bfe9ff"/><circle cx="40" cy="30" r="1.7" fill="#bfe9ff"/></g>
          <path class="h-smile" style="transform-origin:30px 25px" d="M15 23 L28 25.5 M32 25.5 L45 23" stroke="#6d737e" stroke-width="1.5" stroke-linecap="round"/>
        </g>
        <g class="h-arm-r" style="transform-origin:46px 62px"><path d="M46 62 L50 73" stroke="#8a8f99" stroke-width="2.5" stroke-linecap="round"/><path d="M47 73 L50 77 L53 73" stroke="#8a8f99" stroke-width="1.6" fill="none"/><circle class="h-hand" cx="50" cy="75" r="1" fill="#ffd23f"/></g>
      </g>
    </svg>`
  },

  // A sleek floating egg-shaped probe. Cool, calm, precise.
  ova: {
    name: 'Ova', hand: 15,
    voice: { notes: [[[1400, 2100], 0.16]], type: 'sine' },
    intro: ['Probe Ova online. Hosting.', 'Ova. Directive: host this round.'],
    lines: {
      hello: ['Directive: play the game.', 'Scanning puzzle…'],
      hit: () => ['Letter confirmed.', 'Match found.'],
      miss: ['Negative.', 'No match.'],
      bankrupt: ['Funds: zero.', 'Bankruptcy detected.'],
      lose: ['Turn forfeited.'],
      spin: ['Calculating spin…', 'Tracking wheel.'],
      solved: ['Puzzle complete. Well done.', 'Directive achieved.'],
      wrong: ['Incorrect.']
    },
    svg: `<svg class="host-svg" viewBox="0 0 60 110">
      <defs>
        <radialGradient id="ov-white" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#e8eef8"/><stop offset="1" stop-color="#b9c4d8"/></radialGradient>
        <radialGradient id="ov-glow"><stop offset="0" stop-color="#4fb3ff" stop-opacity=".9"/><stop offset="1" stop-color="#4fb3ff" stop-opacity="0"/></radialGradient>
      </defs>
      <ellipse class="h-shadow" cx="30" cy="105" rx="14" ry="3.5" fill="url(#ov-glow)"/>
      <g class="h-body">
        <g class="h-arm-l" style="transform-origin:14px 51px"><ellipse cx="13" cy="62" rx="3.2" ry="11" fill="url(#ov-white)"/></g>
        <path d="M30 40 C44 40 46 64 40 84 C37 94 33 98 30 98 C27 98 23 94 20 84 C14 64 16 40 30 40 Z" fill="url(#ov-white)"/>
        <g class="h-head" style="transform-origin:30px 38px">
          <ellipse cx="30" cy="27" rx="13" ry="12" fill="url(#ov-white)"/>
          <ellipse cx="30" cy="28" rx="10" ry="6.2" fill="#070b16"/>
          <g class="h-eyes"><ellipse cx="25.5" cy="28" rx="3.2" ry="2" fill="#4fb3ff"/><ellipse cx="34.5" cy="28" rx="3.2" ry="2" fill="#4fb3ff"/></g>
        </g>
        <g class="h-arm-r" style="transform-origin:46px 51px"><ellipse class="h-hand" cx="47" cy="62" rx="3.2" ry="11" fill="url(#ov-white)"/></g>
      </g>
    </svg>`
  },

  // A squishy inflatable care bot. Gentle and kind.
  puffy: {
    name: 'Puffy', hand: 16,
    voice: { notes: [[330, 0.12], [294, 0.15]], type: 'sine' },
    intro: ['Hello. I am Puffy, your puzzle companion.', 'Hi! Puffy is here to help.'],
    lines: {
      hello: ['Hello! I\'ll be gentle with the wheel.', 'You\'ve got this!'],
      hit: () => ['Excellent work!', 'That is very good!'],
      miss: ['There, there. Try again.', 'That\'s OK. You\'re doing great.'],
      bankrupt: ['Oh no. Would you like a hug?', 'Deep breaths. It\'s only money.'],
      lose: ['It\'s OK to take a break.'],
      spin: ['Spinning gently…', 'Wheee… carefully.'],
      solved: ['You did it! Have a lollipop. 🍭', 'I am so proud of you!'],
      wrong: ['Close! Keep thinking.']
    },
    svg: `<svg class="host-svg" viewBox="0 0 60 110">
      <defs><radialGradient id="pf-white" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".75" stop-color="#eef1f6"/><stop offset="1" stop-color="#c9d0dc"/></radialGradient></defs>
      <ellipse class="h-shadow" cx="30" cy="105" rx="20" ry="3" fill="rgba(0,0,0,.4)"/>
      <g class="h-body">
        <ellipse cx="22" cy="97" rx="7" ry="7.5" fill="url(#pf-white)"/><ellipse cx="38" cy="97" rx="7" ry="7.5" fill="url(#pf-white)"/>
        <g class="h-arm-l" style="transform-origin:13px 46px"><path d="M13 46 Q5 60 10 74" stroke="#d3d9e3" stroke-width="10" stroke-linecap="round" fill="none"/><path d="M13 46 Q5 60 10 74" stroke="#fff" stroke-width="8.2" stroke-linecap="round" fill="none"/></g>
        <ellipse cx="30" cy="63" rx="21" ry="30" fill="url(#pf-white)"/>
        <circle cx="37" cy="47" r="2.3" fill="none" stroke="#c9d0dc" stroke-width=".8"/>
        <g class="h-head" style="transform-origin:30px 32px">
          <ellipse cx="30" cy="22" rx="11" ry="8.5" fill="url(#pf-white)"/>
          <g class="h-eyes"><circle cx="25" cy="22" r="1.9" fill="#111"/><circle cx="35" cy="22" r="1.9" fill="#111"/><line x1="25" y1="22" x2="35" y2="22" stroke="#111" stroke-width=".9"/></g>
        </g>
        <g class="h-arm-r" style="transform-origin:47px 46px"><path d="M47 46 Q55 60 50 74" stroke="#d3d9e3" stroke-width="10" stroke-linecap="round" fill="none"/><path class="h-hand" d="M47 46 Q55 60 50 74" stroke="#fff" stroke-width="8.2" stroke-linecap="round" fill="none"/></g>
      </g>
    </svg>`
  }
};
