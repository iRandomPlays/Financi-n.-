// Uitgesteld koppelen van een rol aan een tray: pas als de printer de rol echt in de tray ziet.
// Pure beslislogica (evaluate) plus een kleine client voor SpoolmanSync (trays ophalen, rol toewijzen).
export const STABLE_MS = 8000; // de rol moet zo lang onafgebroken in de tray worden gezien
export const EXPIRE_MS = 60 * 60 * 1000; // wacht maximaal een uur

const NOT_A_STATE = new Set(['unavailable', 'unknown', '']);

// true = er zit iets in de tray, false = leeg, null = onbekend (HA of printer geeft geen betrouwbaar antwoord).
// Let op: "?" is de naam die de AMS geeft aan een rol zonder chip; die telt als geladen.
export function trayLoaded(st) {
  const s = String(st?.state ?? '').toLowerCase();
  if (!st || NOT_A_STATE.has(s)) return null;
  if (st.attributes?.empty === true || s === 'empty') return false;
  return true;
}

// Bepaalt wat er met een wachtende koppeling moet gebeuren.
// p: { createdAt, baseLoaded, baseUuid, armed, loadedSince }; st: HA-status van de tray.
// Geeft { action: 'wait' | 'assign' | 'expire', patch, phase }.
export function evaluate(p, st, now = Date.now()) {
  if (now - p.createdAt > EXPIRE_MS) return { action: 'expire', patch: {}, phase: 'verlopen' };
  const loaded = trayLoaded(st);
  if (loaded === null) return { action: 'wait', patch: {}, phase: p.phase || 'onbekend' };
  const uuid = String(st.attributes?.tray_uuid || '');
  // Zat er bij het scannen al een rol in de tray, dan telt die niet: eerst moet de tray leeg zijn geweest
  // (of een andere rolchip zijn gezien). Was de tray leeg, dan wachten we meteen op de nieuwe rol.
  let armed = !!p.armed || !p.baseLoaded;
  if (p.baseLoaded && !loaded) armed = true;
  if (p.baseLoaded && loaded && p.baseUuid && uuid && uuid !== p.baseUuid) armed = true;
  if (!armed) return { action: 'wait', patch: { armed, loadedSince: 0 }, phase: 'oude-rol-eruit' };
  if (!loaded) return { action: 'wait', patch: { armed, loadedSince: 0 }, phase: 'wacht-op-rol' };
  const since = p.loadedSince || now;
  if (now - since >= STABLE_MS) return { action: 'assign', patch: { armed, loadedSince: since }, phase: 'gezien' };
  return { action: 'wait', patch: { armed, loadedSince: since }, phase: 'rol-gezien' };
}

const colorOf = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7).toUpperCase() : '');

// Maakt van het SpoolmanSync-antwoord (/api/printers) een platte lijst met trays.
export function flattenTrays(data) {
  const out = [];
  const add = (t, printer, group, label) => {
    const id = t.unique_id || t.entity_id;
    if (!id || !t.entity_id) return;
    out.push({
      id, entityId: t.entity_id, printer: printer.name, group, label,
      name: t.name || '', color: colorOf(t.color), material: t.material || '',
      assignedSpoolId: t.assigned_spool?.id ?? null,
    });
  };
  for (const printer of data?.printers || []) {
    if (printer.is_virtual) continue;
    for (const ams of printer.ams_units || []) for (const t of ams.trays || []) add(t, printer, ams.name || 'AMS', `Tray ${t.tray_number}`);
    const ext = printer.external_spools || [];
    ext.forEach((t, i) => add(t, printer, 'Extern', t.slot_name?.trim() || (ext.length > 1 ? `Externe spoel ${i + 1}` : 'Externe spoel')));
  }
  return out;
}

async function ssRequest(fetchImpl, url, opts = {}) {
  let res;
  try { res = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw Object.assign(new Error(`SpoolmanSync niet bereikbaar: ${e.message}`), { status: 502 }); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `SpoolmanSync gaf ${res.status}`), { status: res.status >= 500 ? 502 : res.status });
  return data;
}

export async function fetchTrays(baseUrl, fetchImpl = fetch) {
  return flattenTrays(await ssRequest(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/api/printers`));
}

// Gebruikt de eigen toewijzing van SpoolmanSync, zodat een andere rol in dezelfde tray netjes wordt losgekoppeld.
export async function assignViaSpoolmanSync(baseUrl, spoolId, trayId, fetchImpl = fetch) {
  return ssRequest(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/api/spools`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spoolId, trayId }),
  });
}
