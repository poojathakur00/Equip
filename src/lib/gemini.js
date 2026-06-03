// Gemini enrichment.
//
// Core idea: we DO NOT hardcode serial-number decoding rules. Instead we
// hand Gemini the canonical manufacturer, the model, and the list of
// serial numbers for one (manufacturer, model) group, and ask it to:
//   - classify the device_type (one value for the whole group), and
//   - decode each serial number into a manufactured_date using that
//     manufacturer's documented serial format.
//
// We force structured output with responseMimeType + responseSchema so
// the result is parseable JSON, never prose.

const MODEL = "gemini-3.5-flash";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    device_type: {
      type: "string",
      description:
        "Concise medical device category for this manufacturer+model, e.g. 'Patient Monitor', 'Infusion Pump', 'Hospital Bed', 'Blood Pressure Monitor'. Use 'Unknown' if not determinable.",
    },
    serials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          serial_number: { type: "string" },
          manufactured_date: {
            type: "string",
            description:
              "Manufacture date decoded from the serial number. Prefer YYYY-MM, else YYYY. Empty string if the serial cannot be decoded.",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
        },
        required: ["serial_number", "manufactured_date", "confidence"],
      },
    },
  },
  required: ["device_type", "serials"],
};

function buildPrompt(manufacturer, model, serials) {
  return `You are a biomedical equipment data specialist.

Manufacturer: ${manufacturer}
Model: ${model}

TASK 1 — Device type:
Identify the category of this medical device based on the manufacturer and model.

TASK 2 — Manufacture date from serial number:
For EACH serial number below, decode the manufacture date using ${manufacturer}'s
documented serial-number format/manual for this product line. Many manufacturers
encode the year/month (sometimes day) as specific characters or positions in the
serial. Apply the real format for this manufacturer — do not guess randomly. 
If a serial does not match a known format, return an empty manufactured_date and
confidence "low". Never fabricate a precise date you cannot justify.

Serial numbers:
${serials.map((s) => `- ${s}`).join("\n")}

Return JSON only, matching the provided schema. Every input serial must appear
exactly once in "serials".`;
}

async function callGemini(apiKey, manufacturer, model, serials, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(manufacturer, model, serials) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(text);
}

// Small retry wrapper for transient errors / rate limits.
async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e.name === "AbortError") throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

// Enrich one (manufacturer, model) group. Returns a Map serial -> {date, conf}
// plus the group's device_type.
export async function enrichGroup(apiKey, manufacturer, model, serials, signal) {
  const result = await withRetry(() =>
    callGemini(apiKey, manufacturer, model, serials, signal)
  );
  const bySerial = new Map();
  for (const s of result.serials || []) {
    bySerial.set(String(s.serial_number).trim(), {
      manufactured_date: s.manufactured_date || "",
      confidence: s.confidence || "low",
    });
  }
  return { device_type: result.device_type || "Unknown", bySerial };
}
