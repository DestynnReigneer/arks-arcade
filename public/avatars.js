'use strict';

// Profile avatars for the whole arcade. Every drawing here is original: a
// Shiba Inu in different poses and outfits, blocky pixel faces, yellow
// cartoon heads, plus emoji sets. An avatar is stored as an id like
// "shiba:3" or "emoji:🎸"; Avatars.html(id) turns it into markup.
// Works in the browser and (for validating ids) on the server.
//
// The optional sign-in service (ARKS ID) and the other apps that use it keep
// exact copies of this file, so a character picked in one app looks the same
// in all of them. Change it here first, then copy it over unchanged.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Avatars = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const svg = (inner, bg) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="${bg}"/>${inner}</svg>`;

  // ---- Shiba Inus -----------------------------------------------------------------
  const SHIBA_BG = ['#ffd9a8', '#c9e8ff', '#ffd1e8', '#d8f5c8', '#e6dcff', '#fff0b3', '#ffc9c9', '#cdeff0', '#f2e0c8', '#ffe2b8', '#e0e0ff', '#d4f0d0'];
  function shibaFace({ eyes = 'open', mouth = 'smile' } = {}) {
    const eye = eyes === 'closed'
      ? '<path d="M22 33 q3 3 6 0 M36 33 q3 3 6 0" stroke="#2b1a10" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
      : '<circle cx="25" cy="32" r="2.8" fill="#2b1a10"/><circle cx="39" cy="32" r="2.8" fill="#2b1a10"/><circle cx="26" cy="31" r="0.9" fill="#fff"/><circle cx="40" cy="31" r="0.9" fill="#fff"/>';
    const m = mouth === 'tongue'
      ? '<path d="M28 41 q4 4 8 0" stroke="#2b1a10" stroke-width="1.8" fill="none"/><path d="M30.5 42.5 q1.5 5 3 0 z" fill="#ff7a8a"/>'
      : '<path d="M28 41 q4 3.5 8 0" stroke="#2b1a10" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
    return '<path d="M13 22 L18 8 L27 18 Z M51 22 L46 8 L37 18 Z" fill="#e8963e"/>' +
      '<path d="M16 19 L19 12 L24 18 Z M48 19 L45 12 L40 18 Z" fill="#fff3e3"/>' +
      '<ellipse cx="32" cy="34" rx="20" ry="18" fill="#e8963e"/>' +
      '<path d="M16 36 Q20 50 32 51 Q44 50 48 36 Q42 44 32 40 Q22 44 16 36 Z" fill="#fff6ea"/>' +
      '<ellipse cx="22" cy="27" rx="3" ry="1.6" fill="#fff6ea"/><ellipse cx="42" cy="27" rx="3" ry="1.6" fill="#fff6ea"/>' +
      eye + '<ellipse cx="32" cy="37.5" rx="3" ry="2.2" fill="#2b1a10"/>' + m +
      '<circle cx="19" cy="38" r="2.6" fill="#ffb3b3" opacity=".55"/><circle cx="45" cy="38" r="2.6" fill="#ffb3b3" opacity=".55"/>';
  }
  const SHIBA = [
    ['Good boy', shibaFace()],
    ['Party pup', shibaFace({ mouth: 'tongue' }) + '<path d="M26 14 L32 -2 L38 14 Z" fill="#ff4fa3"/><circle cx="32" cy="-1" r="2.5" fill="#ffd23f"/><path d="M28 10 l8 0 M27 13 l10 0" stroke="#fff" stroke-width="1.4"/>'],
    ['Too cool', shibaFace() + '<path d="M17 29 h12 v5 a4 4 0 0 1 -4 4 h-4 a4 4 0 0 1 -4 -4 z M35 29 h12 v5 a4 4 0 0 1 -4 4 h-4 a4 4 0 0 1 -4 -4 z M29 31 h6" fill="#111" stroke="#111" stroke-width="1.5"/>'],
    ['Royal', shibaFace() + '<path d="M20 15 L24 6 L28 12 L32 4 L36 12 L40 6 L44 15 Z" fill="#ffd23f" stroke="#c99a00" stroke-width="1"/><circle cx="32" cy="9" r="1.5" fill="#ff4f6a"/>'],
    ['DJ', shibaFace({ eyes: 'closed' }) + '<path d="M12 34 Q12 12 32 12 Q52 12 52 34" stroke="#333" stroke-width="3.5" fill="none"/><rect x="8" y="30" width="8" height="12" rx="3" fill="#2e86de"/><rect x="48" y="30" width="8" height="12" rx="3" fill="#2e86de"/>'],
    ['Chef', shibaFace({ mouth: 'tongue' }) + '<path d="M20 18 h24 v-4 a6 6 0 0 0 -4 -10 a7 7 0 0 0 -12 -1 a6 6 0 0 0 -8 7 z" fill="#fff" stroke="#ddd" stroke-width="1"/>'],
    ['Wizard', shibaFace() + '<path d="M18 17 L32 -4 L46 17 Z" fill="#6c4ad6"/><path d="M16 17 h32" stroke="#4a2fa8" stroke-width="3"/><path d="M30 6 l1 2 2 .3 -1.5 1.4 .4 2 -1.9 -1 -1.9 1 .4 -2 -1.5 -1.4 2 -.3 z" fill="#ffd23f"/>'],
    ['Bandit', shibaFace() + '<path d="M14 27 Q32 22 50 27 L50 31 Q32 27 14 31 Z" fill="#e5383b"/><circle cx="25" cy="32" r="2.8" fill="#2b1a10"/><circle cx="39" cy="32" r="2.8" fill="#2b1a10"/>'],
    ['Sleepy', shibaFace({ eyes: 'closed' }) + '<text x="44" y="16" font-size="9" font-family="sans-serif" font-weight="bold" fill="#5b6283">z</text><text x="50" y="10" font-size="7" font-family="sans-serif" font-weight="bold" fill="#5b6283">z</text>'],
    ['Happy', shibaFace({ eyes: 'closed', mouth: 'tongue' })],
    ['Bow', shibaFace() + '<path d="M38 10 l-6 4 6 4 z M50 10 l6 4 -6 4 z" fill="#ff7ac0" transform="translate(-6 0)"/><circle cx="44" cy="14" r="2.5" fill="#ff4fa3"/>'],
    ['Ballcap', shibaFace() + '<path d="M16 20 Q16 8 32 8 Q48 8 48 20 Z" fill="#2fbf71"/><path d="M40 19 h16 q0 3 -3 3 h-13 z" fill="#1f8c52"/>']
  ];

  // ---- blocky pixel faces --------------------------------------------------------------
  const BLOCK = [
    ['Classic', '#c69c6d', '#4a2f1b', '#3b82f6'], ['Ginger', '#f1c27d', '#c0392b', '#2fbf71'],
    ['Midnight', '#8d5524', '#111111', '#a46bff'], ['Frosty', '#ffe0bd', '#e8e8e8', '#2de2e6'],
    ['Zombie', '#5fae5a', '#2e5d2b', '#111111'], ['Robo', '#9aa4b5', '#5b6283', '#ff3860'],
    ['Pinky', '#ffcfd8', '#ff4fa3', '#6c4ad6'], ['Sunny', '#ffdd73', '#f08a24', '#2e86de']
  ];
  function blockFace([, skin, hair, eye]) {
    const px = (x, y, c) => `<rect x="${8 + x * 6}" y="${8 + y * 6}" width="6.2" height="6.2" fill="${c}"/>`;
    let out = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let c = skin;
      if (y < 2 || (y === 2 && (x === 0 || x === 7))) c = hair;
      if (y === 4 && (x === 2 || x === 5)) c = '#fff';
      if (y === 4 && (x === 1 || x === 6)) c = eye;
      if (y === 6 && x >= 2 && x <= 5) c = '#5a3a28';
      out += px(x, y, c);
    }
    return out;
  }

  // ---- yellow cartoon heads ------------------------------------------------------------------
  const TOON_HAIR = [
    ['Spiky', '<path d="M16 24 L19 10 L24 20 L28 7 L32 19 L36 7 L40 20 L45 10 L48 24 Z" fill="#f2c94c"/>'],
    ['Big blue', '<path d="M19 26 Q14 2 32 1 Q50 2 45 26 Q40 16 32 17 Q24 16 19 26 Z" fill="#3b6fd8"/>'],
    ['Two hairs', '<path d="M29 14 q-2 -6 1 -9 M33 14 q2 -6 -1 -9" stroke="#2b1a10" stroke-width="1.6" fill="none"/>'],
    ['Curly', '<g fill="#7a4a2a"><circle cx="20" cy="18" r="5"/><circle cx="27" cy="13" r="5"/><circle cx="35" cy="12" r="5"/><circle cx="43" cy="16" r="5"/><circle cx="47" cy="23" r="4"/><circle cx="17" cy="24" r="4"/></g>'],
    ['Pigtails', '<path d="M18 22 Q18 10 32 10 Q46 10 46 22 Q40 16 32 16 Q24 16 18 22 Z" fill="#e2733d"/><circle cx="13" cy="24" r="5" fill="#e2733d"/><circle cx="51" cy="24" r="5" fill="#e2733d"/>'],
    ['Mohawk', '<path d="M28 18 L30 3 L34 3 L36 18 Z" fill="#ff3860"/>'],
    ['Bob', '<path d="M16 34 Q14 10 32 10 Q50 10 48 34 L44 34 Q44 18 32 18 Q20 18 20 34 Z" fill="#2b1a10"/>'],
    ['Ponytail', '<path d="M18 22 Q18 10 32 10 Q46 10 46 22 Q40 15 32 15 Q24 15 18 22 Z" fill="#c99a00"/><path d="M46 18 q10 4 6 18 q-4 -10 -8 -12 z" fill="#c99a00"/>']
  ];
  function toonFace(hair) {
    return '<ellipse cx="32" cy="36" rx="15" ry="17" fill="#ffd90f"/>' +
      '<circle cx="26" cy="32" r="5.5" fill="#fff" stroke="#2b1a10" stroke-width="1"/><circle cx="38" cy="32" r="5.5" fill="#fff" stroke="#2b1a10" stroke-width="1"/>' +
      '<circle cx="27" cy="32" r="1.6" fill="#2b1a10"/><circle cx="37" cy="32" r="1.6" fill="#2b1a10"/>' +
      '<path d="M26 44 q6 5 12 0" stroke="#2b1a10" stroke-width="1.8" fill="none" stroke-linecap="round"/>' + hair;
  }

  const EMOJI = {
    Movies: ['🎬', '🍿', '🦸', '🧙', '🧛', '🤠', '🥷', '👽'],
    Music: ['🎸', '🎤', '🥁', '🎧', '🎹', '🎷', '🪩', '🎺'],
    'Space & robots': ['🚀', '🤖', '🛸', '🌙', '⭐', '🪐', '👾', '🦖'],
    Animals: ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐧', '🐯']
  };

  // ---- ARKS ID icons -------------------------------------------------------------------
  // The 16 line icons people pick on ARKS ID, in their ARKS color, so an
  // account that uses an icon looks the same here: "arks:rocket:s1".
  const ARKS_ICONS = {
    rocket: '<path d="M12 2.5c3 2.2 4.5 5.4 4.5 9.2V16h-9v-4.3c0-3.8 1.5-7 4.5-9.2Z"/><circle cx="12" cy="10" r="1.8"/><path d="M7.5 12.5 5 15v4l2.5-1.5M16.5 12.5 19 15v4l-2.5-1.5M10 19c.5 1.2 1.2 2 2 2.5.8-.5 1.5-1.3 2-2.5"/>',
    controller: '<rect x="2.5" y="7" width="19" height="11" rx="4"/><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
    cat: '<path d="M5 9.5V4l4 3h6l4-3v5.5c0 5-3.1 9.5-7 9.5s-7-4.5-7-9.5Z"/><path d="M9.5 11.5h.01M14.5 11.5h.01M10.5 14.5 12 15.5l1.5-1M2.5 13h4M2.5 16l4-1.2M21.5 13h-4M21.5 16l-4-1.2"/>',
    dog: '<path d="M8 5.5C6 4.5 3.5 5 3 7.5c-.4 2 .5 4.5 2.5 5M16 5.5c2-1 4.5-.5 5 2 .4 2-.5 4.5-2.5 5"/><path d="M7 7.5c1.3-1.3 3-2 5-2s3.7.7 5 2c.8 1.5 1.2 3.4 1.2 5.5 0 4-2.8 7-6.2 7s-6.2-3-6.2-7c0-2.1.4-4 1.2-5.5Z"/><path d="M10 11h.01M14 11h.01M10.8 14.2h2.4L12 15.5ZM12 15.5v1.5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8L12 3Z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    crown: '<path d="M3.5 8 7.5 12 12 5.5l4.5 6.5 4-4L19 18H5L3.5 8Z"/><path d="M5 21h14"/>',
    ghost: '<path d="M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.3-1.7-2.4 1.7-2.3-1.7-2.3 1.7-2.4-1.7L5 20.5Z"/><path d="M9.5 11h.01M14.5 11h.01"/>',
    robot: '<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><path d="M12 8V4.5M12 3.5h.01M9.5 16.5h5M2.5 12v3M21.5 12v3"/><circle cx="9" cy="12.5" r="1.3"/><circle cx="15" cy="12.5" r="1.3"/>',
    music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    planet: '<circle cx="12" cy="12" r="6"/><path d="M6.6 14.8c-2.7 1.7-4.2 3.2-3.8 3.9.7 1.2 5.8-.6 11.3-4.1s9.4-7.1 8.7-8.3c-.4-.7-2.4-.4-5 .8"/>',
    flower: '<circle cx="12" cy="8.5" r="1.6"/><circle cx="12" cy="4.6" r="2.1"/><circle cx="15.7" cy="7.3" r="2.1"/><circle cx="14.3" cy="11.7" r="2.1"/><circle cx="9.7" cy="11.7" r="2.1"/><circle cx="8.3" cy="7.3" r="2.1"/><path d="M12 14v7M12 18.5c-1.5-1.8-3.5-2.3-5-2M12 20c1.3-1.4 3-1.8 4.5-1.5"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6C8 8 9 10 9 12s-1 4-3.4 6.4M18.4 5.6C16 8 15 10 15 12s1 4 3.4 6.4"/>',
    paw: '<path d="M12 12.5c-2.6 0-5 2.6-5 5 0 1.8 1.5 2.5 3 2.5h4c1.5 0 3-.7 3-2.5 0-2.4-2.4-5-5-5Z"/><circle cx="5.5" cy="10.5" r="1.9"/><circle cx="9.5" cy="6" r="1.9"/><circle cx="14.5" cy="6" r="1.9"/><circle cx="18.5" cy="10.5" r="1.9"/>'
  };
  // The color, and a dark circle tinted with it (like ARKS ID's own avatars).
  const ARKS_COLORS = {
    pink: ['#ff2ec4', '#3a1838'], teal: ['#00ffc2', '#10302f'], s1: ['#5b93dc', '#1f2639'],
    s2: ['#d96490', '#33202e'], s3: ['#ba852f', '#2f2522'], s4: ['#2ea9a2', '#132c31']
  };
  function arksIcon(icon, color) {
    const [line, bg] = ARKS_COLORS[color];
    return svg(`<g transform="translate(14 14) scale(1.5)" fill="none" stroke="${line}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ARKS_ICONS[icon]}</g>`, bg);
  }

  const SETS = [
    { id: 'shiba', label: 'Shibas', items: SHIBA.map(([name], i) => ({ id: `shiba:${i}`, name })) },
    { id: 'block', label: 'Blocky', items: BLOCK.map(([name], i) => ({ id: `block:${i}`, name })) },
    { id: 'toon', label: 'Toons', items: TOON_HAIR.map(([name], i) => ({ id: `toon:${i}`, name })) },
    ...Object.entries(EMOJI).map(([label, list]) => ({ id: label, label, items: list.map(e => ({ id: `emoji:${e}`, name: e })) }))
  ];
  const ALL = new Set(SETS.flatMap(s => s.items.map(i => i.id)));
  const DEFAULT = 'shiba:0';

  // An "arks:" id is set from someone's ARKS ID account, not picked here.
  const arksParts = id => {
    const m = /^arks:([a-z]+):([a-z0-9]+)$/.exec(String(id));
    return m && ARKS_ICONS[m[1]] && ARKS_COLORS[m[2]] ? [m[1], m[2]] : null;
  };
  const valid = id => ALL.has(String(id)) || !!arksParts(id);

  // The avatar to show for an ARKS ID account ({ icon, color, art } from its
  // user): the character they picked, or else their icon in their color.
  function fromAccount(a) {
    if (!a || typeof a !== 'object') return DEFAULT;
    if (typeof a.art === 'string' && ALL.has(a.art)) return a.art;
    if (ARKS_ICONS[a.icon] && ARKS_COLORS[a.color]) return `arks:${a.icon}:${a.color}`;
    return DEFAULT;
  }

  // Markup for an avatar: an inline SVG, or the emoji in a colored circle.
  function html(id) {
    const s = String(id || DEFAULT);
    const [set, key] = [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)];
    const n = Number(key);
    if (set === 'shiba' && SHIBA[n]) return svg(SHIBA[n][1], SHIBA_BG[n % SHIBA_BG.length]);
    if (set === 'block' && BLOCK[n]) return svg(blockFace(BLOCK[n]), '#1e1a30');
    if (set === 'toon' && TOON_HAIR[n]) return svg(toonFace(TOON_HAIR[n][1]), ['#9ad7ff', '#ffb3d6', '#c8f0b0', '#ffe08a'][n % 4]);
    const arks = arksParts(s);
    if (arks) return arksIcon(arks[0], arks[1]);
    if (set === 'emoji' && ALL.has(s)) return svg(`<text x="32" y="43" font-size="30" text-anchor="middle">${key}</text>`, '#2a2740');
    // Anything older (Rambler's plain-emoji avatars) still shows.
    return svg(`<text x="32" y="43" font-size="30" text-anchor="middle">${s.replace(/[<>&"]/g, '')}</text>`, '#2a2740');
  }

  // Puts an avatar into an element, sized by CSS on that element.
  function put(el, id) {
    el.innerHTML = html(id);
    const svgEl = el.firstElementChild;
    if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = '100%'; svgEl.style.display = 'block'; }
    return el;
  }

  return { SETS, DEFAULT, valid, html, put, fromAccount };
});
