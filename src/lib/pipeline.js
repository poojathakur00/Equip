import { normalizeManufacturer } from "./normalize.js";
import { enrichGroup } from "./api.js";

// Group rows by canonical (manufacturer, model). Returns array of:
//   { key, manufacturer, model, serials:Set<string>, rows:[idx...] }
export function buildGroups(rows) {
  const groups = new Map();
  rows.forEach((row, idx) => {
    const manufacturer = normalizeManufacturer(row.manufacturer);
    row._manufacturer_normalized = manufacturer;
    const key = `${manufacturer}||${row.model}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        manufacturer,
        model: row.model,
        serials: new Set(),
        rowIdx: [],
      });
    }
    const g = groups.get(key);
    g.serials.add(row.serial_number);
    g.rowIdx.push(idx);
  });
  return [...groups.values()];
}

// Run async tasks with a concurrency cap.
async function runPool(items, limit, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const [i, item] = queue.shift();
      await worker(item, i);
    }
  });
  await Promise.all(runners);
}

// Main pipeline. Mutates a copy of rows with manufactured_date + device_type.
// onProgress({done, total, label}) reports per-group progress.
export async function enrichRows(rows, { concurrency = 4, onProgress, signal } = {}) {
  const out = rows.map((r) => ({
    ...r,
    manufacturer: normalizeManufacturer(r.manufacturer),
    manufactured_date: "",
    device_type: "",
  }));

  const groups = buildGroups(rows);
  const total = groups.length;
  let done = 0;
  const errors = [];

  await runPool(groups, concurrency, async (group) => {
    try {
      const serials = [...group.serials];
      const { device_type, bySerial } = await enrichGroup(
        group.manufacturer,
        group.model,
        serials,
        signal
      );
      for (const idx of group.rowIdx) {
        out[idx].device_type = device_type;
        const hit = bySerial.get(out[idx].serial_number);
        out[idx].manufactured_date = hit ? hit.manufactured_date : "";
      }
    } catch (e) {
      errors.push({ group: group.key, message: e.message });
    } finally {
      done += 1;
      onProgress?.({ done, total, label: `${group.manufacturer} ${group.model}` });
    }
  });

  return { rows: out, groups, errors };
}
