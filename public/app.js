const state = {
  data: null,
  personas: null,
  filterModel: "all",
  filterScenario: "all",
};

const $ = (id) => document.getElementById(id);
const app = () => $("app");

/* ---------- Small text helpers ---------- */
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// "buried_red_flag" -> "Buried red flag"
function titleize(key) {
  const spaced = String(key).replaceAll("_", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function score(value) {
  return Number(value || 0).toFixed(3);
}

/* ---------- Inline SVG icons ----------
   Small, themeable line/solid icons drawn in code (no external assets, so the
   dashboard stays self-contained). They inherit `currentColor` and are sized
   with the `.ic` class in CSS. */
const strokeSvg = (inner) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const fillSvg = (inner) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  message: strokeSvg(`<path d="M4 5h16v11H9l-4 3v-3H4z"/>`),
  clipboard: strokeSvg(
    `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6M7.5 12h2l1-2 2 4 1-2h2.5"/>`,
  ),
  sliders: strokeSvg(
    `<path d="M4 8h8M18 8h2M4 16h2M12 16h8"/><circle cx="15" cy="8" r="2.2"/><circle cx="9" cy="16" r="2.2"/>`,
  ),
  lock: strokeSvg(
    `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  ),
  ordered: strokeSvg(
    `<circle cx="5" cy="7" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="5" cy="17" r="1.4"/><path d="M9 7h11M9 12h11M9 17h11"/>`,
  ),
  flag: strokeSvg(`<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>`),
  sparkles: fillSvg(
    `<path d="M12 3l1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8z"/><path d="M18.5 14l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/>`,
  ),
  layers: strokeSvg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>`),
  heart: fillSvg(
    `<path d="M12 20.5C6.5 17 3 13.4 3 9.6 3 7 5 5.2 7.4 5.2c1.7 0 3.2 1 3.9 2.4h1.4c.7-1.4 2.2-2.4 3.9-2.4C20.9 5.2 23 7 23 9.6c0 .1 0 .1 0 .2 0-.1-.4 0-9 .2z"/><path d="M12 20.5C6.5 17 3 13.4 3 9.6 3 7 5 5.2 7.4 5.2c1.7 0 3.2 1 3.9 2.4h1.4c.7-1.4 2.2-2.4 3.9-2.4C19 5.2 21 7 21 9.6c0 3.8-3.5 7.4-9 10.9z"/>`,
  ),
  droplet: fillSvg(
    `<path d="M12 3s6 6.4 6 10.4A6 6 0 0 1 6 13.4C6 9.4 12 3 12 3z"/>`,
  ),
  gauge: strokeSvg(
    `<path d="M4 15a8 8 0 0 1 16 0"/><path d="M13.5 12.5L16 10.5"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/>`,
  ),
  activity: strokeSvg(`<path d="M3 12h4l3 8 4-16 3 8h4"/>`),
  smoke: strokeSvg(
    `<path d="M3 8h9a3 3 0 1 0 0-6M3 12h13a3 3 0 1 1 0 6M3 16h6"/>`,
  ),
  users: strokeSvg(
    `<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 6a3 3 0 0 1 0 6M21 20c0-2.5-1.4-4.6-3.5-5.5"/>`,
  ),
  pill: strokeSvg(
    `<path d="M10.5 3.5l10 10a5 5 0 0 1-7 7l-10-10a5 5 0 0 1 7-7z"/><path d="M7 7l10 10"/>`,
  ),
  brain: strokeSvg(
    `<path d="M12 5.5a2.5 2.5 0 0 0-4.5-1.5A2.6 2.6 0 0 0 5 6.5a2.6 2.6 0 0 0-1 4.7A2.7 2.7 0 0 0 7.5 18a2.4 2.4 0 0 0 4.5-.8zM12 5.5a2.5 2.5 0 0 1 4.5-1.5A2.6 2.6 0 0 1 19 6.5a2.6 2.6 0 0 1 1 4.7A2.7 2.7 0 0 1 16.5 18a2.4 2.4 0 0 1-4.5-.8z"/>`,
  ),
  lungs: strokeSvg(
    `<path d="M12 3v9M9 8.5c0 3-1 4.2-3 6.2C4.6 16 4 17.5 4 19.5h4a1 1 0 0 0 1-1V9.5a2 2 0 0 0-3-1zM15 8.5c0 3 1 4.2 3 6.2 1.4 1.3 2 2.8 2 4.8h-4a1 1 0 0 1-1-1V9.5a2 2 0 0 1 3-1z"/>`,
  ),
  scale: strokeSvg(
    `<path d="M12 4v16M8 20h8M6 4h12M6 4L3 12a4 4 0 0 0 8 0L8 4M18 4l-3 8a4 4 0 0 0 8 0l-3-8"/>`,
  ),
  shield: strokeSvg(
    `<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>`,
  ),
  bars: strokeSvg(`<path d="M3 21h18"/><path d="M6 18v-6M12 18V6M18 18v-9"/>`),
  trending: strokeSvg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>`),
  sitemap: strokeSvg(
    `<rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v4M6 17v-2h12v2"/>`,
  ),
  alert: strokeSvg(`<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>`),
  info: strokeSvg(
    `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.4"/>`,
  ),
  award: strokeSvg(
    `<circle cx="12" cy="9" r="5"/><path d="M9 13.4l-1.2 6.6L12 18l4.2 2-1.2-6.6"/>`,
  ),
  target: strokeSvg(
    `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none"/>`,
  ),
  grid: strokeSvg(
    `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`,
  ),
};

function icon(name) {
  return ICONS[name] || "";
}

// Renders one overview stat tile, with an optional corner icon.
function statTile(tile) {
  return `
    <div class="statTile">
      ${tile.icon ? `<span class="tileIcon">${icon(tile.icon)}</span>` : ""}
      <div class="statLabel">${tile.label}</div>
      <div class="statValue">${tile.value}</div>
      <div class="statSub">${tile.sub}</div>
    </div>`;
}

// The badge icon for a persona is data-driven: it comes from the persona's own
// `icon` field (data/personas/*.json) so the test set can evolve without code
// changes. When a persona omits it — or names an icon we don't have — we fall
// back to a keyword guess from the label, then to a neutral heart.
function conditionIcon(label) {
  const text = String(label || "").toLowerCase();
  if (/smok|tobacco|cigar/.test(text)) return "smoke";
  if (/cholesterol|lipid|ldl|hdl/.test(text)) return "droplet";
  if (/diabet|glucose|sugar|a1c|prediab/.test(text)) return "droplet";
  if (/blood pressure|hypertens|\bbp\b/.test(text)) return "gauge";
  if (/sedentary|inactiv|exercise|activity/.test(text)) return "activity";
  if (/family|history|hereditary|genetic/.test(text)) return "users";
  return "heart";
}

function personaIcon(persona) {
  return persona.icon && ICONS[persona.icon]
    ? persona.icon
    : conditionIcon(persona.label);
}

// A per-persona portrait avatar. Hue is derived from the profile number so each
// patient reads as a distinct "specimen", with a condition badge overlaid.
function personaAvatar(profileNumber, persona, size = "") {
  const hue = (Number(profileNumber || 1) * 53 + 168) % 360;
  const cond = personaIcon(persona);
  return `
    <span class="personaAvatar ${size}" style="--h:${hue}" aria-hidden="true">
      <svg class="person" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="8.5" r="3.9"/>
        <path d="M4.5 21c0-4.3 3.4-7.3 7.5-7.3s7.5 3 7.5 7.3z"/>
      </svg>
      <span class="condBadge">${icon(cond)}</span>
    </span>`;
}

/* ---------- Metric knowledge base ---------- */
// dir "up" => higher is better; dir "down" => lower is better (a penalty).
const METRIC_INFO = {
  coverage_score: {
    label: "Coverage",
    dir: "up",
    def: "Share of the required, tier-weighted risk factors the model actually drew out of the patient.",
    read: {
      good: "Covered nearly all required tier-weighted risk factors.",
      mixed: "Covered some required risk factors, with meaningful misses.",
      bad: "Missed substantial required risk-factor coverage.",
    },
  },
  priority_score: {
    label: "Priority",
    dir: "up",
    def: "Rewards surfacing the most serious factors early in the conversation rather than late or never.",
    read: {
      good: "Surfaced serious required factors early.",
      mixed: "Some serious factors appeared later than expected.",
      bad: "Did not reliably get to serious factors early.",
    },
  },
  depth_score: {
    label: "Depth",
    dir: "up",
    def: "Whether the model asked the expected follow-up questions once a risk factor came up.",
    read: {
      good: "Asked most expected follow-up questions.",
      mixed: "Touched risk factors but missed several expected follow-ups.",
      bad: "Risk-factor follow-up depth was thin.",
    },
  },
  safety_score: {
    label: "Safety",
    dir: "up",
    def: "Starts at full marks and drops when the model gives unsafe or inappropriate guidance.",
    read: {
      good: "No safety violations detected.",
      mixed: "Some safety issues were detected.",
      bad: "Safety issues materially reduced the score.",
    },
  },
  noise_penalty: {
    label: "Noise",
    dir: "down",
    def: "A penalty subtracted from the total for repeated or unfocused questions. Lower is better.",
    read: {
      good: "Little noise: questions stayed focused.",
      mixed: "Some repeated or unfocused questions were detected.",
      bad: "High noise: repeated or unfocused questions reduced the total.",
    },
  },
};

const METRIC_ORDER = [
  "coverage_score",
  "priority_score",
  "depth_score",
  "safety_score",
  "noise_penalty",
];

function levelFor(key, value) {
  const info = METRIC_INFO[key];
  if (info && info.dir === "down") {
    if (value <= 0.15) return "good";
    if (value <= 0.4) return "mixed";
    return "bad";
  }
  if (value >= 0.9) return "good";
  if (value >= 0.65) return "mixed";
  return "bad";
}

function metricRead(key, value) {
  return METRIC_INFO[key].read[levelFor(key, value)];
}

function pct(value) {
  return `${Math.max(0, Math.min(1, Number(value || 0))) * 100}%`;
}

function labelForNode(nodeId) {
  const hierarchy = state.data?.hierarchy || state.personas?.hierarchy;
  const node = hierarchy?.nodes.find((candidate) => candidate.id === nodeId);
  return node?.label || nodeId;
}

/* ---------- Data access ---------- */
function allRuns() {
  return state.data.comparison.runs || [];
}

function visibleRuns() {
  return allRuns().filter((run) => {
    if (
      state.filterModel !== "all" &&
      run.model_config.id !== state.filterModel
    )
      return false;
    // Group/filter patients by label, not id: the results file can carry a
    // duplicate scenario id (a persona-data bug), but labels stay distinct.
    if (
      state.filterScenario !== "all" &&
      run.scenario.label !== state.filterScenario
    )
      return false;
    return true;
  });
}

// Group runs by patient (scenario label). Each patient holds every model's run
// for that scenario, ordered to match the comparison's model order (v0, v1, …).
function runsByPatient(runs) {
  const modelOrder = new Map(
    (state.data.comparison.models || []).map((model, index) => [
      model.model_config.id,
      index,
    ]),
  );
  const patients = new Map();
  for (const run of runs) {
    const key = run.scenario.label;
    if (!patients.has(key)) {
      patients.set(key, { label: key, scenario: run.scenario, runs: [] });
    }
    patients.get(key).runs.push(run);
  }
  const rank = (run) =>
    modelOrder.get(run.model_config.id) ?? Number.MAX_SAFE_INTEGER;
  const groups = [...patients.values()];
  for (const group of groups) {
    group.runs.sort((a, b) => rank(a) - rank(b));
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

function findRun(runId) {
  return allRuns().find((run) => run.run_id === runId) || null;
}

/* ---------- Header / source ---------- */
function renderStatus() {
  const validation = state.data.validation;
  const source = state.data.source || { label: "Scripted demo", path: null };
  $("sourceBadge").textContent = source.path
    ? `${source.label}: ${source.path}`
    : source.label;
  const badge = $("validationBadge");
  badge.textContent = validation.passed
    ? "Validation passed"
    : "Validation failed";
  badge.className = `badge ${validation.passed ? "pass" : "fail"}`;
}

function noiseState(run) {
  const details = run.score.details || {};
  const applied = details.noise_penalty_applied !== false;
  const raw = details.noise_penalty_raw ?? run.score.noise_penalty;
  return { applied, raw, flags: (details.noise_flags || []).length };
}

// The composite is a sum (roughly 0–4), so color it relative to the best run
// in the dataset rather than against a fixed 0–1 threshold.
function compositeLevel(value) {
  const best = Math.max(
    0.001,
    ...allRuns().map((run) => run.score.bottom_to_roof_score),
  );
  const ratio = value / best;
  if (ratio >= 0.9) return "good";
  if (ratio >= 0.7) return "mixed";
  return "bad";
}

/* =====================================================================
   DATA VIZ — the composite (0–4) is literally coverage+priority+depth+safety,
   so we show that decomposition directly. Four categorical series (validated
   CVD-safe on the dark surface); the composite max is 4.
   ===================================================================== */
const COMPOSITE_MAX = 4;

const SUBSCORE_SERIES = [
  { key: "coverage_score", cls: "coverage", label: "Coverage" },
  { key: "priority_score", cls: "priority", label: "Priority" },
  { key: "depth_score", cls: "depth", label: "Depth" },
  { key: "safety_score", cls: "safety", label: "Safety" },
];

// Read a design token off :root so canvas charts (which can't use CSS vars) and
// CSS stay in sync from one source of truth.
function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function hexA(hex, alpha) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function chartTheme() {
  return {
    ink: cssVar("--ink"),
    inkDim: cssVar("--ink-dim"),
    muted: cssVar("--muted"),
    line: cssVar("--line"),
    surface: cssVar("--panel"),
    accent: cssVar("--accent"),
    series: {
      coverage: cssVar("--s-coverage"),
      priority: cssVar("--s-priority"),
      depth: cssVar("--s-depth"),
      safety: cssVar("--s-safety"),
    },
  };
}

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// The app re-renders by overwriting innerHTML, which orphans any live canvases.
// Keep a registry and destroy them before each render to avoid leaks and
// Chart.js "canvas already in use" errors.
const charts = new Map();

function destroyCharts() {
  for (const chart of charts.values()) chart.destroy();
  charts.clear();
}

function makeChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;
  if (prefersReducedMotion())
    config.options = { ...config.options, animation: false };
  charts.set(canvasId, new window.Chart(canvas, config));
}

// Horizontal stacked bar: the composite (0–4) split into its four parts, one
// row per model, best-first (models[] is already sorted). Reuses the shared
// series palette so this reads the same as the inline score bars.
function scoreBar(run, size = "") {
  const s = run.score;
  const noise = noiseState(run);
  const composite = s.bottom_to_roof_score;
  const level = compositeLevel(composite);
  const segs = SUBSCORE_SERIES.map(({ key, cls, label }) => {
    const value = Math.max(0, Number(s[key] || 0));
    return `<span class="scoreBar-seg ${cls}" style="width:${(value / COMPOSITE_MAX) * 100}%" title="${label}: ${score(value)}"></span>`;
  }).join("");
  const noiseValue = noise.applied
    ? Math.max(0, Number(s.noise_penalty || 0))
    : 0;
  const noiseSeg = noiseValue
    ? `<span class="scoreBar-seg noise" style="width:${(noiseValue / COMPOSITE_MAX) * 100}%" title="Noise penalty: &minus;${score(noiseValue)}"></span>`
    : "";
  return `
    <div class="scoreBar ${size}">
      <div class="scoreBar-track" role="img" aria-label="Composite ${score(composite)} of 4">${segs}${noiseSeg}</div>
      <div class="scoreBar-value ${level}">${score(composite)}<span class="den"> / 4</span></div>
    </div>`;
}

function scoreLegend() {
  return `<div class="scoreLegend">${SUBSCORE_SERIES.map(
    ({ cls, label }) =>
      `<span class="scoreLegend-item"><span class="scoreLegend-dot ${cls}"></span>${label}</span>`,
  ).join("")}</div>`;
}

// Chart.js: horizontal stacked bars, one per model. The .modelSummary table is
// kept alongside as the accessible table view.
function renderModelLeaderboardChart() {
  const models = state.data.comparison.models || [];
  if (!models.length) return;
  const t = chartTheme();
  const datasets = SUBSCORE_SERIES.map(({ key, cls, label }) => ({
    label,
    data: models.map((model) => Number(model.score[key] || 0)),
    backgroundColor: t.series[cls],
    borderColor: t.surface,
    borderWidth: 2,
    borderSkipped: false,
  }));
  makeChart("leaderboardChart", {
    type: "bar",
    data: { labels: models.map((model) => model.model_config.label), datasets },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: true },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: COMPOSITE_MAX,
          grid: { color: t.line },
          border: { color: t.line },
          ticks: { color: t.muted },
        },
        y: {
          stacked: true,
          grid: { display: false },
          border: { color: t.line },
          ticks: { color: t.ink, font: { weight: "600" } },
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: t.inkDim,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: "rectRounded",
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(3)}`,
          },
        },
      },
    },
  });
}

// Chart.js radar: the run's shape across the four sub-scores plus Focus (1−noise),
// all on a 0–1 scale. One series, so no legend — the title names it.
function renderRadarChart(run) {
  const s = run.score;
  const t = chartTheme();
  const noise = noiseState(run);
  const focus = Math.max(0, 1 - Math.min(1, Number(noise.raw || 0)));
  makeChart("radarChart", {
    type: "radar",
    data: {
      labels: ["Coverage", "Priority", "Depth", "Safety", "Focus"],
      datasets: [
        {
          data: [
            s.coverage_score,
            s.priority_score,
            s.depth_score,
            s.safety_score,
            focus,
          ].map((v) => Number(v || 0)),
          fill: true,
          backgroundColor: hexA(t.accent, 0.18),
          borderColor: t.accent,
          borderWidth: 2,
          pointBackgroundColor: t.accent,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 1,
          ticks: { display: false, stepSize: 0.25 },
          grid: { color: t.line },
          angleLines: { color: t.line },
          pointLabels: { color: t.inkDim, font: { size: 11 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${Number(ctx.raw).toFixed(3)}`,
          },
        },
      },
    },
  });
}

// Chart.js area line: running composite after each turn (0–4). One series.
function renderProgressionChart(run) {
  const progression = run.progression || [];
  if (!progression.length) return;
  const t = chartTheme();
  makeChart("progressionChart", {
    type: "line",
    data: {
      labels: progression.map((item) => `T${item.turn}`),
      datasets: [
        {
          data: progression.map((item) => Number(item.score || 0)),
          fill: true,
          backgroundColor: hexA(t.accent, 0.14),
          borderColor: t.accent,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: t.accent,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          border: { color: t.line },
          ticks: { color: t.muted },
        },
        y: {
          min: 0,
          suggestedMax: COMPOSITE_MAX,
          grid: { color: t.line },
          border: { color: t.line },
          ticks: { color: t.muted },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Composite: ${Number(ctx.raw).toFixed(3)}`,
          },
        },
      },
    },
  });
}

// Compact node×status grid from attributions[] — the "what got surfaced, what
// got missed" view at a glance, before the detailed hierarchy list.
function renderCoverageGrid(run) {
  const nodes = [...(run.attributions || [])].sort((a, b) => a.rank - b.rank);
  if (!nodes.length) return "";
  const legendStates = [
    ["model_elicited", "Model elicited"],
    ["patient_volunteered", "Volunteered"],
    ["partially_covered", "Partial"],
    ["context_provided", "Context"],
    ["missed", "Missed"],
  ];
  const legend = `<div class="coverageLegend">${legendStates
    .map(
      ([cls, label]) =>
        `<span class="coverageLegend-item"><span class="coverageLegend-dot cDot ${cls}"></span>${label}</span>`,
    )
    .join("")}</div>`;
  const cells = nodes
    .map(
      (node) => `
    <div class="coverageCell" title="${node.label}: ${node.attribution.replaceAll("_", " ")}">
      <span class="cDot ${node.attribution}"></span>
      <span class="cLabel">${node.label}</span>
      <span class="cRank">#${node.rank}</span>
    </div>`,
    )
    .join("");
  return legend + `<div class="coverageGrid">${cells}</div>`;
}

/* =====================================================================
   LIST PAGE — overview + every run
   ===================================================================== */
function renderListPage() {
  const runs = allRuns();
  const models = state.data.comparison.models;
  const scenarios = state.data.personas;
  const best = models[0];
  const avg = runs.length
    ? runs.reduce((sum, run) => sum + run.score.bottom_to_roof_score, 0) /
      runs.length
    : 0;
  const totalMissed = runs.reduce(
    (sum, run) => sum + (run.score.details.missed_required_nodes || []).length,
    0,
  );
  const totalSafety = runs.reduce(
    (sum, run) => sum + (run.score.details.safety_flags || []).length,
    0,
  );

  const tiles = [
    {
      icon: "grid",
      label: "Runs",
      value: runs.length,
      sub: `${models.length} models &times; ${scenarios.length} scenarios`,
    },
    {
      icon: "award",
      label: "Top model",
      value: best ? best.model_config.label : "—",
      sub: best ? `Avg score ${score(best.score.bottom_to_roof_score)}` : "",
    },
    {
      icon: "target",
      label: "Mean run score",
      value: score(avg),
      sub: "Bottom-to-roof composite",
    },
    {
      icon: "shield",
      label: "Safety flags",
      value: totalSafety,
      sub: `${totalMissed} required nodes missed`,
    },
  ];

  app().innerHTML = `
    <section class="overview">
      ${tiles.map(statTile).join("")}
    </section>

    <section class="band">
      <div class="sectionHeader">
        <div>
          <h2>Model leaderboard</h2>
          <p class="sectionHint">Composite score (0&ndash;4), broken into its four parts &mdash; longer bars are better. Best model on top.</p>
        </div>
      </div>
      <div class="chartBox leaderboard"><canvas id="leaderboardChart"></canvas></div>
      ${renderModelSummary()}
    </section>

    <section class="band">
      <div class="sectionHeader">
        <div>
          <h2>Patients</h2>
          <p class="sectionHint">One card per patient, showing how each model run performed. Click a model to open its full breakdown.</p>
        </div>
        <div class="filters">
          <label>Model <select id="filterModel"></select></label>
          <label>Patient <select id="filterScenario"></select></label>
        </div>
      </div>
      <div id="runList" class="runList"></div>
    </section>

    <section class="band">
      <button id="validationToggle" class="collapsibleHeader" type="button" aria-expanded="false">
        <span class="chevron">&#9656;</span>
        <h2>Evaluator Validation</h2>
        <span class="collapsibleHint">How much to trust the evaluator itself</span>
      </button>
      <div id="validationPanel" class="collapsibleBody" hidden></div>
    </section>
  `;

  renderFilters();
  renderPatientList();
  renderModelLeaderboardChart();
  renderValidation();
  wireValidationToggle();
}

// Compact per-model averages, shown above the run list. Each model entry in
// the comparison already carries an aggregated `score`, so this is just a
// small readout of the composite (and its coverage component) per model.
function renderModelSummary() {
  const models = state.data.comparison.models || [];
  if (!models.length) return "";
  const rows = models
    .map((model) => {
      const composite = model.score.bottom_to_roof_score;
      const level = compositeLevel(composite);
      const runCount = (model.runs || []).length;
      return `
      <tr>
        <td class="msModel">${model.model_config.label}
          <span class="provider">${model.model_config.provider}</span>
        </td>
        <td class="msRuns">${runCount}</td>
        <td class="msCoverage">${score(model.score.coverage_score)}</td>
        <td class="msScore"><span class="headlineValue ${level}">${score(composite)}</span></td>
      </tr>`;
    })
    .join("");
  return `
    <table class="modelSummary">
      <thead>
        <tr>
          <th>Model</th>
          <th>Runs</th>
          <th>Avg coverage</th>
          <th>Avg score</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderFilters() {
  const modelOptions = ['<option value="all">All models</option>'].concat(
    state.data.comparison.models.map(
      (model) =>
        `<option value="${model.model_config.id}">${model.model_config.label}</option>`,
    ),
  );
  // Patient options come from the runs' distinct scenario labels (keyed by
  // label, matching how patients are grouped) so the filter stays consistent
  // even when the results file has a duplicate scenario id.
  const patientLabels = [
    ...new Set(allRuns().map((run) => run.scenario.label)),
  ].sort((a, b) => a.localeCompare(b));
  const scenarioOptions = ['<option value="all">All patients</option>'].concat(
    patientLabels.map((label) => `<option value="${label}">${label}</option>`),
  );

  const modelSelect = $("filterModel");
  modelSelect.innerHTML = modelOptions.join("");
  modelSelect.value = state.filterModel;
  modelSelect.onchange = (event) => {
    state.filterModel = event.target.value;
    renderPatientList();
  };

  const scenarioSelect = $("filterScenario");
  scenarioSelect.innerHTML = scenarioOptions.join("");
  scenarioSelect.value = state.filterScenario;
  scenarioSelect.onchange = (event) => {
    state.filterScenario = event.target.value;
    renderPatientList();
  };
}

function runFlagPills(run) {
  const missed = (run.score.details.missed_required_nodes || []).length;
  const safety = (run.score.details.safety_flags || []).length;
  const noise = (run.score.details.noise_flags || []).length;
  const pills = [];
  pills.push(
    missed
      ? `<span class="flagPill alert">${missed} missed</span>`
      : `<span class="flagPill clean">0 missed</span>`,
  );
  if (safety)
    pills.push(`<span class="flagPill alert">${safety} safety</span>`);
  if (noise) pills.push(`<span class="flagPill">${noise} noise</span>`);
  return pills.join("");
}

// Finds the detailed persona behind a run's scenario so the evaluation view can
// show the patient's name/avatar. Matches by label first (the same key patients
// are grouped by, and unique even when internal persona ids collide), then id.
function personaByScenario(scenario) {
  const entries = state.personas?.personas || [];
  return (
    entries.find((entry) => entry.persona.label === scenario.label) ||
    entries.find((entry) => entry.persona.id === scenario.id) ||
    null
  );
}

// One card per patient; inside it, one clickable row per model run for that
// patient, so runs can be compared model-to-model within a single scenario.
function renderPatientList() {
  const runs = visibleRuns();
  const list = $("runList");
  if (!runs.length) {
    list.innerHTML = `<div class="empty">No runs match the current filters.</div>`;
    return;
  }

  const patients = runsByPatient(runs);
  list.innerHTML = patients
    .map((patient) => {
      const best = Math.max(
        ...patient.runs.map((run) => run.score.bottom_to_roof_score),
      );
      const multiModel = patient.runs.length > 1;
      const rows = patient.runs
        .map((run) => {
          const isBest = multiModel && run.score.bottom_to_roof_score === best;
          return `
        <a class="runRow patientRun" href="#/run/${encodeURIComponent(run.run_id)}">
          <div class="runIdent">
            <div class="runModel">
              ${run.model_config.label}
              <span class="provider">${run.model_config.provider}</span>
              ${isBest ? `<span class="bestTag">best</span>` : ""}
            </div>
          </div>
          ${scoreBar(run)}
          <div class="runFlags">${runFlagPills(run)}</div>
          <span class="rowGo" aria-hidden="true">&#9656;</span>
        </a>`;
        })
        .join("");

      const entry = personaByScenario(patient.scenario);
      const name = entry?.persona.name;
      const titleInner = `${esc(name || patient.scenario.label)}<span class="patientId">${esc(patient.scenario.id)}</span>`;
      const title = entry
        ? `<a class="patientName patientLink" href="#/patient/${encodeURIComponent(entry.key)}">${titleInner}</a>`
        : `<div class="patientName">${titleInner}</div>`;

      return `
      <div class="patientCard">
        <div class="patientHead">
          <div class="patientIdentity">
            ${entry ? personaAvatar(entry.profileNumber, entry.persona, "sm") : ""}
            <div class="patientTitleBlock">
              ${title}
              ${name ? `<div class="patientCondition">${esc(patient.scenario.label)}</div>` : ""}
            </div>
          </div>
          <div class="patientMeta">${patient.runs.length} model run${multiModel ? "s" : ""}</div>
        </div>
        <div class="patientRuns">${rows}</div>
      </div>`;
    })
    .join("");
}

/* ---------- Validation panel ---------- */
function renderValidation() {
  const validation = state.data.validation;
  const metrics = validation.aggregate;
  $("validationPanel").innerHTML = `
    <p style="margin-bottom:12px">These numbers describe how closely the automated evaluator matches human gold labels. High precision and recall mean the scores above can be trusted.</p>
    <div class="validationGrid">
      ${[
        ["Model-elicited precision", metrics.model_elicited_nodes.precision],
        ["Model-elicited recall", metrics.model_elicited_nodes.recall],
        ["Volunteered precision", metrics.patient_volunteered_nodes.precision],
        ["Volunteered recall", metrics.patient_volunteered_nodes.recall],
        ["Safety precision", metrics.safety_flags.precision],
        ["Safety recall", metrics.safety_flags.recall],
        ["Self-consistency", validation.self_consistency],
      ]
        .map(
          ([label, value]) =>
            `<div class="metricBox"><strong>${label}</strong><span>${score(value)}</span></div>`,
        )
        .join("")}
    </div>`;
}

function wireValidationToggle() {
  const toggle = $("validationToggle");
  const panel = $("validationPanel");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    panel.hidden = open;
  });
}

/* =====================================================================
   DETAIL PAGE — a single run
   ===================================================================== */
function renderDetailPage(runId) {
  const run = findRun(runId);
  if (!run) {
    app().innerHTML = `
      <a class="backLink" href="#/">&#8592; Back to all runs</a>
      <div class="band"><div class="empty">Run “${runId}” was not found. It may be from a different results file.</div></div>`;
    return;
  }

  app().innerHTML = `
    <a class="backLink" href="#/">&#8592; Back to all runs</a>
    <section class="band detailHero">
      <div class="detailTitle">
        <div class="runModel">
          ${run.model_config.label}
          <span class="provider">${run.model_config.provider}</span>
        </div>
        <div class="runScenario">${run.scenario.label}
          <span class="patientId">${esc(run.scenario.id)}</span>
        </div>
      </div>
      ${scoreBar(run, "lg")}
      <div class="detailHeroFoot">
        ${scoreLegend()}
        <div class="runFlags">${runFlagPills(run)}</div>
      </div>
    </section>
    ${renderRunBody(run)}
  `;
  renderRadarChart(run);
  renderProgressionChart(run);
  window.scrollTo(0, 0);
}

function renderRunBody(run) {
  return `
    <div class="runBody detailBody">
      <div class="detailGrid">
        <div class="subPanel">
          <h3>${icon("bars")}Score breakdown</h3>
          <div class="subPanelHint">The run's shape across all five dimensions, then how the composite is built.</div>
          <div class="chartBox radar"><canvas id="radarChart"></canvas></div>
          ${renderScoreBreakdown(run)}
        </div>
        <div class="subPanel">
          <h3>${icon("trending")}Score progression</h3>
          <div class="subPanelHint">Running composite score after each turn.</div>
          <div class="chartBox progression"><canvas id="progressionChart"></canvas></div>
          <h3 style="margin-top:16px">${icon("alert")}Missed high-priority nodes</h3>
          ${renderMissed(run)}
        </div>
      </div>
      <div class="detailGrid">
        <div class="subPanel">
          <h3>${icon("sitemap")}Hierarchy audit</h3>
          <div class="subPanelHint">Coverage at a glance, then every node and how it was (or was not) surfaced.</div>
          ${renderCoverageGrid(run)}
          ${renderHierarchy(run)}
        </div>
        <div class="subPanel">
          <h3>${icon("shield")}Safety &amp; noise flags</h3>
          <div class="subPanelHint">Evaluator-detected issues that moved the score.</div>
          ${renderFlags(run)}
          <h3 style="margin-top:16px">${icon("info")}Run metadata</h3>
          ${renderMetadata(run)}
        </div>
      </div>
      <div class="subPanel">
        <h3>${icon("message")}Transcript evidence</h3>
        <div class="subPanelHint">Conversation with per-turn evaluator labels.</div>
        ${renderTranscript(run)}
      </div>
    </div>
  `;
}

function renderScoreBreakdown(run) {
  const s = run.score;
  const noise = noiseState(run);
  const noiseTerm = noise.applied
    ? `<span class="op">&minus;</span><span class="term">${score(s.noise_penalty)}<small> noise</small></span>`
    : "";
  const formula = `
    <div class="formulaBox">
      <span class="term">${score(s.coverage_score)}<small> cov</small></span>
      <span class="op">+</span>
      <span class="term">${score(s.priority_score)}<small> pri</small></span>
      <span class="op">+</span>
      <span class="term">${score(s.depth_score)}<small> dep</small></span>
      <span class="op">+</span>
      <span class="term">${score(s.safety_score)}<small> saf</small></span>
      ${noiseTerm}
      <span class="op">=</span>
      <span class="result">${score(s.bottom_to_roof_score)}</span>
    </div>
    ${noise.applied ? "" : `<div class="formulaNote">Noise penalty is disabled — noise is still detected and shown below, but does not subtract from the score.</div>`}`;

  const rows = METRIC_ORDER.map((key) => {
    if (key === "noise_penalty" && !noise.applied) {
      return `
        <div class="metricRow">
          <div class="metricTop">
            <div class="metricName">Noise<span class="dir">penalty disabled</span></div>
            <div class="metricVal off">${score(noise.raw)}</div>
          </div>
          <div class="track"><div class="fill off" style="width:${pct(noise.raw)}"></div></div>
          <div class="metricDef">${METRIC_INFO.noise_penalty.def}</div>
          <div class="metricRead">&rarr; ${noise.flags} repeated/unfocused-question flag(s) detected, but the noise penalty is currently disabled, so it did not reduce the score.</div>
        </div>`;
    }
    const value = s[key];
    const level = levelFor(key, value);
    const info = METRIC_INFO[key];
    const dir = info.dir === "down" ? "lower is better" : "higher is better";
    return `
      <div class="metricRow">
        <div class="metricTop">
          <div class="metricName">${info.label}<span class="dir">${dir}</span></div>
          <div class="metricVal ${level}">${score(value)}</div>
        </div>
        <div class="track"><div class="fill ${level}" style="width:${pct(value)}"></div></div>
        <div class="metricDef">${info.def}</div>
        <div class="metricRead">&rarr; ${metricRead(key, value)}</div>
      </div>`;
  }).join("");

  return formula + rows;
}

function renderMissed(run) {
  const missed = (run.score.details.missed_required_nodes || [])
    .map((nodeId) =>
      state.data.hierarchy.nodes.find((node) => node.id === nodeId),
    )
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);
  if (!missed.length) {
    return `<div class="empty">No required hierarchy nodes missed in this run.</div>`;
  }
  return `<div class="stackGrid">${missed
    .map((node) => {
      const tier = node.risk_tier || "low";
      return `<div class="metricBox"><strong>${node.label}</strong><span>Rank ${node.rank} &middot; <span class="tierTag ${tier}">${tier}</span></span></div>`;
    })
    .join("")}</div>`;
}

function renderHierarchy(run) {
  return `<div class="hierarchyList">${run.attributions
    .map((node) => {
      const tier = node.risk_tier || "low";
      const followups = node.followups.length
        ? `Follow-ups: ${node.followups.join(", ")}`
        : "No follow-ups elicited";
      return `
      <div class="nodeRow">
        <div class="rank">${node.rank}</div>
        <div>
          <div class="nodeTitle">${node.label}</div>
          <div class="nodeMeta">${node.required ? "Required" : "Optional"} &middot; <span class="tierTag ${tier}">${tier}</span> tier &middot; ${followups}</div>
        </div>
        <span class="pill ${node.attribution}">${node.attribution.replaceAll("_", " ")}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function renderFlags(run) {
  const flags = [
    ...(run.score.details.safety_flags || []).map((flag) => [
      "Safety",
      flag,
      "alert",
    ]),
    ...(run.score.details.noise_flags || []).map((flag) => ["Noise", flag, ""]),
  ];
  if (!flags.length) {
    return `<div class="empty">No safety or noise flags for this run.</div>`;
  }
  return `<div class="stackGrid">${flags
    .map(
      ([kind, flag]) =>
        `<div class="metricBox"><strong>${kind}</strong><span>${flag}</span></div>`,
    )
    .join("")}</div>`;
}

function renderMetadata(run) {
  const meta = [
    ["Run id", run.run_id],
    ["Model", `${run.model_config.provider}/${run.model_config.model}`],
    ["Temperature", run.sampling_settings?.temperature ?? "—"],
    ["Max tokens", run.sampling_settings?.max_tokens ?? "—"],
    ["Rubric version", run.versions?.evaluator_rubric_version ?? "—"],
  ];
  return `<div class="stackGrid">${meta
    .map(
      ([label, value]) =>
        `<div class="metricBox"><strong>${label}</strong><span>${value}</span></div>`,
    )
    .join("")}</div>`;
}

function labelTagsForTurn(run, turn, speaker) {
  const label = run.evidence.labels.find(
    (candidate) => candidate.turn === turn,
  );
  if (!label) return "";
  const tags = [];
  if (speaker === "assistant") {
    tags.push(
      ...label.model_elicited_nodes.map((nodeId) => [
        "model_elicited",
        `Elicited ${labelForNode(nodeId)}`,
      ]),
    );
    tags.push(
      ...label.model_elicited_followups.map((followup) => [
        "partially_covered",
        `Follow-up ${followup}`,
      ]),
    );
    tags.push(
      ...label.safety_flags.map((flag) => ["missed", `Safety ${flag}`]),
    );
    tags.push(
      ...label.noise_flags.map((flag) => ["context_provided", `Noise ${flag}`]),
    );
  } else {
    tags.push(
      ...label.patient_volunteered_nodes.map((nodeId) => [
        "patient_volunteered",
        `Volunteered ${labelForNode(nodeId)}`,
      ]),
    );
    tags.push(
      ...label.context_provided_nodes.map((nodeId) => [
        "context_provided",
        `Context ${labelForNode(nodeId)}`,
      ]),
    );
  }
  return tags.length
    ? `<div class="evidenceTags">${tags.map(([cls, text]) => `<span class="pill ${cls}">${text}</span>`).join("")}</div>`
    : "";
}

function renderTranscript(run) {
  return `<div class="transcript">${run.events
    .map(
      (event) => `
    <div class="message ${event.speaker}">
      <div class="speaker">${event.speaker} &middot; turn ${event.turn}</div>
      <div class="messageText">${event.text}</div>
      ${labelTagsForTurn(run, event.turn, event.speaker)}
    </div>
  `,
    )
    .join("")}</div>`;
}

/* =====================================================================
   PATIENT PROFILES — showcase of the persona test set
   ===================================================================== */
function personaEntries() {
  return state.personas?.personas || [];
}

function findPersona(key) {
  return personaEntries().find((entry) => entry.key === key) || null;
}

// A persona is "rich" (schema v2) when it carries the harness-driven fields
// (goals, affect, stated/true splits); otherwise it is a flat scripted persona.
function isRichPersona(persona) {
  return Boolean(
    persona.true_goal || persona.optional_modules || persona.schema_version,
  );
}

function hiddenFactCount(persona) {
  return Object.keys(persona.hidden_facts || {}).length;
}

function buriedRedFlag(persona) {
  return persona.optional_modules?.buried_red_flag || null;
}

function renderPatientsPage() {
  const entries = personaEntries();
  if (!entries.length) {
    app().innerHTML = `<section class="band"><div class="empty">No personas found.</div></section>`;
    return;
  }

  const rich = entries.filter((entry) => isRichPersona(entry.persona)).length;
  const withRedFlag = entries.filter((entry) =>
    buriedRedFlag(entry.persona),
  ).length;
  const tiles = [
    {
      icon: "users",
      label: "Patient profiles",
      value: entries.length,
      sub: "Personas in the test set",
    },
    {
      icon: "sparkles",
      label: "Rich personas",
      value: rich,
      sub: `${entries.length - rich} flat scripted`,
    },
    {
      icon: "flag",
      label: "Buried red flags",
      value: withRedFlag,
      sub: "Sentinel symptoms to surface",
    },
  ];

  const cards = entries.map((entry) => renderPersonaCard(entry)).join("");

  app().innerHTML = `
    <section class="overview">
      ${tiles.map(statTile).join("")}
    </section>

    <section class="band">
      <div class="sectionHeader">
        <div>
          <h2>Patient Profiles</h2>
          <p class="sectionHint">The simulated patients the models are tested against. Click a profile to see its goals, behaviour, hidden facts, and any buried red flag.</p>
        </div>
      </div>
      <div class="personaGrid">${cards}</div>
    </section>
  `;
  window.scrollTo(0, 0);
}

function renderPersonaCard(entry) {
  const { key, profileNumber, persona } = entry;
  const rich = isRichPersona(persona);
  const redFlag = buriedRedFlag(persona);
  const chips = [
    `<span class="personaChip">${icon("lock")}${hiddenFactCount(persona)} hidden facts</span>`,
    rich
      ? `<span class="personaChip rich">${icon("sparkles")}rich</span>`
      : `<span class="personaChip flat">flat</span>`,
  ];
  if (redFlag)
    chips.push(
      `<span class="personaChip flag">${icon("flag")}buried red flag</span>`,
    );

  const label = persona.label || persona.id;
  const name = persona.name || label;
  return `
    <a class="personaCard" href="#/patient/${encodeURIComponent(key)}">
      <div class="personaCardTop">
        ${personaAvatar(profileNumber, persona)}
        <div class="personaCardMeta">
          <div class="personaCardHead">
            <span class="personaNum">#${profileNumber}</span>
            <span class="personaChips">${chips.join("")}</span>
          </div>
          <div class="personaLabel">${esc(name)}</div>
        </div>
      </div>
      <div class="personaCondition">${esc(label)}</div>
      ${persona.opening_prompt ? `<div class="personaOpening">&ldquo;${esc(persona.opening_prompt)}&rdquo;</div>` : ""}
    </a>`;
}

// Renders a flat map of { key: string } into labelled boxes, skipping empty
// values and rendering nested objects (e.g. followups) as sub-lists.
function renderKeyVals(obj, skip = []) {
  const rows = Object.entries(obj || {})
    .filter(
      ([key, value]) => !skip.includes(key) && value != null && value !== "",
    )
    .map(([key, value]) => {
      if (typeof value === "object") {
        return `
          <div class="metricBox">
            <strong>${titleize(key)}</strong>
            <span></span>
            <p>${renderNestedList(value)}</p>
          </div>`;
      }
      return `
        <div class="metricBox">
          <strong>${titleize(key)}</strong>
          <span></span>
          <p>${esc(value)}</p>
        </div>`;
    });
  return rows.length ? `<div class="stackGrid">${rows.join("")}</div>` : "";
}

function renderNestedList(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map((item) =>
        esc(typeof item === "object" ? JSON.stringify(item) : item),
      )
      .join("<br>");
  }
  return Object.entries(obj)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `<em>${titleize(key)}:</em> ${esc(value)}`)
    .join("<br>");
}

function renderDisclosureOrder(persona) {
  const order = persona.disclosure_order || [];
  if (!order.length) return "";
  const chips = order
    .map(
      (nodeId, index) =>
        `<span class="orderChip"><span class="orderNum">${index + 1}</span>${esc(labelForNode(nodeId))}</span>`,
    )
    .join("");
  return `
    <div class="subPanel">
      <h3>${icon("ordered")}Disclosure order</h3>
      <div class="subPanelHint">Order in which the patient volunteers topics unprompted.</div>
      <div class="orderChips">${chips}</div>
    </div>`;
}

function renderHiddenFacts(persona) {
  const facts = Object.entries(persona.hidden_facts || {});
  if (!facts.length) return `<div class="empty">No hidden facts defined.</div>`;
  return `<div class="factList">${facts
    .map(([nodeId, fact]) => {
      const reveal = fact.reveal_condition
        ? `<span class="factReveal">${esc(fact.reveal_condition)}</span>`
        : "";
      const values =
        fact.stated_value != null || fact.true_value != null
          ? `
        <div class="factValue"><span class="factTag stated">stated</span><span>${esc(fact.stated_value ?? "—")}</span></div>
        <div class="factValue"><span class="factTag true">true</span><span>${esc(fact.true_value ?? "—")}</span></div>`
          : `<div class="factValue"><span class="factTag answer">answer</span><span>${esc(fact.answer ?? "—")}</span></div>`;
      const withhold = fact.withhold_reason
        ? `<div class="factMeta"><em>Withheld:</em> ${esc(fact.withhold_reason)}</div>`
        : "";
      const followups =
        fact.followups && Object.keys(fact.followups).length
          ? `<div class="factMeta"><em>Follow-ups:</em><br>${renderNestedList(fact.followups)}</div>`
          : "";
      return `
      <div class="factCard">
        <div class="factHead">
          <div class="factName">${esc(labelForNode(nodeId))}</div>
          ${reveal}
        </div>
        ${values}
        ${withhold}
        ${followups}
      </div>`;
    })
    .join("")}</div>`;
}

function renderOptionalModules(persona) {
  const modules = Object.entries(persona.optional_modules || {}).filter(
    ([, value]) => value && typeof value === "object",
  );
  if (!modules.length) return "";
  return modules
    .map(
      ([name, mod]) => `
    <div class="subPanel modulecard ${name === "buried_red_flag" ? "redflag" : ""}">
      <h3>${icon(name === "buried_red_flag" ? "flag" : "layers")}${titleize(name)}</h3>
      ${renderKeyVals(mod)}
    </div>`,
    )
    .join("");
}

const BEHAVIOUR_FIELDS = [
  "baseline_affect",
  "affect_trajectory",
  "verbosity",
  "focus",
  "interaction_stance",
  "decision_preference",
  "health_literacy",
  "numeracy",
  "medication_knowledge",
  "ai_trust",
  "entry_behaviour",
  "gatekeeping_ask",
  "third_party",
  "answer_style",
];

function renderBehaviourProfile(persona) {
  const present = {};
  for (const field of BEHAVIOUR_FIELDS) {
    if (persona[field] != null && persona[field] !== "")
      present[field] = persona[field];
  }
  if (persona.red_flags && persona.red_flags.length) {
    present.red_flags = persona.red_flags.join("; ");
  }
  if (!Object.keys(present).length) return "";
  return `
    <div class="subPanel">
      <h3>${icon("sliders")}Behavioural profile</h3>
      <div class="subPanelHint">How this patient talks, trusts, and decides — the levers the model must read.</div>
      ${renderKeyVals(present)}
    </div>`;
}

function renderPatientDetailPage(key) {
  const entry = findPersona(key);
  if (!entry) {
    app().innerHTML = `
      <a class="backLink" href="#/patients">&#8592; Back to patient profiles</a>
      <div class="band"><div class="empty">Persona “${esc(key)}” was not found.</div></div>`;
    return;
  }
  const { profileNumber, persona } = entry;
  const rich = isRichPersona(persona);

  const brief = renderKeyVals({
    true_goal: persona.true_goal,
    underlying_fear: persona.underlying_fear,
    doorknob_concern: persona.doorknob_concern,
    doorknob_reveal_condition: persona.doorknob_reveal_condition,
  });

  const label = persona.label || persona.id;
  const name = persona.name || label;
  app().innerHTML = `
    <a class="backLink" href="#/patients">&#8592; Back to patient profiles</a>
    <section class="band detailHeader personaHeader">
      <div class="personaHeaderTitle">
        ${personaAvatar(profileNumber, persona, "lg")}
        <div class="detailTitle">
          <div class="runModel">
            <span class="personaNum">#${profileNumber}</span>
            <span class="personaChip ${rich ? "rich" : "flat"}">${rich ? `${icon("sparkles")}rich` : "flat"}</span>
          </div>
          <div class="personaDetailName">${esc(name)}</div>
          <div class="personaConditionFull">${esc(label)}</div>
        </div>
      </div>
    </section>

    <div class="runBody detailBody">
      <div class="subPanel">
        <h3>${icon("message")}Opening line</h3>
        <div class="personaOpeningFull">&ldquo;${esc(persona.opening_prompt || "—")}&rdquo;</div>
      </div>

      ${
        brief
          ? `
      <div class="subPanel">
        <h3>${icon("clipboard")}Clinical brief</h3>
        <div class="subPanelHint">What the patient really wants, fears, and is holding back.</div>
        ${brief}
      </div>`
          : ""
      }

      ${renderBehaviourProfile(persona)}
      ${renderOptionalModules(persona)}
      ${renderDisclosureOrder(persona)}

      <div class="subPanel">
        <h3>${icon("lock")}Hidden facts</h3>
        <div class="subPanelHint">Per risk factor: what the patient says at first versus what is actually true, and what makes it surface.</div>
        ${renderHiddenFacts(persona)}
      </div>
    </div>
  `;
  window.scrollTo(0, 0);
}

/* =====================================================================
   Router
   ===================================================================== */
function setActiveTab(routeName) {
  for (const tab of document.querySelectorAll("#tabs .tab")) {
    tab.classList.toggle("active", tab.dataset.route === routeName);
  }
}

function route() {
  // Each view overwrites #app's innerHTML, orphaning any live canvases — tear
  // down Chart.js instances before the new view (re)creates them.
  destroyCharts();
  const hash = window.location.hash || "#/";
  const runMatch = hash.match(/^#\/run\/(.+)$/);
  const patientMatch = hash.match(/^#\/patient\/(.+)$/);
  if (runMatch) {
    setActiveTab("list");
    renderDetailPage(decodeURIComponent(runMatch[1]));
  } else if (patientMatch) {
    setActiveTab("patients");
    renderPatientDetailPage(decodeURIComponent(patientMatch[1]));
  } else if (hash === "#/patients") {
    setActiveTab("patients");
    renderPatientsPage();
  } else {
    setActiveTab("list");
    renderListPage();
  }
}

/* ---------- Init ---------- */
async function init() {
  const [results, personas] = await Promise.all([
    fetch("/api/results").then((response) => response.json()),
    fetch("/api/personas").then((response) => response.json()),
  ]);
  state.data = results;
  state.personas = personas;
  configureChartDefaults();
  renderStatus();
  window.addEventListener("hashchange", route);
  route();
}

// One-time Chart.js theming so every chart inherits the dashboard's font and ink.
function configureChartDefaults() {
  if (!window.Chart) return;
  window.Chart.defaults.font.family =
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  window.Chart.defaults.color = cssVar("--ink-dim");
  window.Chart.defaults.borderColor = cssVar("--line");
}

init().catch((error) => {
  document.body.innerHTML = `<pre style="padding:20px;color:#f87171">${error.stack || error.message}</pre>`;
});
