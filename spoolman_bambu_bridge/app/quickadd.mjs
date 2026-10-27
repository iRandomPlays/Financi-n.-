// Snel een rol toevoegen: zoekt of maakt leverancier en filament in Spoolman en maakt de rol aan.
const DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2, PVA: 1.23 };

export class QuickAddError extends Error { constructor(m) { super(m); this.status = 400; } }

export function validate(i) {
  const s = (v) => String(v ?? '').trim();
  const out = { brand: s(i.brand), material: s(i.material).toUpperCase(), name: s(i.name), colorHex: s(i.colorHex).replace('#', '').toUpperCase(), comment: s(i.comment).slice(0, 200) };
  if (!out.brand) throw new QuickAddError('Merk ontbreekt');
  if (!out.material) throw new QuickAddError('Materiaal ontbreekt');
  if (!out.name) throw new QuickAddError('Naam ontbreekt');
  if (!/^[0-9A-F]{6}$/.test(out.colorHex)) throw new QuickAddError('Kleurcode moet 6 hexcijfers zijn (bijv. 161616)');
  out.location = s(i.location).slice(0, 40); // Spoolman-veld "Locatie" (bijv. Vincent of Ine); wordt niet naar Bambu gestuurd
  out.weight = Number(i.weight);
  if (!Number.isFinite(out.weight) || out.weight < 1 || out.weight > 10000) throw new QuickAddError('Gewicht moet tussen 1 en 10000 g liggen');
  for (const [k, lo, hi, label] of [['nozzle', 100, 400, 'Nozzletemperatuur'], ['bed', 0, 150, 'Bedtemperatuur']]) {
    if (i[k] === '' || i[k] == null) { out[k] = null; continue; }
    const n = Math.round(Number(i[k]));
    if (!Number.isFinite(n) || n < lo || n > hi) throw new QuickAddError(`${label} moet tussen ${lo} en ${hi} °C liggen`);
    out[k] = n;
  }
  return out;
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export async function quickAdd(sm, input) {
  const v = validate(input);
  const vendors = await sm.listVendors();
  let vendor = vendors.find((x) => same(x.name, v.brand));
  let newVendor = false;
  if (!vendor) { vendor = await sm.createVendor({ name: v.brand }); newVendor = true; }
  const filaments = newVendor ? [] : await sm.listFilaments();
  let fil = filaments.find((f) => f.vendor?.id === vendor.id && same(f.material, v.material) && same(f.name, v.name) && String(f.color_hex || '').toUpperCase() === v.colorHex);
  const reused = !!fil;
  if (!fil) {
    fil = await sm.createFilament({
      name: v.name, vendor_id: vendor.id, material: v.material, density: DENSITY[v.material] || 1.24, diameter: 1.75,
      weight: v.weight, color_hex: v.colorHex,
      ...(v.nozzle != null && { settings_extruder_temp: v.nozzle }), ...(v.bed != null && { settings_bed_temp: v.bed }),
    });
  }
  const spool = await sm.createSpool({ filament_id: fil.id, initial_weight: v.weight, used_weight: 0, ...(v.location && { location: v.location }), ...(v.comment && { comment: v.comment }) });
  return { spoolId: spool.id, filamentId: fil.id, filamentReused: reused, vendorCreated: newVendor, name: `${v.brand} ${v.name}`, weight: v.weight, location: v.location };
}

export async function catalog(sm) {
  const [vendors, filaments] = await Promise.all([sm.listVendors(), sm.listFilaments()]);
  return {
    brands: vendors.map((x) => x.name).sort(),
    filaments: filaments.map((f) => ({ brand: f.vendor?.name || '', material: f.material || '', name: f.name || '', colorHex: String(f.color_hex || '').toUpperCase(), nozzle: f.settings_extruder_temp ?? null, bed: f.settings_bed_temp ?? null })),
  };
}
