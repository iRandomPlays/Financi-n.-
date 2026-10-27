// Spoolman Bambu Bridge - kern: opslag, Spoolman-client, Bambu-client, synchronisatie.
// Geen externe afhankelijkheden. De Bambu-cloud-API is niet openbaar gedocumenteerd;
// alle Bambu-specifieke endpoints staan daarom in BambuClient.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HaPublisher, buildStates, STATUS_ID } from './publish.mjs';

export const VERSION = '0.3.0';
export const MIN_INTERVAL = 30;
export const MAX_INTERVAL = 3600;
export const DEFAULT_INTERVAL = 60;
const MAX_ACTIVITY = 100;

const BAMBU_HOSTS = {
  us: 'https://api.bambulab.com',
  eu: 'https://api.bambulab.com',
  cn: 'https://api.bambulab.cn',
};

export class HttpError extends Error {
  constructor(message, status, { uncertain = false } = {}) {
    super(message);
    this.status = status;
    this.uncertain = uncertain; // true: onbekend of de server het verzoek heeft verwerkt
  }
}

async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new HttpError(`Netwerkfout: ${e.message}`, 0, { uncertain: true });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new HttpError(String(msg), res.status, { uncertain: res.status >= 500 });
  }
  return data;
}

// ---------- Opslag ----------

const EMPTY_STATE = () => ({
  version: 1,
  settings: { spoolmanUrl: '', intervalSeconds: DEFAULT_INTERVAL, autoSync: false, autoCreate: false, lowStockGrams: 100, region: 'us' },
  bambu: { token: '', email: '', status: 'disconnected' },
  links: [], // { id, spoolmanId, bambuId, paused, pauseReason, lastSyncedGrams, lastSyncAt, lastError, createdAt }
  pendingCreates: [], // { spoolmanId, marker, startedAt }
  activity: [],
});

export class Store {
  constructor(file) { this.file = file; this.state = EMPTY_STATE(); }
  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const base = EMPTY_STATE();
      this.state = { ...base, ...raw, settings: { ...base.settings, ...raw.settings }, bambu: { ...base.bambu, ...raw.bambu } };
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`state.json onleesbaar (${e.message}); herstel uit back-up`);
    }
    return this.state;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
  log(level, message) {
    this.state.activity.unshift({ at: new Date().toISOString(), level, message });
    this.state.activity.length = Math.min(this.state.activity.length, MAX_ACTIVITY);
  }
}

// ---------- Spoolman ----------

export class SpoolmanClient {
  constructor(baseUrl, fetchImpl = fetch) { this.base = baseUrl.replace(/\/+$/, ''); this.fetchImpl = fetchImpl; }
  async listSpools() {
    const data = await request(`${this.base}/api/v1/spool?allow_archived=true`, { fetchImpl: this.fetchImpl });
    return (data || []).map(normalizeSpoolmanSpool);
  }
  async ping() { await request(`${this.base}/api/v1/health`, { fetchImpl: this.fetchImpl }); }
}

function parseExtra(v) {
  if (typeof v !== 'string' || !v) return '';
  try { const x = JSON.parse(v); return typeof x === 'string' ? x : ''; } catch { return v; }
}

export function normalizeSpoolmanSpool(s) {
  const f = s.filament || {};
  const remaining = typeof s.remaining_weight === 'number' ? s.remaining_weight : null; // null = onbekend, niet 0
  return {
    id: s.id,
    archived: !!s.archived,
    brand: f.vendor?.name || '',
    material: f.material || '',
    name: f.name || '',
    colorHex: (f.color_hex || '').replace('#', '').toUpperCase(),
    initialWeight: s.initial_weight ?? f.weight ?? null,
    remainingWeight: remaining,
    location: s.location || '',
    rfid: s.extra?.rfid || s.extra?.tag || '',
    tray: parseExtra(s.extra?.active_tray), // door SpoolmanSync gevuld (JSON-tekst in Spoolman)
  };
}

// ---------- Bambu (niet-openbare API, afzonderlijk onderhoudbaar) ----------

export class BambuClient {
  constructor({ token = '', region = 'us', fetchImpl = fetch } = {}) {
    this.token = token; this.region = region; this.fetchImpl = fetchImpl;
    this.host = BAMBU_HOSTS[region] || BAMBU_HOSTS.us;
  }
  get auth() { return { authorization: `Bearer ${this.token}` }; }
  async login(email, password) {
    const r = await request(`${this.host}/v1/user-service/user/login`, { method: 'POST', body: { account: email, password }, fetchImpl: this.fetchImpl });
    if (r?.loginType === 'verifyCode') {
      await request(`${this.host}/v1/user-service/user/sendemail/code`, { method: 'POST', body: { email, type: 'codeLogin' }, fetchImpl: this.fetchImpl }).catch(() => {});
      return { needs: 'email' };
    }
    if (r?.loginType === 'tfa') return { needs: 'tfa', tfaKey: r.tfaKey };
    if (!r?.accessToken) throw new HttpError('Inloggen mislukt: geen token ontvangen', 400);
    this.token = r.accessToken;
    return { token: this.token };
  }
  async verify({ email, password, code, tfaKey }) {
    let r;
    if (tfaKey) {
      r = await request(`${this.host}/v1/user-service/user/tfa/login`, { method: 'POST', body: { tfaKey, tfaCode: code }, fetchImpl: this.fetchImpl });
    } else {
      r = await request(`${this.host}/v1/user-service/user/login`, { method: 'POST', body: { account: email, password, code, loginType: 'verifyCode' }, fetchImpl: this.fetchImpl });
    }
    const token = r?.accessToken || r?.token;
    if (!token) throw new HttpError('Verificatie mislukt: geen token ontvangen', 400);
    this.token = token;
    return { token };
  }
  get filamentBase() { return `${this.host}/v1/design-user-service/my/filament/v2`; }
  async listFilaments() {
    const all = []; let offset = 0;
    for (;;) {
      const d = await request(`${this.filamentBase}?offset=${offset}&limit=50`, { headers: this.auth, fetchImpl: this.fetchImpl });
      const hits = d?.hits || d?.data?.hits || [];
      all.push(...hits);
      const total = Number(d?.total ?? d?.data?.total ?? 0);
      offset += hits.length;
      if (!hits.length || offset >= total) break;
    }
    return all;
  }
  async createFilament(body) {
    return request(this.filamentBase, { method: 'POST', headers: this.auth, body, fetchImpl: this.fetchImpl });
  }
  async deleteFilaments(ids) {
    return request(`${this.filamentBase}/batch`, { method: 'DELETE', headers: this.auth, body: { ids: ids.map(Number) }, fetchImpl: this.fetchImpl });
  }
  // Bambu eist filamentName ook bij een gewichtsupdate; zonder wordt de naam leeggemaakt of de call geweigerd.
  async updateWeight(id, netWeight, filamentName) {
    return request(this.filamentBase, { method: 'PUT', headers: this.auth, body: { id: Number(id), netWeight, filamentName }, fetchImpl: this.fetchImpl });
  }
}

export function bambuCreateBody(spool, marker) {
  const material = spool.material || 'PLA';
  const total = Math.round(spool.initialWeight || spool.remainingWeight || 1000);
  return {
    createType: 'manual',
    filamentVendor: spool.brand || '',
    filamentType: material,
    // Materiaal alleen voorvoegen als de naam er nog niet mee begint (voorkomt "PLA PLA ...").
    filamentName: spool.name ? (spool.name.toUpperCase().startsWith(material.toUpperCase()) ? spool.name : `${material} ${spool.name}`).slice(0, 60) : material,
    filamentId: '',
    isSupport: false,
    color: `#${(spool.colorHex || '888888').slice(0, 6).toUpperCase()}FF`, // zelfde notatie als Bambu zelf (#RRGGBBAA)
    colorType: 2,
    totalNetWeight: total,
    netWeight: Math.max(0, Math.round(spool.remainingWeight ?? 0)),
    note: marker, // herkenning voor herstel na onzekere aanmaak
  };
}

export const markerFor = (spoolmanId) => `[spoolman:${spoolmanId}]`;

// ---------- Synchronisatie ----------

export class Bridge {
  constructor({ store, fetchImpl = fetch }) {
    this.store = store; this.fetchImpl = fetchImpl;
    this.running = false; this.timer = null; this.lastRound = null;
    this.pendingLogin = null;
    this.ha = new HaPublisher({ fetchImpl });
    this.lastPublishError = '';
  }
  get s() { return this.store.state; }
  spoolman() {
    if (!this.s.settings.spoolmanUrl) throw new HttpError('Spoolman-URL is niet ingesteld', 400);
    return new SpoolmanClient(this.s.settings.spoolmanUrl, this.fetchImpl);
  }
  bambu() {
    if (!this.s.bambu.token) throw new HttpError('Niet ingelogd bij Bambu', 401);
    return new BambuClient({ token: this.s.bambu.token, region: this.s.settings.region, fetchImpl: this.fetchImpl });
  }

  async updateSettings(patch) {
    const st = this.s.settings;
    if (patch.spoolmanUrl !== undefined) {
      const u = String(patch.spoolmanUrl).trim();
      if (u && !/^https?:\/\//.test(u)) throw new HttpError('Spoolman-URL moet met http:// of https:// beginnen', 400);
      st.spoolmanUrl = u;
    }
    if (patch.intervalSeconds !== undefined) {
      const n = Math.round(Number(patch.intervalSeconds));
      if (!Number.isFinite(n) || n < MIN_INTERVAL || n > MAX_INTERVAL) throw new HttpError(`Interval moet tussen ${MIN_INTERVAL} en ${MAX_INTERVAL} seconden liggen`, 400);
      st.intervalSeconds = n;
    }
    if (patch.autoSync !== undefined) st.autoSync = !!patch.autoSync;
    if (patch.autoCreate !== undefined) st.autoCreate = !!patch.autoCreate;
    if (patch.lowStockGrams !== undefined) {
      const g = Math.round(Number(patch.lowStockGrams));
      if (!Number.isFinite(g) || g < 0 || g > 1000) throw new HttpError('Grens voor lage voorraad moet tussen 0 en 1000 g liggen', 400);
      st.lowStockGrams = g;
    }
    if (patch.region !== undefined) st.region = BAMBU_HOSTS[patch.region] ? patch.region : 'us';
    await this.store.save();
    this.schedule();
  }

  // Inloggen: wachtwoord wordt alleen in geheugen bewaard tot verificatie klaar is, nooit opgeslagen.
  async login(email, password) {
    const c = new BambuClient({ region: this.s.settings.region, fetchImpl: this.fetchImpl });
    const r = await c.login(email, password);
    if (r.token) return this.finishLogin(email, r.token);
    this.pendingLogin = { email, password, tfaKey: r.tfaKey, at: Date.now() };
    this.s.bambu.status = 'pending_code';
    return { needsCode: true, method: r.needs };
  }
  async verify(code) {
    const p = this.pendingLogin;
    if (!p || Date.now() - p.at > 600000) throw new HttpError('Geen openstaande login of code verlopen; log opnieuw in', 400);
    const c = new BambuClient({ region: this.s.settings.region, fetchImpl: this.fetchImpl });
    const r = await c.verify({ ...p, code });
    this.pendingLogin = null;
    return this.finishLogin(p.email, r.token);
  }
  async finishLogin(email, token) {
    this.s.bambu = { token, email, status: 'connected' };
    this.store.log('info', `Ingelogd bij Bambu als ${email.replace(/^(.).*(@.*)$/, '$1***$2')}`);
    await this.store.save();
    return { connected: true };
  }
  async logout() {
    this.s.bambu = { token: '', email: '', status: 'disconnected' };
    this.pendingLogin = null;
    await this.store.save();
  }

  // Overzicht voor de UI: beide lijsten + suggesties (nooit automatisch gekoppeld).
  async overview() {
    const [spools, cloud] = await Promise.all([this.spoolman().listSpools(), this.bambu().listFilaments()]);
    const linkedB = new Set(this.s.links.map((l) => String(l.bambuId)));
    const linkedS = new Set(this.s.links.map((l) => l.spoolmanId));
    const suggestions = [];
    for (const sp of spools) {
      if (linkedS.has(sp.id) || sp.archived) continue;
      const marked = cloud.find((c) => (c.note || '').includes(markerFor(sp.id)) && !linkedB.has(String(c.id)));
      if (marked) { suggestions.push({ spoolmanId: sp.id, bambuId: marked.id, confidence: 'hoog', reason: 'Bambu-rol draagt Spoolman-markering' }); continue; }
      const cands = cloud.filter((c) => !linkedB.has(String(c.id)) && (c.filamentType || '').toUpperCase() === sp.material.toUpperCase()
        && (c.color || '').replace('#', '').slice(0, 6).toUpperCase() === sp.colorHex.slice(0, 6));
      // Onduidelijk (0 of >1 kandidaten, of alleen kleur+materiaal): altijd handmatig bevestigen.
      if (cands.length) suggestions.push({ spoolmanId: sp.id, bambuId: cands[0].id, confidence: cands.length === 1 ? 'laag' : 'dubbelzinnig', reason: `kleur+materiaal, ${cands.length} kandidaat/kandidaten`, candidates: cands.map((c) => c.id) });
    }
    return { spools, cloud, links: this.s.links, suggestions };
  }

  async spoolmanCheck() {
    try {
      const spools = await this.spoolman().listSpools();
      return { ok: true, count: spools.length, active: spools.filter((x) => !x.archived).length };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async addLink(spoolmanId, bambuId) {
    spoolmanId = Number(spoolmanId); bambuId = String(bambuId);
    if (this.s.links.some((l) => l.spoolmanId === spoolmanId)) throw new HttpError('Deze Spoolman-rol is al gekoppeld', 409);
    if (this.s.links.some((l) => String(l.bambuId) === bambuId)) throw new HttpError('Deze Bambu-rol is al gekoppeld', 409);
    const link = { id: crypto.randomUUID(), spoolmanId, bambuId, paused: false, pauseReason: '', lastSyncedGrams: null, lastSyncAt: null, lastError: '', createdAt: new Date().toISOString() };
    this.s.links.push(link);
    this.store.log('info', `Koppeling Spoolman #${spoolmanId} ↔ Bambu ${bambuId}`);
    await this.store.save();
    return link;
  }
  // Ontkoppelen verwijdert nooit rollen, alleen de koppeling.
  async removeLink(id) {
    const i = this.s.links.findIndex((l) => l.id === id);
    if (i < 0) throw new HttpError('Koppeling niet gevonden', 404);
    const [l] = this.s.links.splice(i, 1);
    this.store.log('info', `Koppeling Spoolman #${l.spoolmanId} verwijderd (rollen ongewijzigd)`);
    await this.store.save();
  }

  // Maakt een Bambu-rol aan. Bij onzekere uitkomst wordt eerst naar de markering gezocht i.p.v. opnieuw aan te maken.
  async createBambuFor(spoolmanId) {
    spoolmanId = Number(spoolmanId);
    if (this.s.links.some((l) => l.spoolmanId === spoolmanId)) throw new HttpError('Deze Spoolman-rol is al gekoppeld', 409);
    const spool = (await this.spoolman().listSpools()).find((s) => s.id === spoolmanId);
    if (!spool) throw new HttpError('Spoolman-rol niet gevonden', 404);
    if (spool.archived) throw new HttpError('Gearchiveerde rol wordt niet aangemaakt', 400);
    if (spool.remainingWeight == null) throw new HttpError('Rol heeft geen bekend gewicht; stel dat eerst in Spoolman in', 400);
    const bambu = this.bambu();
    const marker = markerFor(spoolmanId);
    const existing = (await bambu.listFilaments()).find((c) => (c.note || '').includes(marker));
    let bambuId = existing?.id;
    if (!bambuId) {
      if (!this.s.pendingCreates.some((p) => p.spoolmanId === spoolmanId)) this.s.pendingCreates.push({ spoolmanId, marker, startedAt: new Date().toISOString() });
      await this.store.save();
      try {
        const r = await bambu.createFilament(bambuCreateBody(spool, marker));
        bambuId = r?.id ?? r?.data?.id;
      } catch (e) {
        if (e.uncertain) {
          const again = (await bambu.listFilaments().catch(() => [])).find((c) => (c.note || '').includes(marker));
          if (!again) throw new HttpError('Onzeker of de Bambu-rol is aangemaakt. Niet opnieuw geprobeerd; controleer de lijst en probeer later opnieuw.', 502);
          bambuId = again.id;
        } else throw e;
      }
      if (!bambuId) {
        bambuId = (await bambu.listFilaments()).find((c) => (c.note || '').includes(marker))?.id;
        if (!bambuId) throw new HttpError('Bambu gaf geen rol-ID terug en de rol is niet terug te vinden', 502);
      }
    }
    this.s.pendingCreates = this.s.pendingCreates.filter((p) => p.spoolmanId !== spoolmanId);
    const link = await this.addLink(spoolmanId, bambuId);
    this.store.log('info', `Bambu-rol ${bambuId} aangemaakt voor Spoolman #${spoolmanId}`);
    await this.store.save();
    return link;
  }

  // Eén ronde. Nooit gelijktijdig.
  async syncOnce(trigger = 'handmatig') {
    if (this.running) return { skipped: true, reason: 'ronde loopt al' };
    this.running = true;
    const result = { trigger, updated: 0, unchanged: 0, paused: 0, failed: 0 };
    let lastSpools = null;
    try {
      let spools, cloud;
      try {
        [spools, cloud] = await Promise.all([this.spoolman().listSpools(), this.bambu().listFilaments()]);
      } catch (e) {
        if (e.status === 401) this.s.bambu.status = 'expired';
        this.store.log('error', `Synchronisatie afgebroken: ${e.message}`);
        result.error = e.message; result.failed = this.s.links.length;
        return result;
      }
      lastSpools = spools;
      const byS = new Map(spools.map((s) => [s.id, s]));
      const byB = new Map(cloud.map((c) => [String(c.id), c]));
      const removed = [];
      for (const link of [...this.s.links]) {
        try {
          const sp = byS.get(link.spoolmanId); const bc = byB.get(String(link.bambuId));
          // Verwijderde Spoolman-rol: de gekoppelde Bambu-rol wordt ook verwijderd (Spoolman is leidend).
          // Bij een lege Spoolman-lijst (gewiste database?) niets verwijderen maar pauzeren.
          if (!sp && spools.length > 0) {
            if (byB.has(String(link.bambuId))) await this.bambu().deleteFilaments([link.bambuId]);
            removed.push(link); continue;
          }
          if (!sp || sp.archived) { this.pause(link, !sp ? 'Spoolman-rol ontbreekt' : 'Spoolman-rol is gearchiveerd'); result.paused++; continue; }
          if (!bc) { this.pause(link, 'Bambu-rol ontbreekt'); result.paused++; continue; }
          if (sp.remainingWeight == null) { this.pause(link, 'Spoolman-rol heeft geen bekend gewicht'); result.paused++; continue; }
          link.paused = false; link.pauseReason = '';
          const target = Math.max(0, Math.round(sp.remainingWeight));
          if (Number(bc.netWeight) === target) { link.lastSyncedGrams = target; link.lastError = ''; result.unchanged++; continue; }
          await this.bambu().updateWeight(link.bambuId, target, bc.filamentName || bc.filamentType || '');
          link.lastSyncedGrams = target; link.lastSyncAt = new Date().toISOString(); link.lastError = '';
          this.store.log('info', `Spoolman #${link.spoolmanId}: ${sp.remainingWeight} g → Bambu ${target} g`);
          result.updated++;
        } catch (e) {
          link.lastError = e.message; result.failed++; // volgende ronde opnieuw met nieuwste Spoolman-stand
          this.store.log('error', `Koppeling Spoolman #${link.spoolmanId}: ${e.message}`);
        }
      }
      if (this.s.settings.autoCreate && spools.length > 0) {
        // Nieuwe Spoolman-rollen automatisch in Bambu aanmaken (max. 5 per ronde); herkenning via [spoolman:ID].
        const linked = new Set(this.s.links.map((l) => l.spoolmanId));
        const fresh = spools.filter((x) => !x.archived && !linked.has(x.id) && x.remainingWeight != null && x.remainingWeight > 0).slice(0, 5);
        for (const sp of fresh) {
          try { await this.createBambuFor(sp.id); result.created = (result.created || 0) + 1; }
          catch (e) { result.failed++; this.store.log('error', `Automatisch aanmaken Spoolman #${sp.id}: ${e.message}`); }
        }
      }
      for (const l of removed) {
        this.s.links = this.s.links.filter((x) => x.id !== l.id);
        this.store.log('info', `Spoolman #${l.spoolmanId} is verwijderd: Bambu-rol ${l.bambuId} verwijderd en koppeling opgeheven`);
        result.unlinked = (result.unlinked || 0) + 1;
      }
    } finally {
      this.running = false;
      this.lastRound = { at: new Date().toISOString(), ...result };
      await this.store.save().catch(() => {});
      await this.publishToHa(lastSpools);
    }
    return result;
  }
  async publishToHa(spools) {
    if (!this.ha.enabled) return;
    try {
      const list = spools || await this.spoolman().listSpools().catch(() => null);
      if (!list) { // Spoolman onbereikbaar: alleen de status bijwerken, rolsensoren niet opruimen
        const st = buildStates({ spools: [], links: this.s.links, bambuStatus: this.s.bambu.status, lastRound: this.lastRound, running: this.running });
        await this.ha.publish({ [STATUS_ID]: st[STATUS_ID] }, { cleanup: false });
        return;
      }
      // Verwijderde/gearchiveerde rollen worden door publish() opgeruimd; ze staan niet meer in 'states'.
      await this.ha.publish(buildStates({ spools: list, links: this.s.links, lowStockGrams: this.s.settings.lowStockGrams, bambuStatus: this.s.bambu.status, lastRound: this.lastRound, running: this.running }));
      this.lastPublishError = '';
    } catch (e) {
      if (this.lastPublishError !== e.message) this.store.log('warn', `Publiceren naar Home Assistant mislukt: ${e.message}`);
      this.lastPublishError = e.message;
    }
  }
  pause(link, reason) {
    if (!link.paused || link.pauseReason !== reason) this.store.log('warn', `Koppeling Spoolman #${link.spoolmanId} gepauzeerd: ${reason}`);
    link.paused = true; link.pauseReason = reason;
  }

  schedule() {
    clearInterval(this.timer); this.timer = null;
    if (!this.s.settings.autoSync || !this.s.settings.spoolmanUrl) return;
    this.timer = setInterval(() => { if (this.s.bambu.token) this.syncOnce('automatisch').catch(() => {}); }, this.s.settings.intervalSeconds * 1000);
    this.timer.unref?.();
  }
  status() {
    return {
      version: VERSION,
      settings: this.s.settings,
      bambu: { status: this.s.bambu.status, email: this.s.bambu.email ? this.s.bambu.email.replace(/^(.).*(@.*)$/, '$1***$2') : '' },
      links: this.s.links, pendingCreates: this.s.pendingCreates,
      lastRound: this.lastRound, running: this.running, activity: this.s.activity.slice(0, 50),
    };
  }
}
