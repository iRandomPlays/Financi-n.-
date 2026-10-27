// Printgeschiedenis uit de afboekingen van SpoolmanSync (activity log, type "spool_usage").
// Het afgeboekte gewicht is wat SpoolmanSync berekent (gepland printgewicht x voortgang): een schatting, geen meting.
export const GROUP_GAP_MS = 15 * 60 * 1000; // afboekingen binnen 15 min horen bij dezelfde print
const FRESH_MS = 30 * 60 * 1000; // alleen verse afboekingen krijgen printnaam/status van dit moment
const MAX_PRINTS = 200;
const MAX_SEEN = 1000;

export async function fetchUsageLogs(baseUrl, fetchImpl = fetch, limit = 100) {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/logs?filter=actions&limit=${limit}&page=1`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`SpoolmanSync HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const l of data.logs || []) {
    if (l.type !== 'spool_usage' || !l.details) continue;
    let d; try { d = typeof l.details === 'string' ? JSON.parse(l.details) : l.details; } catch { continue; }
    if (d == null || !Number.isFinite(Number(d.usedWeight)) || d.spoolId == null) continue;
    out.push({ id: l.id, at: new Date(l.createdAt).getTime(), spoolId: Number(d.spoolId), gram: Number(d.usedWeight), tray: d.trayId || '' });
  }
  return out.sort((a, b) => a.at - b.at);
}

// Voegt nieuwe logs toe aan history ({prints, seen}). context() geeft {naam,status,voortgang,gepland} van nu.
export function ingest(history, logs, { spools = [], context = null, now = Date.now() } = {}) {
  const seen = new Set(history.seen);
  const names = new Map(spools.map((s) => [s.id, [s.brand, s.name || s.material].filter(Boolean).join(' ')]));
  let added = 0;
  for (const e of logs) {
    if (seen.has(e.id)) continue;
    seen.add(e.id); history.seen.push(e.id); added++;
    let p = history.prints[0];
    if (!p || e.at - p.lastAt > GROUP_GAP_MS) {
      const fresh = context && now - e.at <= FRESH_MS;
      p = { id: e.id, at: e.at, lastAt: e.at, naam: fresh ? context.naam : '', status: fresh ? context.status : '', voortgang: fresh ? context.voortgang : null, gepland: fresh ? context.gepland : null, rollen: [] };
      history.prints.unshift(p);
    }
    p.lastAt = Math.max(p.lastAt, e.at);
    let r = p.rollen.find((x) => x.id === e.spoolId);
    if (!r) { r = { id: e.spoolId, naam: names.get(e.spoolId) || `Rol ${e.spoolId}`, gram: 0 }; p.rollen.push(r); }
    r.gram = Math.round((r.gram + e.gram) * 10) / 10;
  }
  history.prints.length = Math.min(history.prints.length, MAX_PRINTS);
  if (history.seen.length > MAX_SEEN) history.seen.splice(0, history.seen.length - MAX_SEEN);
  return added;
}

export function historyState(history, limit = 15) {
  const prints = history.prints.slice(0, limit).map((p) => ({
    tijd: new Date(p.at).toISOString(), naam: p.naam || 'Onbekende print', status: p.status || '', voortgang: p.voortgang,
    gepland_g: p.gepland, totaal_g: Math.round(p.rollen.reduce((n, r) => n + r.gram, 0) * 10) / 10, rollen: p.rollen,
  }));
  return { state: history.prints.length, attributes: { friendly_name: 'Printgeschiedenis', icon: 'mdi:history', bron: 'SpoolmanSync (schatting: gepland gewicht x voortgang)', prints } };
}
