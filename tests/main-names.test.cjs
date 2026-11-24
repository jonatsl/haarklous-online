// game-main.js is one long function. Two functions of the same name in it do not fail: the later one silently replaces the
// earlier one everywhere. That is how the skydiving door (issue #165) took over `toggleDoor`, and no door in a building opened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('game-main.js declares no function twice', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'game-main.js'), 'utf8'), seen = new Map(), twice = [];
  src.split('\n').forEach((line, i) => {
    const m = line.match(/^ {2}(?:async )?function\*? ([A-Za-z0-9_$]+)\s*\(/);if (!m) return;
    if (seen.has(m[1])) twice.push(`${m[1]} (lines ${seen.get(m[1])} and ${i + 1})`);else seen.set(m[1], i + 1);
  });
  assert.ok(seen.size > 200, 'the main functions were found');
  assert.deepEqual(twice, []);
  // The buildings' doors and the jump planes' door are two different things.
  assert.ok(seen.has('toggleDoor') && seen.has('toggleJumpDoor'));
});
