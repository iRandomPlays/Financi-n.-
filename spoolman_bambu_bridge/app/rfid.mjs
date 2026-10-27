// Originele Bambu-rollen met RFID: zet een rol uit de AMS die nog niet in Spoolman staat automatisch in Spoolman.
// SpoolmanSync herkent een rol aan het Spoolman-veld extra.tag (= tray_uuid van de printer); dat veld vullen we hier.
const DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2, PVA: 1.23 };
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Spoolman bewaart tekstvelden als JSON-tekst ('"ABC"'); handmatig ingevoerde waarden zijn kaal. Lege en nul-waarden tellen niet.
export function normalizeTag(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  try { const x = JSON.parse(s); if (typeof x === 'string') s = x; } catch { /* kale waarde */ }
  s = s.trim().toLowerCase();
  return /^0*$/.test(s) ? '' : s;
}

// Een AMS-vak met een echte RFID-rol (tray_uuid niet leeg of alleen nullen). Rollen zonder chip (Sunlu e.d.) geven null.
export function trayFromState(st) {
  const a = st?.attributes || {};
  if (!st?.entity_id?.startsWith('sensor.') || a.empty === true) return null;
  const uuid = normalizeTag(typeof a.tray_uuid === 'string' ? a.tray_uuid : '');
  if (!uuid || !normalizeTag(typeof a.tag_uid === 'string' ? a.tag_uid : '')) return null;
  const colorHex = String(a.color || '').replace('#', '').slice(0, 6).toUpperCase();
  const material = String(a.type || '').trim().toUpperCase();
  const name = String(a.name || '').replace(/^bambu\s+/i, '').trim() || material;
  const weight = Math.round(Number(a.tray_weight));
  if (!/^[0-9A-F]{6}$/.test(colorHex) || !material || !Number.isFinite(weight) || weight < 1) return null;
  const remain = Number(a.remain);
  const used = Number.isFinite(remain) && remain >= 0 && remain <= 100 ? Math.round(weight * (1 - remain / 100)) : 0;
  return { uuid, entityId: st.entity_id, brand: 'Bambu Lab', material, name, colorHex, weight, used };
}

export function rfidTrays(states, printerPrefix = '') {
  const pre = printerPrefix ? `sensor.${printerPrefix}_` : '';
  const out = new Map();
  for (const st of states || []) {
    if (pre && !st.entity_id?.startsWith(pre)) continue;
    const t = trayFromState(st);
    if (t && !out.has(t.uuid)) out.set(t.uuid, t);
  }
  return [...out.values()];
}

// Voegt de rol toe aan Spoolman (leverancier, filament en rol; bestaande worden hergebruikt).
export async function addRfidSpool(sm, t) {
  const vendors = await sm.listVendors();
  let vendor = vendors.find((x) => same(x.name, t.brand));
  let newVendor = false;
  if (!vendor) { vendor = await sm.createVendor({ name: t.brand }); newVendor = true; }
  const filaments = newVendor ? [] : await sm.listFilaments();
  let fil = filaments.find((f) => f.vendor?.id === vendor.id && same(f.material, t.material) && same(f.name, t.name) && String(f.color_hex || '').toUpperCase() === t.colorHex);
  if (!fil) {
    fil = await sm.createFilament({ name: t.name, vendor_id: vendor.id, material: t.material, density: DENSITY[t.material] || 1.24, diameter: 1.75, weight: t.weight, color_hex: t.colorHex });
  }
  const body = { filament_id: fil.id, initial_weight: t.weight, used_weight: t.used, extra: { tag: JSON.stringify(t.uuid) }, comment: 'Automatisch toegevoegd (RFID uit de AMS)' };
  let spool;
  try { spool = await sm.createSpool(body); }
  catch (e) {
    // Het extra veld "tag" bestaat nog niet in Spoolman: aanmaken en een keer opnieuw proberen.
    if (e.status !== 400 || !/extra|tag/i.test(e.message)) throw e;
    await sm.ensureSpoolField('tag', 'tag');
    spool = await sm.createSpool(body);
  }
  return { spoolId: spool.id, filamentId: fil.id, name: `${t.brand} ${t.name}`, weight: t.weight };
}

// SpoolmanSync koppelt een rol alleen op het moment dat je hem in de AMS plaatst. Een rol die wij pas daarna toevoegen,
// zetten we zelf in zijn vak: extra.active_tray = unique_id van het vak (JSON-tekst), zoals SpoolmanSync dat ook bewaart.
// Alleen als de rol nog niet in een vak staat en het vak nog door geen andere rol wordt gebruikt.
export async function assignTrays(sm, ha, trays, spools) {
  const byTag = new Map();
  for (const s of spools) { const k = normalizeTag(s.rfid); if (k && !s.archived && !byTag.has(k)) byTag.set(k, s); }
  const used = new Set(spools.filter((s) => !s.archived && s.tray).map((s) => s.tray));
  const todo = trays.map((t) => ({ t, spool: byTag.get(t.uuid) })).filter((x) => x.spool && !x.spool.tray);
  if (!todo.length) return [];
  const ids = await ha.trayUniqueIds();
  const done = [];
  for (const { t, spool } of todo) {
    const uid = ids.get(t.entityId);
    if (!uid || used.has(uid)) continue;
    const raw = await sm.getSpool(spool.id);
    await sm.patchSpool(spool.id, { extra: { ...(raw.extra || {}), active_tray: JSON.stringify(uid) } });
    used.add(uid); spool.tray = uid; done.push({ spoolId: spool.id, entityId: t.entityId });
  }
  return done;
}
