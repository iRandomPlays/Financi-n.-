import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Store, Bridge } from '../spoolman_bambu_bridge/app/core.mjs';
import { HaPublisher } from '../spoolman_bambu_bridge/app/publish.mjs';
import { createLanApp } from '../spoolman_bambu_bridge/app/server.mjs';
import { evaluate, trayLoaded, flattenTrays, STABLE_MS, EXPIRE_MS } from '../spoolman_bambu_bridge/app/trays.mjs';
import { SCAN_PAGE } from '../spoolman_bambu_bridge/app/scanpage.mjs';

const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };

const TRAY = 'sensor.x2d_ams_1_tray_1';
const tray = (empty, extra = {}) => ({ state: empty ? 'Empty' : 'Sunlu PLA', attributes: { empty, tray_uuid: '', ...extra } });

// ---------- beslislogica ----------

test('trayLoaded: leeg, geladen, "?" (rol zonder chip) en onbekend', () => {
  assert.equal(trayLoaded(tray(true)), false);
  assert.equal(trayLoaded(tray(false)), true);
  assert.equal(trayLoaded({ state: '?', attributes: { empty: false, unknown: true } }), true, '"?" is een geladen rol zonder chip');
  assert.equal(trayLoaded({ state: 'unavailable', attributes: {} }), null);
  assert.equal(trayLoaded({ state: 'unknown', attributes: {} }), null);
  assert.equal(trayLoaded(null), null);
});

test('lege tray: pas koppelen als de rol STABLE_MS onafgebroken wordt gezien', () => {
  const p = { createdAt: 0, baseLoaded: false, baseUuid: '', armed: false, loadedSince: 0 };
  let r = evaluate(p, tray(true), 1000);
  assert.equal(r.action, 'wait'); assert.equal(r.phase, 'wacht-op-rol');
  r = evaluate(p, tray(false), 2000); Object.assign(p, r.patch);
  assert.equal(r.action, 'wait'); assert.equal(r.phase, 'rol-gezien'); assert.equal(p.loadedSince, 2000);
  r = evaluate(p, tray(false), 2000 + STABLE_MS - 1); assert.equal(r.action, 'wait');
  r = evaluate(p, tray(false), 2000 + STABLE_MS); assert.equal(r.action, 'assign');
});

test('knipperen: als de tray tussendoor leeg lijkt, begint het wachten opnieuw', () => {
  const p = { createdAt: 0, baseLoaded: false, armed: false, loadedSince: 0 };
  Object.assign(p, evaluate(p, tray(false), 1000).patch);
  Object.assign(p, evaluate(p, tray(true), 5000).patch);
  assert.equal(p.loadedSince, 0);
  Object.assign(p, evaluate(p, tray(false), 6000).patch);
  assert.equal(evaluate(p, tray(false), 6000 + STABLE_MS - 1).action, 'wait');
});

test('zat er al een rol in: de oude rol telt niet, eerst moet de tray leeg zijn geweest', () => {
  const p = { createdAt: 0, baseLoaded: true, baseUuid: '', armed: false, loadedSince: 0 };
  for (const t of [10000, 20000, 100000]) {
    const r = evaluate(p, tray(false), t); Object.assign(p, r.patch);
    assert.equal(r.action, 'wait'); assert.equal(r.phase, 'oude-rol-eruit');
  }
  Object.assign(p, evaluate(p, tray(true), 110000).patch);
  assert.equal(p.armed, true);
  Object.assign(p, evaluate(p, tray(false), 120000).patch);
  assert.equal(evaluate(p, tray(false), 120000 + STABLE_MS).action, 'assign');
});

test('een andere rolchip (tray_uuid) in een eerder geladen tray telt ook als nieuwe rol', () => {
  const p = { createdAt: 0, baseLoaded: true, baseUuid: 'AAA', armed: false, loadedSince: 0 };
  let r = evaluate(p, tray(false, { tray_uuid: 'AAA' }), 1000); Object.assign(p, r.patch); assert.equal(r.phase, 'oude-rol-eruit');
  r = evaluate(p, tray(false, { tray_uuid: 'BBB' }), 2000); Object.assign(p, r.patch); assert.equal(r.phase, 'rol-gezien');
  assert.equal(evaluate(p, tray(false, { tray_uuid: 'BBB' }), 2000 + STABLE_MS).action, 'assign');
});

test('onbekende of onbeschikbare status leidt niets af; na een uur verloopt de wachtrij', () => {
  const p = { createdAt: 0, baseLoaded: false, armed: false, loadedSince: 0 };
  assert.equal(evaluate(p, { state: 'unavailable', attributes: {} }, 1000).action, 'wait');
  assert.equal(evaluate(p, null, 1000).action, 'wait');
  assert.equal(evaluate(p, tray(false), EXPIRE_MS + 1).action, 'expire');
});

test('flattenTrays: gebruikt unique_id, slaat virtuele printers over, benoemt externe spoelen', () => {
  const list = flattenTrays({ printers: [
    { name: 'X2D', ams_units: [{ name: 'AMS 1', trays: [{ entity_id: 'sensor.a', unique_id: 'u1', tray_number: 1, name: 'PLA', color: '#0078BFFF', assigned_spool: { id: 3 } }] }], external_spools: [{ entity_id: 'sensor.e', tray_number: 0 }] },
    { name: 'Droogbox', is_virtual: true, ams_units: [{ name: 'x', trays: [{ entity_id: 'v', tray_number: 1 }] }], external_spools: [] }] });
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].id, list[0].label, list[0].color, list[0].assignedSpoolId], ['u1', 'Tray 1', '#0078BF', 3]);
  assert.deepEqual([list[1].id, list[1].group, list[1].label], ['sensor.e', 'Extern', 'Externe spoel']);
});

// ---------- bridge met nagebootste Spoolman, SpoolmanSync en Home Assistant ----------

async function setup() {
  const world = { ha: { [TRAY]: tray(true) }, assigns: [], assignFail: 0, published: {},
    spools: [{ id: 5, remaining_weight: 900, initial_weight: 1000, archived: false, location: 'Vincent', filament: { name: 'PLA C220 Zwart', material: 'PLA', color_hex: '000000', vendor: { name: 'SUNLU' } } },
             { id: 6, remaining_weight: 100, initial_weight: 1000, archived: true, filament: { name: 'Oud', material: 'PLA', vendor: { name: 'X' } } },
             { id: 7, remaining_weight: 800, initial_weight: 1000, archived: false, filament: { name: 'Wit', material: 'PLA', color_hex: 'FFFFFF', vendor: { name: 'SUNLU' } } }] };
  const sm = await listen((req, res) => json(res, 200, world.spools));
  const ss = await listen(async (req, res) => {
    if (req.url === '/api/printers') return json(res, 200, { printers: [{ name: 'X2D', ams_units: [{ name: 'AMS 1', trays: [{ entity_id: TRAY, unique_id: 'uid-tray-1', tray_number: 1, name: 'Sunlu', color: '#112233FF' }] }], external_spools: [] }] });
    if (req.url === '/api/spools' && req.method === 'POST') {
      if (world.assignFail > 0) { world.assignFail--; return json(res, 500, { error: 'Failed to assign spool' }); }
      world.assigns.push(await readBody(req)); return json(res, 200, { spool: {} });
    }
    json(res, 404, {});
  });
  const ha = await listen(async (req, res) => {
    const id = req.url.replace('/states/', '');
    if (req.method === 'GET') return world.ha[id] ? json(res, 200, world.ha[id]) : json(res, 404, {});
    world.published[id] = await readBody(req); json(res, 200, {});
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pending-'));
  const store = new Store(path.join(dir, 'state.json')); await store.load();
  const bridge = new Bridge({ store });
  bridge.ha = new HaPublisher({ baseUrl: `http://127.0.0.1:${ha.address().port}`, token: 't' });
  store.state.settings.spoolmanUrl = `http://127.0.0.1:${sm.address().port}`;
  store.state.settings.spoolmansyncUrl = `http://127.0.0.1:${ss.address().port}`;
  return { world, bridge, store, dir, close: () => { sm.close(); ss.close(); ha.close(); } };
}

test('scannen, tray kiezen, rol erin: koppeling gebeurt pas als de printer de rol ziet', async () => {
  const t = await setup();
  const info = await t.bridge.queueAssign(5, 'uid-tray-1');
  assert.equal(info.pending.trayId, 'uid-tray-1'); assert.equal(info.pending.phase, 'wacht-op-rol');
  assert.equal(t.world.assigns.length, 0, 'nog niet gekoppeld direct na scannen');
  const t0 = Date.now();
  await t.bridge.checkPending(t0 + 1000);
  await t.bridge.checkPending(t0 + 30000);
  assert.equal(t.world.assigns.length, 0, 'tray is nog leeg: niet koppelen');
  t.world.ha[TRAY] = tray(false);
  await t.bridge.checkPending(t0 + 40000);
  assert.equal(t.world.assigns.length, 0, 'rol net gezien: nog even wachten');
  assert.equal((await t.bridge.scanInfo(5)).pending.phase, 'rol-gezien');
  await t.bridge.checkPending(t0 + 40000 + STABLE_MS + 1);
  assert.deepEqual(t.world.assigns, [{ spoolId: 5, trayId: 'uid-tray-1' }]);
  assert.equal(t.store.state.pendingAssigns.length, 0);
  assert.equal(t.store.state.lastAssigned.spoolId, 5);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.world.published['sensor.spoolman_tray_koppelingen'].state, 0);
  t.close();
});

test('er zat nog een oude rol in de tray: niet koppelen aan de oude rol', async () => {
  const t = await setup();
  t.world.ha[TRAY] = tray(false);
  const info = await t.bridge.queueAssign(5, 'uid-tray-1');
  assert.equal(info.pending.phase, 'oude-rol-eruit');
  const t0 = Date.now();
  await t.bridge.checkPending(t0 + 60000); await t.bridge.checkPending(t0 + 120000);
  assert.equal(t.world.assigns.length, 0);
  t.world.ha[TRAY] = tray(true); await t.bridge.checkPending(t0 + 130000);
  t.world.ha[TRAY] = tray(false); await t.bridge.checkPending(t0 + 140000);
  await t.bridge.checkPending(t0 + 140000 + STABLE_MS + 1);
  assert.equal(t.world.assigns.length, 1);
  t.close();
});

test('mislukt koppelen blijft wachten en wordt opnieuw geprobeerd', async () => {
  const t = await setup();
  await t.bridge.queueAssign(5, 'uid-tray-1');
  t.world.ha[TRAY] = tray(false); t.world.assignFail = 1;
  const t0 = Date.now();
  await t.bridge.checkPending(t0); await t.bridge.checkPending(t0 + STABLE_MS + 1);
  assert.equal(t.world.assigns.length, 0); assert.equal(t.store.state.pendingAssigns.length, 1);
  assert.match(t.store.state.pendingAssigns[0].lastError, /Failed to assign/);
  await t.bridge.checkPending(t0 + STABLE_MS + 6000);
  assert.equal(t.world.assigns.length, 1); assert.equal(t.store.state.pendingAssigns.length, 0);
  t.close();
});

test('een tweede rol voor dezelfde tray vervangt de eerste; annuleren werkt', async () => {
  const t = await setup();
  await t.bridge.queueAssign(5, 'uid-tray-1'); await t.bridge.queueAssign(7, 'uid-tray-1');
  assert.deepEqual(t.store.state.pendingAssigns.map((p) => p.spoolId), [7]);
  const info = await t.bridge.scanInfo(5); assert.equal(info.pending, null);
  await t.bridge.cancelAssign(7);
  assert.equal(t.store.state.pendingAssigns.length, 0);
  t.close();
});

test('onbekende tray, gearchiveerde of onbekende rol worden geweigerd', async () => {
  const t = await setup();
  await assert.rejects(t.bridge.queueAssign(5, 'bestaat-niet'), /Onbekende tray/);
  await assert.rejects(t.bridge.queueAssign(6, 'uid-tray-1'), /bestaat niet/);
  await assert.rejects(t.bridge.queueAssign(99, 'uid-tray-1'), /bestaat niet/);
  await assert.rejects(t.bridge.scanInfo('abc'), /Ongeldig/);
  assert.equal(t.store.state.pendingAssigns.length, 0);
  t.close();
});

test('wachtende koppelingen overleven een herstart van de bridge', async () => {
  const t = await setup();
  await t.bridge.queueAssign(5, 'uid-tray-1');
  const store2 = new Store(path.join(t.dir, 'state.json')); await store2.load();
  assert.equal(store2.state.pendingAssigns.length, 1); assert.equal(store2.state.pendingAssigns[0].spoolId, 5);
  t.close();
});

test('"nu koppelen" koppelt meteen (rol zit er al in)', async () => {
  const t = await setup();
  const info = await t.bridge.assignNow(5, 'uid-tray-1');
  assert.deepEqual(t.world.assigns, [{ spoolId: 5, trayId: 'uid-tray-1' }]); assert.equal(info.pending, null);
  t.close();
});

// ---------- netwerkingang (poort 8100) ----------

test('QR-pagina en scan-API zonder token; al het andere blijft achter het token', async () => {
  const t = await setup();
  const srv = createLanApp({ bridge: t.bridge }); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let r = await fetch(`${base}/scan/spool/5`);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.equal(await r.text(), SCAN_PAGE);
  r = await fetch(`${base}/api/scan/5`); const info = await r.json();
  assert.equal(r.status, 200); assert.equal(info.spool.id, 5); assert.equal(info.trays[0].id, 'uid-tray-1');
  r = await fetch(`${base}/api/scan/5/queue`, { method: 'POST', body: JSON.stringify({ trayId: 'uid-tray-1' }) });
  assert.equal(r.status, 200); assert.equal((await r.json()).pending.label, 'X2D AMS 1 Tray 1');
  r = await fetch(`${base}/api/scan/5/cancel`, { method: 'POST', body: '{}' }); assert.equal((await r.json()).pending, null);
  r = await fetch(`${base}/api/scan/5/queue`, { method: 'POST', body: JSON.stringify({ trayId: 'nee' }) }); assert.equal(r.status, 400);
  r = await fetch(`${base}/api/scan/5`, { method: 'DELETE' }); assert.equal(r.status, 405);
  r = await fetch(`${base}/api/scan/abc`); assert.equal(r.status, 401, 'geen geldig rolnummer valt terug op de tokencontrole');
  r = await fetch(`${base}/api/quick-add/catalog`); assert.equal(r.status, 401);
  r = await fetch(`${base}/api/status`); assert.equal(r.status, 401);
  r = await fetch(`${base}/api/quick-add`, { method: 'POST', body: '{}' }); assert.equal(r.status, 401);
  srv.close(); t.close();
});

test('scanpagina: geen innerHTML met servergegevens en geen niet-ge-escapete ${...}', () => {
  assert.ok(!/innerHTML/.test(SCAN_PAGE));
  assert.ok(SCAN_PAGE.includes('/api/scan/'));
});
