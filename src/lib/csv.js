import Papa from "papaparse";

const COLUMN_ALIASES = {
  manufacturer: "manufacturer",
  model: "model",
  "serial number": "serial_number",
  serial_number: "serial_number",
  serialnumber: "serial_number",
  serial: "serial_number",
};

// Parse a File into normalized row objects: {manufacturer, model, serial_number}
export function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => {
        const key = h.trim().toLowerCase();
        return COLUMN_ALIASES[key] || key;
      },
      complete: (results) => {
        const rows = results.data
          .map((r) => ({
            manufacturer: (r.manufacturer ?? "").trim(),
            model: (r.model ?? "").trim(),
            serial_number: (r.serial_number ?? "").trim(),
          }))
          .filter((r) => r.manufacturer || r.model || r.serial_number);
        resolve(rows);
      },
      error: reject,
    });
  });
}

// Serialize enriched rows back to a CSV string.
// Rows are sorted ascending by manufactured_date; empty dates go last.
export function toCsv(rows) {
  const sorted = [...rows].sort((a, b) => {
    const da = a.manufactured_date ?? "";
    const db = b.manufactured_date ?? "";
    if (!da && !db) return 0;
    if (!da) return 1;   // empty → end
    if (!db) return -1;
    return da.localeCompare(db);
  });
  return Papa.unparse(
    sorted.map((r) => ({
      manufacturer: r.manufacturer,
      model: r.model,
      serial_number: r.serial_number,
      manufactured_date: r.manufactured_date ?? "",
      device_type: r.device_type ?? "",
    })),
    {
      columns: [
        "manufacturer",
        "model",
        "serial_number",
        "manufactured_date",
        "device_type",
      ],
    }
  );
}

export function downloadCsv(csvString, filename = "enriched_equipment.csv") {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
