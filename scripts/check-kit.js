#!/usr/bin/env node
'use strict';

// Checks that the shared kit's files in this app are untouched copies.
//
// Some files are the same in every ARKS app: the server ones in kit/ and a few
// browser ones in public/. kit/kit.json lists each with its fingerprint (a
// SHA-256 hash, which changes if even one letter of the file does). This
// recomputes them and fails if one was edited here or is missing, because a
// fix made in one app's copy never reaches the others. Change the original in
// the shared kit and copy it over with the kit's sync script instead.
//
// `npm test` runs this first. It needs nothing but Node and this repo.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const LIST = path.join(ROOT, 'kit', 'kit.json');

let kit;
try {
  kit = JSON.parse(fs.readFileSync(LIST, 'utf8'));
} catch (err) {
  console.error(`The shared kit check couldn't read kit/kit.json (${err.message}). Copy the kit over with its sync script.`);
  process.exit(1);
}

const problems = [];
for (const [file, expected] of Object.entries(kit.files || {})) {
  let body;
  try {
    // Line endings never count: a Windows checkout can turn LF into CRLF.
    body = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    problems.push(`${file} is missing. It's part of the shared kit, so copy it back with the kit's sync script.`);
    continue;
  }
  const actual = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  if (actual !== expected) {
    problems.push(`${file} was changed here. Change it in arks-internal/kit and run the sync instead.`);
  }
}

if (problems.length) {
  console.error('The shared kit check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Shared kit: all ${Object.keys(kit.files || {}).length} files match kit/kit.json (kit ${kit.kit}).`);
