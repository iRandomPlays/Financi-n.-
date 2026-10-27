import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Store, Bridge } from '../spoolman_bambu_bridge/app/core.mjs';
import { HaPublisher } from '../spoolman_bambu_bridge/app/publish.mjs';
import { normalizeTag, trayFromState, rfidTrays } from '../spoolman_bambu_bridge/app/rfid.mjs';

const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const url = (s) => `http://127.0.0.1:${s.address().port}`;

const UUID = 'A4EBFC83127947D1B328A746B2641149';
// Echte vorm van een AMS-vak uit Home Assistant (Bambu PLA Matte, vak 2).
const tray = (over = {}, id = 'sensor.x2d_20p9bj620700578_ams_1_tray_2') => ({
  entity_id: id, state: 'Bambu PLA Matte',
  attributes: { empty: false, color: '#0078BFFF', tray_weight: '1000', name: 'Bambu PLA Matte', remain: 63, tag_uid: '5C225F6800000100', tray_uuid: UUID, type: 'PLA', ...over },
});
const sunlu = () => tray({ name: 'SUNLU PLA C220', tray_uuid: '00000000000000000000000000000000', tag_uid: '0000000000000000' }, 'sensor.x2d_20p9bj620700578_ams_1_tray_4');

async function fakeSpoolman({ rejectExtra = false } = {}) {
  const db = { vendors: [{ id: 1, name: 'Bambu Lab' }], filaments: [], spools: [], fields: [], posts: [] };
  const srv = await listen(async (req, res) => {
    const p = req.url.split('?')[0];
    if (req.method === 'GET' && p === '/api/v1/vendor') return json(res, 200, db.vendors);
    if (req.method === 'GET' && p === '/api/v1/filament') return json(res, 200, db.filaments);
    if (req.method === 'GET' && p === '/api/v1/spool') return json(res, 200, db.spools);
    if (req.method === 'GET' && p === '/api/v1/field/spool') return json(res, 200, db.fields);
    const b = await readBody(req); db.posts.push([p, b]);
    if (p.startsWith('/api/v1/field/spool/')) { db.fields.push({ key: p.split('/').pop(), ...b }); return json(res, 200, db.fields); }
    if (p === '/api/v1/vendor') { const v = { id: db.vendors.length + 1, ...b }; db.vendors.push(v); return json(res, 200, v); }
    if (p === '/api/v1/filament') { const f = { id: db.filaments.length + 1, ...b, vendor: db.vendors.find((v) => v.id === b.vendor_id) }; db.filaments.push(f); return json(res, 200, f); }
    if (p === '/api/v1/spool') {
      if (rejectExtra && !db.fields.some((f) => f.key === 'tag')) return json(res, 400, { message: 'Unknown extra field tag' });
      const s = { id: db.spools.length + 1, ...b, filament: db.filaments.find((f) => f.id === b.filament_id) }; db.spools.push(s); return json(res, 200, s);
    }
    json(res, 404, {});
  });
  return { db, srv };
}

async function fakeHa(states) {
  return listen((req, res) => (req.url === '/states' ? json(res, 200, states) : json(res, 404, {})));
}

async function bridgeWith(spoolmanUrl, haUrl, patch = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rfid-'));
  const store = new Store(path.join(dir, 'state.json')); await store.load();
  Object.assign(store.state.settings, { spoolmanUrl, ...patch });
  const b = new Bridge({ store });
  b.ha = new HaPublisher({ baseUrl: haUrl, token: 'x' });
  return b;
}

test('normalizeTag: JSON-tekst, kale waarde en lege/nul-waarden', () => {
  assert.equal(normalizeTag('"A1B2"'), 'a1b2');
  assert.equal(normalizeTag('  a1b2 '), 'a1b2');
  for (const v of ['', '""', '   ', '0000000000', undefined, null, 5]) assert.equal(normalizeTag(v), '');
});

test('trayFromState: echte RFID-rol wordt een rol, zonder chip of leeg vak niet', () => {
  const t = trayFromState(tray());
  assert.deepEqual(t, { uuid: UUID.toLowerCase(), entityId: 'sensor.x2d_20p9bj620700578_ams_1_tray_2', brand: 'Bambu Lab', material: 'PLA', name: 'PLA Matte', colorHex: '0078BF', weight: 1000, used: 370 });
  assert.equal(trayFromState(sunlu()), null);
  assert.equal(trayFromState(tray({ empty: true })), null);
  assert.equal(trayFromState(tray({ color: 'x' })), null);
  assert.equal(trayFromState(tray({ remain: -1 })).used, 0); // onbekend resterend gewicht: niets afboeken
});

test('rfidTrays: dubbele uuid en andere printer worden overgeslagen', () => {
  const a = tray(), b = tray({}, 'sensor.x2d_20p9bj620700578_ams_1_tray_3'), c = tray({ tray_uuid: 'B'.repeat(32) }, 'sensor.andere_printer_ams_1_tray_1');
  assert.equal(rfidTrays([a, b, sunlu()]).length, 1);
  assert.equal(rfidTrays([a, c], 'x2d_20p9bj620700578').length, 1);
});

test('rfidRound voegt een nieuwe Bambu-rol toe met tag, gewicht en kleur, en negeert Sunlu', async () => {
  const { db, srv } = await fakeSpoolman(); const ha = await fakeHa([tray(), sunlu()]);
  const b = await bridgeWith(url(srv), url(ha));
  const r = await b.rfidRound();
  assert.equal(r.added, 1);
  assert.equal(db.spools.length, 1);
  const s = db.spools[0];
  assert.equal(s.initial_weight, 1000); assert.equal(s.used_weight, 370);
  assert.equal(JSON.parse(s.extra.tag), UUID.toLowerCase());
  assert.equal(db.filaments[0].name, 'PLA Matte'); assert.equal(db.filaments[0].color_hex, '0078BF'); assert.equal(db.filaments[0].vendor_id, 1);
  assert.equal(db.vendors.length, 1); // 'Bambu Lab' bestond al
  srv.close(); ha.close();
});

test('rfidRound maakt geen dubbele rol: tweede ronde, bestaande tag (JSON of kaal), gearchiveerde rol', async () => {
  for (const tag of [null, JSON.stringify(UUID), UUID.toLowerCase()]) {
    const { db, srv } = await fakeSpoolman(); const ha = await fakeHa([tray()]);
    if (tag) db.spools.push({ id: 7, archived: true, extra: { tag }, filament: { vendor: { name: 'Bambu Lab' }, material: 'PLA', name: 'x', color_hex: '0078BF' }, initial_weight: 1000 });
    const b = await bridgeWith(url(srv), url(ha));
    await b.rfidRound(); const second = await b.rfidRound();
    assert.equal(db.spools.length, 1, `tag=${tag}`);
    assert.equal(second.added, 0);
    srv.close(); ha.close();
  }
});

test('rfidRound hergebruikt een bestaand filament', async () => {
  const { db, srv } = await fakeSpoolman(); const ha = await fakeHa([tray()]);
  db.filaments.push({ id: 5, name: 'PLA Matte', material: 'PLA', color_hex: '0078BF', vendor: { id: 1, name: 'Bambu Lab' } });
  const b = await bridgeWith(url(srv), url(ha));
  await b.rfidRound();
  assert.equal(db.filaments.length, 1); assert.equal(db.spools[0].filament_id, 5);
  srv.close(); ha.close();
});

test('rfidRound maakt het extra veld "tag" aan als Spoolman het niet kent en probeert opnieuw', async () => {
  const { db, srv } = await fakeSpoolman({ rejectExtra: true }); const ha = await fakeHa([tray()]);
  const b = await bridgeWith(url(srv), url(ha));
  const r = await b.rfidRound();
  assert.equal(r.added, 1); assert.deepEqual(db.fields.map((f) => f.key), ['tag']); assert.equal(db.spools.length, 1);
  srv.close(); ha.close();
});

test('rfidRound doet niets als de instelling uit staat, Home Assistant ontbreekt of Spoolman onbereikbaar is', async () => {
  const { db, srv } = await fakeSpoolman(); const ha = await fakeHa([tray()]);
  const off = await bridgeWith(url(srv), url(ha), { rfidAutoAdd: false });
  assert.equal((await off.rfidRound()).skipped, true);
  const noHa = await bridgeWith(url(srv), url(ha)); noHa.ha = new HaPublisher({ baseUrl: url(ha), token: '' });
  assert.equal((await noHa.rfidRound()).skipped, true);
  const down = await bridgeWith('http://127.0.0.1:1', url(ha));
  const r = await down.rfidRound();
  assert.ok(r.error); assert.equal(db.spools.length, 0);
  srv.close(); ha.close();
});
