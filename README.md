# Equipment Data Enrichment

A React tool that enriches hospital equipment CSVs with two fields:

- **`manufactured_date`** — decoded from the `serial_number` using each
  manufacturer's serial-number format (via Gemini, **not** hardcoded rules).
- **`device_type`** — the medical-device category for each manufacturer+model
  (via Gemini).

Input columns: `manufacturer`, `model`, `serial_number`
Output columns: the input three **plus** `manufactured_date`, `device_type`.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints, then:

1. Paste your **Gemini API key** (get one at https://aistudio.google.com/apikey).
2. Upload your CSV.
3. Review the manufacturer-normalization preview.
4. Click **Enrich** and download the result.

The key never leaves the browser except in the direct call to Google's API.

## How it works

```
Upload CSV
   └─ parse (PapaParse, tolerant header aliasing)
        └─ normalize manufacturer names   (src/lib/normalize.js)
             └─ group by unique (manufacturer, model)   (src/lib/pipeline.js)
                  └─ one Gemini call per group           (src/lib/gemini.js)
                       ├─ device_type   (per group)
                       └─ manufactured_date (per serial, decoded by Gemini)
                  └─ merge results back onto every row
        └─ export CSV (5 columns)
```

### Why group by (manufacturer, model)?

`device_type` is identical for every unit of the same model, and the serial
format is the same across a manufacturer's line — so we send one batched
request per unique model group (≈55 calls for the sample 801-row file) instead
of one per row. Calls run with a concurrency cap of 4 and automatic retry.

### Normalization (`src/lib/normalize.js`)

Deterministic and cheap — no AI. It trims, collapses whitespace, strips legal
suffixes (`INC`, `CORP`, `LLC`, …), title-cases, and applies a small alias map
for brands that collide (`HILL ROM`/`Hillrom`, `PHILIPS`/`Philips`,
`GE HEALTHCARE`, etc.). On the sample data this collapses 25 raw names → 23
canonical brands. Add a new collision? One line in `ALIASES`.

### Serial decoding (`src/lib/gemini.js`)

No per-manufacturer regex. Each group's request gives Gemini the canonical
manufacturer, the model, and the list of serials, and asks it to decode dates
using that manufacturer's documented format. Output is forced to structured
JSON via `responseSchema`, and each serial gets a `confidence` flag. Serials
that don't match a known format return an empty date rather than a fabricated
one (temperature 0).

## Files

| File | Responsibility |
|------|----------------|
| `src/App.jsx` | UI: upload, normalization preview, progress, results, download |
| `src/lib/csv.js` | parse + export (PapaParse) |
| `src/lib/normalize.js` | manufacturer name canonicalization |
| `src/lib/gemini.js` | Gemini call, prompt, JSON schema, retry |
| `src/lib/pipeline.js` | grouping, concurrency pool, merge-back |

## Notes / trade-offs

- **Accuracy depends on Gemini's knowledge** of each manufacturer's serial
  scheme. The `confidence` field and empty-on-failure behavior keep it honest;
  for production you'd spot-check low-confidence rows.
- Switch models by changing `MODEL` in `gemini.js` (e.g. to a more capable
  model for higher accuracy).
- All processing is client-side; no backend.
