import test from 'node:test';
import assert from 'node:assert/strict';
import { listProfiles, deriveProfiles, matchProfile } from '../spoolman_bambu_bridge/app/profiles.mjs';
import { bambuCreateBody } from '../spoolman_bambu_bridge/app/core.mjs';

// Vorm en inhoud van Bambu's openbare bibliotheek (filamentSettings), zoals de echte lijst in 2026-10 (SUNLU zonder C210/C220).
const CONFIG = { categories: ['PLA'], filamentSettings: [
  { filamentVendor: 'Bambu Lab', filamentType: 'PLA', filamentName: 'PLA Basic', filamentId: 'GFA00', isSupport: false },
  { filamentVendor: 'Bambu Lab', filamentType: 'PLA', filamentName: 'PLA Matte', filamentId: 'GFA01', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA Matte', filamentId: 'GFSNL02', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA+', filamentId: 'GFSNL03', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA+ 2.0', filamentId: 'GFSNL04', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PETG', filamentName: 'PETG', filamentId: 'GFSNL08', isSupport: false },
  { filamentVendor: 'Kapot', filamentType: 'PLA', filamentName: '', filamentId: '' },
] };
// Bestaande rollen in het Bambu-account van de gebruiker: hier staan C210 en C220 wel.
const ROLLS = [
  { id: 1, filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA C220', filamentId: 'P9877e1f' },
  { id: 2, filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA C220', filamentId: 'P9877e1f' },
  { id: 3, filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA C210', filamentId: 'Paed3d28' },
  { id: 4, filamentVendor: 'Bambu Lab', filamentType: 'PLA', filamentName: 'PLA Matte', filamentId: 'GFA01' },
  { id: 5, filamentVendor: 'X', filamentType: 'PLA', filamentName: 'Leeg', filamentId: '' },
];
const lib = listProfiles(CONFIG);
const own = deriveProfiles(ROLLS);
const all = [...own, ...lib];

test('profielen: lege of onvolledige regels vallen af, dubbele rollen worden samengevoegd', () => {
  assert.equal(lib.length, 6);
  assert.deepEqual(listProfiles(null), []);
  assert.deepEqual(own.map((p) => p.id), ['P9877e1f', 'Paed3d28', 'GFA01']);
  assert.deepEqual(deriveProfiles(undefined), []);
});

test('profiel zoeken: eigen profielen (C210/C220) worden gevonden, merk niet hoofdlettergevoelig', () => {
  assert.equal(matchProfile(all, { brand: 'Sunlu', material: 'PLA', name: 'PLA C220 Zwart' }).id, 'P9877e1f');
  assert.equal(matchProfile(all, { brand: 'SUNLU', material: 'pla', name: 'PLA C210 Donkergroen' }).id, 'Paed3d28');
  assert.equal(matchProfile(all, { brand: 'Bambu Lab', material: 'PLA', name: 'PLA Matte Blauw' }).id, 'GFA01');
});

test('profiel zoeken: bibliotheek vult aan; PETG en PLA+ worden gevonden', () => {
  assert.equal(matchProfile(all, { brand: 'Sunlu', material: 'PETG', name: 'PETG Zwart' }).id, 'GFSNL08');
  // "PLA+ 2.0" is langer dan "PLA+": het langste profiel wint.
  assert.equal(matchProfile(all, { brand: 'Sunlu', material: 'PLA', name: 'PLA+ 2.0 Rood' }).id, 'GFSNL04');
  assert.equal(matchProfile(all, { brand: 'Sunlu', material: 'PLA', name: 'PLA+ Rood' }).id, 'GFSNL03');
});

test('profiel zoeken: geen gok bij onduidelijke of onbekende rollen', () => {
  assert.equal(matchProfile(all, { brand: 'Sunlu', material: 'PLA', name: 'Zwart' }), null); // geen productnaam
  assert.equal(matchProfile(all, { brand: 'Sunlu', material: 'PLA', name: 'Mysterie Rood' }), null); // onbekend product, geen terugval op "enige profiel"
  assert.equal(matchProfile(own, { brand: 'Sunlu', material: 'PLA', name: 'Mysterie Rood' }), null);
  assert.equal(matchProfile(all, { brand: 'Onbekend', material: 'PLA', name: 'PLA C220' }), null);
  assert.equal(matchProfile(all, { brand: '', material: 'PLA', name: 'PLA C220' }), null);
  assert.equal(matchProfile([], { brand: 'Sunlu', material: 'PLA', name: 'PLA C220' }), null);
});

test('aanmaakbody: met profiel komen merk, type, naam en filamentId uit het profiel; zonder blijft filamentId leeg', () => {
  const spool = { brand: 'Sunlu', material: 'PLA', name: 'PLA C220 Zwart', colorHex: '161616', initialWeight: 1000, remainingWeight: 1000 };
  const withP = bambuCreateBody(spool, '[spoolman:1]', matchProfile(all, spool));
  assert.deepEqual([withP.filamentVendor, withP.filamentType, withP.filamentName, withP.filamentId], ['SUNLU', 'PLA', 'PLA C220', 'P9877e1f']);
  assert.equal(withP.color, '#161616FF'); assert.equal(withP.note, '[spoolman:1]');
  const without = bambuCreateBody(spool, '[spoolman:1]');
  assert.equal(without.filamentId, ''); assert.equal(without.filamentName, 'PLA C220 Zwart');
});
