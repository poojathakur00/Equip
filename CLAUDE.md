# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev:full   # Vite (port 5173) + Express server (port 3001) concurrently
npm run dev        # frontend only
npm run server:dev # backend only (node --watch)
npm run build      # production build
```

Requires a `.env` file — see `.env.example`. Key vars: `GEMINI_API_KEY`, `DATABASE_URL`.

## Architecture

React/Vite frontend + Node/Express backend + Postgres.
Gemini API key lives server-side only; the browser never sees it.

**Data flow:**

```
CSV upload → parse (csv.js) → normalize manufacturers (normalize.js)
  → group by (manufacturer, model) (pipeline.js)
  → one Gemini call per group, concurrency=4 (gemini.js)
  → merge device_type + manufactured_date back onto rows
  → sort by manufactured_date, export CSV
```

**Frontend `src/lib/`:**

- `csv.js` — PapaParse wrapper. Tolerant header aliasing (`serial number`, `serialnumber`, etc. → `serial_number`). Export sorts rows by `manufactured_date` ascending (empty dates last).
- `normalize.js` — Deterministic, no-AI manufacturer canonicalization. Two-pass: whitespace-clean alias check first, then legal-suffix stripping + title-case + alias check. The `ALIASES` map is the only hand-maintained part; add entries there when two raw spellings must merge.
- `api.js` — Thin fetch wrapper for `POST /api/enrich`. Same interface as the old `gemini.js` `enrichGroup` so `pipeline.js` is unchanged structurally.
- `pipeline.js` — `buildGroups()` deduplicates serials within a group. `runPool()` is a concurrency pool (default cap 4). `enrichRows(rows, opts)` is the orchestrator — mutates a copy, not the original rows.

**Backend `server/`:**

- `index.js` — Express entry point. Runs `migrate()` on startup, mounts `/api` router.
- `db.js` — `pg.Pool` singleton via `DATABASE_URL`.
- `migrate.js` — `CREATE TABLE IF NOT EXISTS` for `device_groups` and `serial_cache`.
- `gemini.js` — Server-side Gemini call. Extended schema adds `serial_format` (NL description of the serial encoding). Cached `serial_format` is passed as grounding on subsequent calls for the same group.
- `routes/enrich.js` — `POST /api/enrich` handler. Cache logic: check `serial_cache` for each serial and `device_groups` for the group; call Gemini only for cache misses; upsert results.

**Grouping key:** `"${normalizedManufacturer}||${model}"` — one Gemini call per group because `device_type` and serial format are identical across all units of the same model.

**Progress reporting:** `onProgress({done, total, label})` fires after each group in `finally`, so errors don't stall progress.

**Vite proxy:** `/api` → `http://localhost:3001` in dev, so frontend and backend run on different ports without CORS issues.
