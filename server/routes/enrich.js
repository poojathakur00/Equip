import { Router } from "express";
import { pool } from "../db.js";
import { enrichGroup } from "../gemini.js";

export const router = Router();

router.post("/enrich", async (req, res) => {
  const { manufacturer, model, serials } = req.body;

  if (!manufacturer || !model || !Array.isArray(serials) || serials.length === 0) {
    return res.status(400).json({ error: "manufacturer, model, and serials[] are required" });
  }

  try {
    // 1. Check what's already cached for this group.
    const [groupRes, serialRes] = await Promise.all([
      pool.query(
        `SELECT device_type, serial_format FROM device_groups WHERE manufacturer = $1 AND model = $2`,
        [manufacturer, model]
      ),
      pool.query(
        `SELECT serial_number, manufactured_date, confidence
         FROM serial_cache
         WHERE manufacturer = $1 AND model = $2 AND serial_number = ANY($3)`,
        [manufacturer, model, serials]
      ),
    ]);

    let { device_type = null, serial_format = null } = groupRes.rows[0] ?? {};
    const cachedMap = new Map(serialRes.rows.map((r) => [r.serial_number, r]));
    const uncached = serials.filter((s) => !cachedMap.has(s));

    const tag = `${manufacturer} / ${model}`;
    if (uncached.length === 0 && device_type) {
      console.log(`[cache hit]  ${tag} (${serials.length} serials)`);
    } else {
      console.log(`[gemini]     ${tag} — ${uncached.length} uncached / ${serials.length} total`);
    }

    // 2. Call Gemini only for serials not in cache (or if device_type is unknown).
    if (uncached.length > 0 || !device_type) {
      const apiKey = process.env.GEMINI_API_KEY;
      const result = await enrichGroup(apiKey, manufacturer, model, uncached.length > 0 ? uncached : serials, serial_format);

      device_type = result.device_type || device_type || "Unknown";
      serial_format = result.serial_format || serial_format || "";

      // Upsert group metadata.
      await pool.query(
        `INSERT INTO device_groups (manufacturer, model, device_type, serial_format)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (manufacturer, model)
         DO UPDATE SET device_type = EXCLUDED.device_type, serial_format = EXCLUDED.serial_format`,
        [manufacturer, model, device_type, serial_format]
      );

      // Cache each new serial.
      for (const s of result.serials ?? []) {
        const sn = String(s.serial_number).trim();
        const row = {
          serial_number: sn,
          manufactured_date: s.manufactured_date || "",
          confidence: s.confidence || "low",
        };
        cachedMap.set(sn, row);
        await pool.query(
          `INSERT INTO serial_cache (manufacturer, model, serial_number, manufactured_date, confidence)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (manufacturer, model, serial_number) DO NOTHING`,
          [manufacturer, model, sn, row.manufactured_date, row.confidence]
        );
      }
    }

    // 3. Build response for every requested serial.
    const resultSerials = serials.map((sn) => {
      const hit = cachedMap.get(sn);
      return {
        serial_number: sn,
        manufactured_date: hit?.manufactured_date ?? "",
        confidence: hit?.confidence ?? "low",
      };
    });

    res.json({ device_type: device_type ?? "Unknown", serials: resultSerials });
  } catch (e) {
    console.error(`[enrich] ${manufacturer} / ${model}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});
