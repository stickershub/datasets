import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBase,
  parseCategoryDir,
  slugify,
  titleCase,
} from './import-pepe.mjs';

test('slugify normalizes sticker names', () => {
  assert.equal(slugify('Pepe Big Punch'), 'pepe-big-punch');
  assert.equal(slugify('Peepo Coffee'), 'peepo-coffee');
  assert.equal(slugify("Pepe Let's Go"), 'pepe-lets-go');
  assert.equal(slugify('8 bit'), '8-bit');
  assert.equal(slugify('  spaced   name  '), 'spaced-name');
});

test('titleCase keeps the fandom acronyms intact', () => {
  assert.equal(titleCase('pepe lets fucking go lfg'), "Pepe Let's Fucking Go LFG");
  assert.equal(titleCase('pepe easy ez'), 'Pepe Easy EZ');
  assert.equal(titleCase('peepo kekw'), 'Peepo KEKW');
  assert.equal(titleCase('apu pog champ'), 'Apu POG Champ');
  assert.equal(titleCase('pepe 8 bit'), 'Pepe 8 Bit');
});

test('parseCategoryDir reads the upstream numbered folders', () => {
  assert.deepEqual(parseCategoryDir('1 pepe'), { order: 1, id: 'pepe', name: 'Pepe' });
  assert.deepEqual(parseCategoryDir('5 pepege'), { order: 5, id: 'pepege', name: 'Pepege' });
  assert.equal(parseCategoryDir('source images'), null);
  assert.equal(parseCategoryDir('not a category'), null);
});

test('normalizeBase strips only the leading character prefix and extension', () => {
  assert.equal(normalizeBase('pepe big punch.png'), 'big punch');
  assert.equal(normalizeBase('pepe cross.gif'), 'cross');
  assert.equal(normalizeBase('peepo Coffee.png'), 'coffee');
  assert.equal(normalizeBase('pepega.png'), 'pepega');
  assert.equal(normalizeBase('pepega hi.gif'), 'hi');
  assert.equal(normalizeBase('pepege cheer.gif'), 'cheer');
});
