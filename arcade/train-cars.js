'use strict';

// The eight cars on ARKS Train Station's train: each has a name (on its side and on the light board) and how hard it
// is to land in (easy cars are long and worth 5, medium 15, hard ones short and worth 40). The admin page's Arcade tab
// names them. Until then the train uses the made-up names below, so the repo never carries anyone's real names.
// Each car can also have a picture (2026-11-13), shown in the circle on the station's light board instead of the name's
// first letter. The admin page shrinks it to a small square JPEG before sending it, and it's kept in the settings
// table (never in the repo).

const crypto = require('crypto');
const db = require('../db');

const PICS = 'train_car_pictures';
const MAX_PICTURE = 120 * 1024;   // bytes of JPEG; a 256-pixel square is about 30 KB

const KEY = 'train_cars';
const KINDS = ['easy', 'med', 'hard'];
const DEFAULTS = [
  { name: 'Comet', kind: 'easy' }, { name: 'Blaze', kind: 'hard' }, { name: 'Pixel', kind: 'easy' }, { name: 'Rocket', kind: 'med' },
  { name: 'Nova', kind: 'easy' }, { name: 'Turbo', kind: 'hard' }, { name: 'Jinx', kind: 'easy' }, { name: 'Zap', kind: 'med' }
];
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,11}$/u;

const pictures = () => { const p = db.getSetting(PICS, null); return Array.isArray(p) && p.length === 8 ? p : Array(8).fill(null); };
// Where a car's picture is served, with a version that changes with the picture (so browsers can keep it).
const pictureUrl = (i, p) => (p && p.v ? `/api/train-cars/${i + 1}/picture?v=${p.v}` : null);

function get() {
  const saved = db.getSetting(KEY, null);
  const pics = pictures();
  const cars = !Array.isArray(saved) || saved.length !== 8 ? DEFAULTS.map(c => ({ ...c })) : saved.map((c, i) => ({
    name: typeof c.name === 'string' && NAME_RE.test(c.name) ? c.name : DEFAULTS[i].name,
    kind: KINDS.includes(c.kind) ? c.kind : DEFAULTS[i].kind
  }));
  return cars.map((c, i) => ({ ...c, picture: pictureUrl(i, pics[i]) }));
}

const carIndex = n => {
  const i = Number(n) - 1;
  if (!Number.isInteger(i) || i < 0 || i > 7) throw Object.assign(new Error('There are 8 cars, numbered 1 to 8.'), { status: 404 });
  return i;
};
// image: a data: URL of a JPEG, as the admin page makes it. Anything else is refused.
function setPicture(n, image) {
  const i = carIndex(n);
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
  const bytes = m ? Buffer.from(m[1], 'base64') : null;
  if (!bytes || bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw Object.assign(new Error('That picture didn\'t come through. Pick a photo or a picture file and try again.'), { status: 400 });
  }
  if (bytes.length > MAX_PICTURE) throw Object.assign(new Error('That picture is too big. Try a smaller one.'), { status: 413 });
  const pics = pictures();
  pics[i] = { v: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10), data: bytes.toString('base64') };
  db.setSetting(PICS, pics);
  return get();
}
function clearPicture(n) {
  const i = carIndex(n);
  const pics = pictures();
  pics[i] = null;
  db.setSetting(PICS, pics);
  return get();
}
// The JPEG for a car, or null.
function picture(n) {
  const p = pictures()[carIndex(n)];
  return p && p.data ? Buffer.from(p.data, 'base64') : null;
}

function set(cars) {
  if (!Array.isArray(cars) || cars.length !== 8) throw Object.assign(new Error('The train has exactly 8 cars.'), { status: 400 });
  const clean = cars.map((c, i) => {
    const name = String((c && c.name) || '').trim();
    if (!NAME_RE.test(name)) throw Object.assign(new Error(`Car ${i + 1}'s name should be 1 to 12 letters, numbers or spaces.`), { status: 400 });
    if (!KINDS.includes(c.kind)) throw Object.assign(new Error(`Car ${i + 1} should be easy, medium or hard.`), { status: 400 });
    return { name, kind: c.kind };
  });
  db.setSetting(KEY, clean);
  return get();
}

module.exports = { get, set, setPicture, clearPicture, picture, DEFAULTS, KINDS };
