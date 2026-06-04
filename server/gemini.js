const MODEL = "gemini-3.5-flash";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    device_type: {
      type: "string",
      description:
        "Concise medical device category, e.g. 'Patient Monitor', 'Infusion Pump'. Use 'Unknown' if not determinable.",
    },
    serial_format: {
      type: "string",
      description:
        "Natural language description of how this manufacturer encodes the manufacture date in the serial number, e.g. 'characters 3-4 are last two digits of year (YY), characters 5-6 are week number (01-52)'. Empty string if unknown.",
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
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["serial_number", "manufactured_date", "confidence"],
      },
    },
  },
  required: ["device_type", "serial_format", "serials"],
};

function buildPrompt(manufacturer, model, serials, cachedFormat) {
  return `You are a biomedical equipment data specialist.

Manufacturer: ${manufacturer}
Model: ${model}
${cachedFormat ? `\nKnown serial format for this manufacturer/model:\n${cachedFormat}\n` : ""}
TASK 1 — Device type:
Identify the category of this medical device based on the manufacturer and model.

TASK 2 — Serial format:
${
  cachedFormat
    ? "Confirm or correct the known serial format above."
    : `Describe how ${manufacturer} encodes the manufacture date in serial numbers for this product line. Be specific about character positions and encoding. Empty string if unknown.`
}

TASK 3 — Manufacture date from serial number:
For EACH serial number below, decode the manufacture date.${cachedFormat ? " Use the known format above as grounding." : ""}
Apply the real documented format — do not guess. If a serial does not match a known format, return an empty manufactured_date and confidence "low".

Serial numbers:
${serials.map((s) => `- ${s}`).join("\n")}

Return JSON only. Every input serial must appear exactly once in "serials".`;
}

async function callGemini(apiKey, manufacturer, model, serials, cachedFormat = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildPrompt(manufacturer, model, serials, cachedFormat) }],
      },
    ],
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
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(text);
}

export async function enrichGroup(apiKey, manufacturer, model, serials, cachedFormat = null) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await callGemini(apiKey, manufacturer, model, serials, cachedFormat);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}
