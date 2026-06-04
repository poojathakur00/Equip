import { useState, useMemo, useRef } from "react";
import { parseCsv, toCsv, downloadCsv } from "./lib/csv.js";
import { normalizeManufacturer } from "./lib/normalize.js";
import { buildGroups, enrichRows } from "./lib/pipeline.js";

const STAGES = {
  IDLE: "idle",
  LOADED: "loaded",
  RUNNING: "running",
  DONE: "done",
};

export default function App() {
  const [rows, setRows] = useState([]);
  const [enriched, setEnriched] = useState([]);
  const [stage, setStage] = useState(STAGES.IDLE);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [errors, setErrors] = useState([]);
  const [fileName, setFileName] = useState("");
  const abortRef = useRef(null);

  // Preview of how raw manufacturers collapse after normalization.
  const normalizationPreview = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const canon = normalizeManufacturer(r.manufacturer);
      if (!map.has(canon)) map.set(canon, new Set());
      map.get(canon).add(r.manufacturer);
    }
    return [...map.entries()]
      .map(([canon, raws]) => ({ canon, raws: [...raws] }))
      .sort((a, b) => a.canon.localeCompare(b.canon));
  }, [rows]);

  const groupCount = useMemo(
    () => (rows.length ? buildGroups(rows).length : 0),
    [rows]
  );

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const parsed = await parseCsv(file);
    setRows(parsed);
    setEnriched([]);
    setErrors([]);
    setStage(STAGES.LOADED);
  }

  async function handleRun() {
    setStage(STAGES.RUNNING);
    setProgress({ done: 0, total: groupCount, label: "" });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await enrichRows(rows, {
        concurrency: 4,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setEnriched(result.rows);
      setErrors(result.errors);
      setStage(STAGES.DONE);
    } catch (e) {
      if (e.name !== "AbortError") {
        setErrors([{ group: "fatal", message: e.message }]);
      }
      setStage(STAGES.LOADED);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setStage(STAGES.LOADED);
  }

  function handleDownload() {
    downloadCsv(toCsv(enriched));
  }

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="shell">
      <header className="masthead">
        <div className="logo">◧</div>
        <div>
          <h1>Equipment Enrichment</h1>
          <p className="sub">
            Normalize · dedupe · decode serials &amp; classify with Gemini
          </p>
        </div>
      </header>

      <section className="panel">


        <label className="field">
          <span className="label">Equipment CSV</span>
          <input type="file" accept=".csv" onChange={handleFile} />
          {fileName && <span className="hint">Loaded: {fileName}</span>}
        </label>
      </section>

      {rows.length > 0 && (
        <section className="panel">
          <div className="stat-row">
            <Stat n={rows.length} label="rows" />
            <Stat n={normalizationPreview.length} label="manufacturers" />
            <Stat n={groupCount} label="unique model groups" />
            <Stat n={groupCount} label="Gemini calls" />
          </div>

          <details className="norm" open>
            <summary>Manufacturer normalization</summary>
            <ul>
              {normalizationPreview.map((g) => (
                <li key={g.canon}>
                  <strong>{g.canon}</strong>
                  {g.raws.length > 1 || g.raws[0] !== g.canon ? (
                    <span className="raws"> ← {g.raws.join(", ")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {stage === STAGES.LOADED && (
        <button className="primary" onClick={handleRun}>
          Enrich {groupCount} groups
        </button>
      )}

      {stage === STAGES.RUNNING && (
        <section className="panel">
          <div className="progress-head">
            <span>
              {progress.done} / {progress.total} groups
            </span>
            <button className="ghost" onClick={handleCancel}>
              Cancel
            </button>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="hint mono">{progress.label}</p>
        </section>
      )}

      {errors.length > 0 && (
        <section className="panel errors">
          <strong>{errors.length} group(s) had errors</strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i} className="mono">
                {e.group}: {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stage === STAGES.DONE && enriched.length > 0 && (
        <section className="panel">
          <div className="progress-head">
            <strong>Enriched {enriched.length} rows</strong>
            <button className="primary small" onClick={handleDownload}>
              ↓ Download CSV
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>manufacturer</th>
                  <th>model</th>
                  <th>serial_number</th>
                  <th>manufactured_date</th>
                  <th>device_type</th>
                </tr>
              </thead>
              <tbody>
                {enriched.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r.manufacturer}</td>
                    <td>{r.model}</td>
                    <td className="mono">{r.serial_number}</td>
                    <td className="mono">{r.manufactured_date || "—"}</td>
                    <td>{r.device_type || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {enriched.length > 50 && (
              <p className="hint">Showing first 50 of {enriched.length} rows.</p>
            )}
          </div>
        </section>
      )}

      {stage === STAGES.DONE && enriched.length > 0 && (
        <DeviceTypePieChart rows={enriched} />
      )}
    </div>
  );
}

function Stat({ n, label }) {
  return (
    <div className="stat">
      <span className="stat-n">{n}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

// Curated palette that reads well on the dark background.
const PALETTE = [
  "#3ddc97", "#5b9cf6", "#f97316", "#a78bfa", "#fb7185",
  "#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#94a3b8",
];

function DeviceTypePieChart({ rows }) {
  // Tally counts per device_type.
  const slices = useMemo(() => {
    const counts = new Map();
    for (const r of rows) {
      const t = r.device_type || "Unknown";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const total = rows.length;
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count], i) => ({
        label,
        count,
        pct: (count / total) * 100,
        color: PALETTE[i % PALETTE.length],
      }));
  }, [rows]);

  // Build SVG arc paths from slices.
  const R = 90;
  const CX = 110;
  const CY = 110;
  let cumAngle = -Math.PI / 2; // start at 12 o'clock

  function polarToXY(angle, r) {
    return [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];
  }

  const paths = slices.map((slice) => {
    const sweep = (slice.pct / 100) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += sweep;
    const endAngle = cumAngle;
    const largeArc = sweep > Math.PI ? 1 : 0;
    const [x1, y1] = polarToXY(startAngle, R);
    const [x2, y2] = polarToXY(endAngle, R);
    const d =
      slices.length === 1
        ? `M ${CX} ${CY} m -${R} 0 a ${R} ${R} 0 1 1 ${2 * R} 0 a ${R} ${R} 0 1 1 -${2 * R} 0`
        : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return { ...slice, d };
  });

  return (
    <section className="panel pie-panel">
      <strong className="pie-title">Device Type Distribution</strong>
      <div className="pie-layout">
        <svg
          viewBox="0 0 220 220"
          className="pie-svg"
          aria-label="Device type distribution pie chart"
        >
          {paths.map((p) => (
            <path
              key={p.label}
              d={p.d}
              fill={p.color}
              stroke="var(--panel)"
              strokeWidth="2"
            >
              <title>{p.label}: {p.pct.toFixed(1)}%</title>
            </path>
          ))}
          {/* donut hole */}
          <circle cx={CX} cy={CY} r={46} fill="var(--panel)" />
          <text
            x={CX}
            y={CY - 6}
            textAnchor="middle"
            fill="var(--ink)"
            fontSize="13"
            fontFamily="IBM Plex Sans, sans-serif"
            fontWeight="600"
          >
            {rows.length}
          </text>
          <text
            x={CX}
            y={CY + 10}
            textAnchor="middle"
            fill="var(--muted)"
            fontSize="9.5"
            fontFamily="IBM Plex Sans, sans-serif"
          >
            devices
          </text>
        </svg>

        <ul className="pie-legend">
          {paths.map((p) => (
            <li key={p.label} className="pie-legend-item">
              <span className="pie-swatch" style={{ background: p.color }} />
              <span className="pie-legend-label">{p.label}</span>
              <span className="pie-legend-pct">{p.pct.toFixed(1)}%</span>
              <span className="pie-legend-count">({p.count})</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
