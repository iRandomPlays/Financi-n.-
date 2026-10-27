import test from 'node:test';
import assert from 'node:assert/strict';
import { makeQr } from '../rolscanner/qr.mjs';
import { PAGE } from '../rolscanner/page.mjs';

// Uitleesbaarheid is bij de bouw gecontroleerd met OpenCV (13 codes, versie 1 t/m 10, ook met speciale tekens).
// Deze tests bewaken de structuur zodat een latere wijziging niet ongemerkt iets breekt.
const finder = (m, r0, c0) => {
  for (let d = 0; d < 7; d++) for (const [r, c] of [[r0, c0 + d], [r0 + 6, c0 + d], [r0 + d, c0], [r0 + d, c0 + 6]]) assert.equal(m[r][c], true);
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) assert.equal(m[r0 + r][c0 + c], r >= 2 && r <= 4 && c >= 2 && c <= 4);
};

test('qr: afmetingen per versie en vaste patronen', () => {
  const sizes = [['A', 21], ['x'.repeat(14), 21], ['x'.repeat(15), 25], ['http://homeassistant.local:3005/scan/spool/12', 33], ['x'.repeat(122), 45], ['x'.repeat(213), 57]];
  for (const [t, n] of sizes) {
    const m = makeQr(t); assert.equal(m.length, n); assert.ok(m.every((r) => r.length === n));
    finder(m, 0, 0); finder(m, 0, n - 7); finder(m, n - 7, 0);
    for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); } // timing
    assert.equal(m[n - 8][8], true); // vaste donkere module
  }
});

test('qr: deterministisch, te lange tekst geeft een duidelijke fout, unicode werkt', () => {
  assert.deepEqual(makeQr('abc'), makeQr('abc'));
  assert.notDeepEqual(makeQr('abc'), makeQr('abd'));
  assert.throws(() => makeQr('x'.repeat(214)), /te lang/);
  assert.doesNotThrow(() => makeQr('Kleur: zwart/goud – ✓'));
});

test('pagina: de QR-generator zit in het script en de plaatshouder is vervangen', () => {
  assert.ok(!PAGE.includes('/*QR*/'));
  assert.ok(PAGE.includes('function makeQr(text)'));
  assert.ok(PAGE.includes('/scan/spool/'));
});
