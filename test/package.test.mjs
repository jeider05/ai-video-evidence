import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('playwright is a runtime dependency so npm install -g works', () => {
  assert.equal(pkg.dependencies?.playwright, '^1.65.0');
  assert.equal(pkg.devDependencies?.playwright, undefined);
});

test('bin entry points at an existing CLI file', () => {
  assert.equal(pkg.bin.narrate, 'bin/narrate.mjs');
  assert.ok(existsSync(new URL('../bin/narrate.mjs', import.meta.url)));
  assert.equal(pkg.main, undefined);
});

test('published files exclude local and private material', () => {
  for (const entry of pkg.files) {
    assert.doesNotMatch(entry, /odd|trip2|out|\.cache/);
  }
  assert.ok(pkg.files.includes('skills/'));
});

test('package, LICENSE file and skill all declare MIT', () => {
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.files.includes('LICENSE'));
  assert.match(read('LICENSE'), /^MIT License/);
  assert.match(read('skills/narrated-evidence/SKILL.md'), /^license: MIT$/m);
});
