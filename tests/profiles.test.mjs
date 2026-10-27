import test from 'node:test';
import assert from 'node:assert/strict';
import { listProfiles, matchProfile } from '../spoolman_bambu_bridge/app/profiles.mjs';
import { bambuCreateBody } from '../spoolman_bambu_bridge/app/core.mjs';

// Vorm van Bambu's bibliotheek (filamentSettings), met de profielen uit Handy en de ID's van de bestaande rollen.
const CONFIG = { categories: ['PLA'], filamentSettings: [
  { filamentVendor: 'Bambu Lab', filamentType: 'PLA', filamentName: 'PLA Basic', filamentId: 'GFA00', isSupport: false },
  { filamentVendor: 'Bambu Lab', filamentType: 'PLA', filamentName: 'PLA Matte', filamentId: 'GFA01', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA C210', filamentId: 'Paed3d28', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA C220', filamentId: 'P9877e1f', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PLA', filamentName: 'PLA Meta', filamentId: 'Pmeta0001', isSupport: false },
  { filamentVendor: 'SUNLU', filamentType: 'PETG', filamentName: 'PETG Basic', filamentId: 'GFSNL08', isSupport: false },
  { filamentVendor: 'Kapot', filamentType: 'PLA', filamentName: '', filamentId: '' },
] };
const profiles = listProfiles(CONFIG);

test('profielen: lege of onvolledige regels vallen af', () => {
  assert.equal(profiles.length, 6);
  assert.deepEqual(listProfiles(null), []);
});

test('profiel zoeken: merk niet hoofdlettergevoelig, naam bevat productnaam + kleur', () => {
  assert.equal(matchProfile(profiles, { brand: 'Sunlu', material: 'PLA', name: 'PLA C220 Zwart' }).id, 'P9877e1f');
  assert.equal(matchProfile(profiles, { brand: 'SUNLU', material: 'pla', name: 'PLA C210 Donkergroen' }).id, 'Paed3d28');
  assert.equal(matchProfile(profiles, { brand: 'Bambu Lab', material: 'PLA', name: 'PLA Matte Blauw' }).id, 'GFA01');
});

test('profiel zoeken: eenduidige terugval, onduidelijk blijft leeg', () => {
  // Sunlu PETG heeft precies één profiel: ook "PETG Zwart" krijgt dat.
  assert.equal(matchProfile(profiles, { brand: 'Sunlu', material: 'PETG', name: 'PETG Zwart' }).id, 'GFSNL08');
  // Sunlu PLA heeft drie profielen en de naam noemt er geen: geen gok.
  assert.equal(matchProfile(profiles, { brand: 'Sunlu', material: 'PLA', name: 'Zwart' }), null);
  assert.equal(matchProfile(profiles, { brand: 'Onbekend', material: 'PLA', name: 'PLA C220' }), null);
  assert.equal(matchProfile(profiles, { brand: '', material: 'PLA', name: 'PLA C220' }), null);
  assert.equal(matchProfile([], { brand: 'Sunlu', material: 'PLA', name: 'PLA C220' }), null);
});

test('aanmaakbody: met profiel komen merk, type, naam en filamentId uit de bibliotheek; zonder blijft filamentId leeg', () => {
  const spool = { brand: 'Sunlu', material: 'PLA', name: 'PLA C220 Zwart', colorHex: '161616', initialWeight: 1000, remainingWeight: 1000 };
  const p = matchProfile(profiles, spool);
  const withP = bambuCreateBody(spool, '[spoolman:1]', p);
  assert.deepEqual([withP.filamentVendor, withP.filamentType, withP.filamentName, withP.filamentId], ['SUNLU', 'PLA', 'PLA C220', 'P9877e1f']);
  assert.equal(withP.color, '#161616FF'); assert.equal(withP.note, '[spoolman:1]');
  const without = bambuCreateBody(spool, '[spoolman:1]');
  assert.equal(without.filamentId, ''); assert.equal(without.filamentName, 'PLA C220 Zwart');
});
