// Zoekt het Bambu-filamentprofiel (het "Type" in Handy en Studio) bij een rol, op merk, materiaal en productnaam.
// Bron: Bambu's profielenbibliotheek (filamentSettings). Is er geen duidelijke match, dan blijft het type leeg.
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

export function listProfiles(config) {
  const arr = Array.isArray(config?.filamentSettings) ? config.filamentSettings : [];
  return arr
    .filter((p) => p && p.filamentId && p.filamentVendor && p.filamentName)
    .map((p) => ({ vendor: String(p.filamentVendor), type: String(p.filamentType || ''), name: String(p.filamentName), id: String(p.filamentId), support: !!p.isSupport }));
}

// Profielen die al in gebruik zijn op bestaande rollen in je eigen Bambu-account (daar staan ook profielen die niet in de
// openbare bibliotheek zitten, zoals SUNLU PLA C210 en C220). Dubbele (zelfde ID en naam) worden samengevoegd.
export function deriveProfiles(rolls) {
  const seen = new Set(); const out = [];
  for (const r of Array.isArray(rolls) ? rolls : []) {
    if (!r?.filamentId || !r.filamentVendor || !r.filamentName) continue;
    const key = `${r.filamentId}|${norm(r.filamentName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ vendor: String(r.filamentVendor), type: String(r.filamentType || ''), name: String(r.filamentName), id: String(r.filamentId), support: !!r.isSupport });
  }
  return out;
}

// spool: {brand, material, name}. De naam bevat vaak productnaam + kleur ("PLA C220 Zwart").
export function matchProfile(profiles, spool) {
  const brand = norm(spool.brand); const material = norm(spool.material); const name = norm(spool.name);
  if (!brand) return null;
  const sameVendor = profiles.filter((p) => norm(p.vendor) === brand);
  if (!sameVendor.length) return null;
  const sameType = material ? sameVendor.filter((p) => norm(p.type) === material) : sameVendor;
  // Alleen profielen waarvan de naam (genormaliseerd) in de rolnaam voorkomt; het langste profiel wint ("PLA Matte" boven "PLA").
  const hits = sameType.filter((p) => name.includes(norm(p.name))).sort((a, b) => norm(b.name).length - norm(a.name).length);
  if (!hits.length) return null; // geen gok: liever een leeg type dan een verkeerd profiel
  const best = hits[0];
  const tie = hits.filter((p) => norm(p.name).length === norm(best.name).length && p.id !== best.id);
  return tie.length ? null : { id: best.id, vendor: best.vendor, type: best.type, name: best.name };
}
