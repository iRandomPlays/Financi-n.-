// Publiceert voorraad en status als sensoren in Home Assistant (REST /core/api/states), zodat dashboards ze kunnen tonen.
// Alleen-lezen weergave: de bridge blijft de bron en zet ze elke ronde opnieuw (ze verdwijnen bij een HA-herstart tot de volgende ronde).
const PREFIX = 'sensor.spoolman_rol_';
export const SUMMARY_ID = 'sensor.spoolman_voorraad';
export const STATUS_ID = 'sensor.spoolman_bridge_status';

const round1 = (x) => Math.round(x * 10) / 10;
export const spoolName = (s) => [s.brand, s.name || s.material].filter(Boolean).join(' ') || `Rol ${s.id}`;

export function buildStates({ spools, links, lowStockGrams = 100, bambuStatus, lastRound, running }) {
  const linkBy = new Map(links.map((l) => [l.spoolmanId, l]));
  const active = spools.filter((s) => !s.archived);
  const states = {};
  const rollen = [];
  for (const s of active) {
    const l = linkBy.get(s.id);
    const grams = s.remainingWeight == null ? null : round1(s.remainingWeight);
    const initial = s.initialWeight || null;
    const pct = grams != null && initial ? Math.max(0, Math.min(100, Math.round((grams / initial) * 100))) : null;
    const sync = !l ? 'niet gekoppeld' : l.paused ? `gepauzeerd: ${l.pauseReason}` : l.lastError ? `fout: ${l.lastError}` : 'ok';
    const low = grams != null && grams <= lowStockGrams;
    states[PREFIX + s.id] = {
      state: grams ?? 'unknown',
      attributes: {
        friendly_name: spoolName(s), unit_of_measurement: 'g', device_class: 'weight', icon: 'mdi:printer-3d-nozzle',
        spool_id: s.id, merk: s.brand, materiaal: s.material, filament: s.name, kleur: s.colorHex ? `#${s.colorHex}` : '',
        beginwicht_g: initial, resterend_procent: pct, laag: low, locatie: s.location, tray: s.tray || '',
        bambu_id: l?.bambuId ?? '', sync,
      },
    };
    rollen.push({ id: s.id, naam: spoolName(s), materiaal: s.material, kleur: s.colorHex ? `#${s.colorHex}` : '', gram: grams, procent: pct, laag: low, tray: s.tray || '', sync });
  }
  rollen.sort((a, b) => (a.procent ?? 101) - (b.procent ?? 101));
  const total = rollen.reduce((n, r) => n + (r.gram || 0), 0);
  states[SUMMARY_ID] = {
    state: round1(total),
    attributes: {
      friendly_name: 'Spoolman voorraad', unit_of_measurement: 'g', device_class: 'weight', icon: 'mdi:database',
      aantal_rollen: rollen.length, laag_aantal: rollen.filter((r) => r.laag).length, laag_grens_g: lowStockGrams,
      laag: rollen.filter((r) => r.laag).map((r) => r.naam), gekoppeld: links.filter((l) => !l.paused).length,
      gepauzeerd: links.filter((l) => l.paused).length, rollen,
    },
  };
  const state = bambuStatus !== 'connected' ? 'niet_ingelogd' : lastRound?.error || lastRound?.failed ? 'fout' : links.some((l) => l.paused) ? 'pauze' : 'ok';
  states[STATUS_ID] = {
    state,
    attributes: { friendly_name: 'Bambu Bridge status', icon: 'mdi:sync', bambu: bambuStatus, laatste_ronde: lastRound?.at || '', bijgewerkt: lastRound?.updated ?? 0, mislukt: lastRound?.failed ?? 0, bezig: !!running, fout: lastRound?.error || '' },
  };
  return states;
}

export class HaPublisher {
  constructor({ baseUrl = process.env.HA_API_URL || 'http://supervisor/core/api', token = process.env.SUPERVISOR_TOKEN || '', fetchImpl = fetch } = {}) {
    this.base = baseUrl.replace(/\/+$/, ''); this.token = token; this.fetchImpl = fetchImpl; this.published = new Set();
  }
  get enabled() { return !!this.token; }
  async call(method, id, body) {
    const res = await this.fetchImpl(`${this.base}/states/${id}`, {
      method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`HA ${res.status}`);
  }
  // Zet alle sensoren en ruimt sensoren op van rollen die niet meer bestaan.
  async publish(states, { cleanup = true } = {}) {
    if (!this.enabled) return { skipped: true };
    let n = 0;
    for (const [id, body] of Object.entries(states)) { await this.call('POST', id, body); this.published.add(id); n++; }
    if (!cleanup) return { published: n };
    for (const id of [...this.published]) {
      if (!states[id] && id.startsWith(PREFIX)) { await this.call('DELETE', id); this.published.delete(id); }
    }
    return { published: n };
  }
}
