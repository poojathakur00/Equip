// Calls the backend /api/enrich endpoint. Same interface as the old enrichGroup
// in gemini.js so pipeline.js needs no structural changes.
export async function enrichGroup(manufacturer, model, serials, signal) {
  const res = await fetch("/api/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manufacturer, model, serials }),
    signal,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Server ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const bySerial = new Map();
  for (const s of data.serials ?? []) {
    bySerial.set(String(s.serial_number).trim(), {
      manufactured_date: s.manufactured_date || "",
      confidence: s.confidence || "low",
    });
  }
  return { device_type: data.device_type || "Unknown", bySerial };
}
