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

function formatInline(value) {
  return esc(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function formatAssistantText(value) {
  const lines = String(value ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.join(" ")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType || !listItems.length) return;
    blocks.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const nextType = bullet ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push(formatInline((bullet || numbered)[1]));
      continue;
    }

    flushList();
    paragraph.push(formatInline(line));
  }

  flushParagraph();
  flushList();
  return blocks.length ? blocks.join("") : "<p></p>";
}

// "buried_red_flag" -> "Buried red flag"
function titleize(key) {
  const spaced = String(key).replaceAll("_", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function score(value) {
  return Number(value || 0).toFixed(3);
}

function whole(value) {
  return String(Math.round(Number(value || 0)));
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
  coverage_efficiency_score: {
    label: "Efficiency",
    dir: "up",
    def: "Tier-weighted required coverage extracted per 100 assistant words. This is informational and does not change the composite.",
    read: {
      good: "Extracted a lot of weighted coverage for the amount of assistant text used.",
      mixed: "Extracted some coverage, but with moderate assistant verbosity.",
      bad: "Used many assistant words for relatively little weighted coverage.",
    },
  },
};

const METRIC_ORDER = [
  "coverage_score",
  "priority_score",
  "depth_score",
  "coverage_efficiency_score",
];

function levelFor(key, value) {
  if (key === "coverage_efficiency_score") {
    if (value >= 4) return "good";
    if (value >= 2) return "mixed";
    return "bad";
  }
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

function metricPct(key, value) {
  if (key === "coverage_efficiency_score") {
    return `${Math.max(0, Math.min(1, Number(value || 0) / 5)) * 100}%`;
  }
  return pct(value);
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
  const source = state.data.source || { label: "Scripted demo", path: null };
  $("sourceBadge").textContent = source.path
    ? `${source.label}: ${source.path}`
    : source.label;
}

// The composite is a sum (roughly 0–3), so color it relative to the best run
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
   DATA VIZ — the composite (0–3) is literally coverage+priority+depth,
   so we show that decomposition directly. Three categorical series (validated
   CVD-safe on the dark surface); the composite max is 3.
   ===================================================================== */
const COMPOSITE_MAX = 3;

const SUBSCORE_SERIES = [
  { key: "coverage_score", cls: "coverage", label: "Coverage" },
  { key: "priority_score", cls: "priority", label: "Priority" },
  { key: "depth_score", cls: "depth", label: "Depth" },
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

// Horizontal stacked bar: the composite (0–3) split into its three parts, one
// row per model, best-first (models[] is already sorted). Reuses the shared
// series palette so this reads the same as the inline score bars.
function scoreBar(run, size = "") {
  const s = run.score;
  const composite = s.bottom_to_roof_score;
  const level = compositeLevel(composite);
  const segs = SUBSCORE_SERIES.map(({ key, cls, label }) => {
    const value = Math.max(0, Number(s[key] || 0));
    return `<span class="scoreBar-seg ${cls}" style="width:${(value / COMPOSITE_MAX) * 100}%" title="${label}: ${score(value)}"></span>`;
  }).join("");
  return `
    <div class="scoreBar ${size}">
      <div class="scoreBar-track" role="img" aria-label="Composite ${score(composite)} of 3">${segs}</div>
      <div class="scoreBar-value ${level}">${score(composite)}<span class="den"> / 3</span></div>
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
  // Draw each segment's value inside its bar (and the composite total just past
  // the bar end) so the breakdown reads without hovering. Segments too narrow
  // to fit their label are skipped to avoid overlap.
  const segmentLabels = {
    id: "leaderboardSegmentLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px " + window.Chart.defaults.font.family;
      ctx.textBaseline = "middle";
      const totals = models.map(() => 0);
      chart.data.datasets.forEach((dataset, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const value = Number(dataset.data[i] || 0);
          totals[i] += value;
          if (value <= 0) return;
          const width = Math.abs(bar.x - bar.base);
          if (width < 22) return; // too narrow for a legible label
          ctx.fillStyle = t.surface;
          ctx.textAlign = "center";
          ctx.fillText(score(value), (bar.x + bar.base) / 2, bar.y);
        });
      });
      // Composite total, drawn just past the end of each stacked bar.
      const lastMeta = chart.getDatasetMeta(chart.data.datasets.length - 1);
      ctx.fillStyle = t.ink;
      ctx.textAlign = "left";
      ctx.font = "700 11px " + window.Chart.defaults.font.family;
      lastMeta.data.forEach((bar, i) => {
        ctx.fillText(score(totals[i]), bar.x + 6, bar.y);
      });
      ctx.restore();
    },
  };
  makeChart("leaderboardChart", {
    type: "bar",
    plugins: [segmentLabels],
    data: { labels: models.map((model) => model.model_config.label), datasets },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 34 } },
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

// Chart.js radar: the run's shape across the three sub-scores, all on a 0–1
// scale. One series, so no legend — the title names it.
function renderRadarChart(run) {
  const s = run.score;
  const t = chartTheme();
  makeChart("radarChart", {
    type: "radar",
    data: {
      labels: ["Coverage", "Priority", "Depth"],
      datasets: [
        {
          data: [
            s.coverage_score,
            s.priority_score,
            s.depth_score,
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

// Chart.js area line: running composite after each turn (0–3). One series.
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
   STORY-FIRST PAGES — the public-facing narrative layer
   ===================================================================== */
function bestRunOverall() {
  return allRuns()
    .slice()
    .sort(
      (a, b) =>
        Number(b.score?.bottom_to_roof_score || 0) -
        Number(a.score?.bottom_to_roof_score || 0),
    )[0];
}

function demoRun() {
  const redFlag = allRuns().find((run) =>
    (run.score?.details?.safety_flags || []).length,
  );
  return redFlag || bestRunOverall();
}

function strongestMiss(run) {
  const missed = run?.score?.details?.missed_required_nodes || [];
  if (!missed.length) return null;
  return missed
    .map((nodeId) => state.data.hierarchy.nodes.find((node) => node.id === nodeId))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)[0];
}

function renderOverviewPage() {
  const runs = allRuns();
  const models = state.data.comparison.models || [];
  const scenarios = state.data.personas || [];
  const judged = runs.filter((run) => run.truth_match);
  const safety = state.data.comparison?.safety_evaluation;
  const best = bestRunOverall();
  const tiles = [
    {
      icon: "users",
      label: "Simulated patients",
      value: scenarios.length,
      sub: "messy cardiovascular conversations",
    },
    {
      icon: "layers",
      label: "Models compared",
      value: models.length,
      sub: "prompt and model versions",
    },
    {
      icon: "target",
      label: "Evaluation runs",
      value: runs.length,
      sub: "coverage, priority, depth",
    },
    {
      icon: "shield",
      label: "Safety checks",
      value: safety?.versions?.length || 0,
      sub: judged.length ? `${judged.length} ground-truth judgments` : "routing verdicts",
    },
  ];

  app().innerHTML = `
    <section class="storyHero">
      <div class="storyHeroCopy">
        <div class="eyebrow">${icon("activity")} Health AI evaluation harness</div>
        <h1>Health AI can sound helpful while missing the clinical context that matters.</h1>
        <p>CardioNAVIX stress-tests health AI with simulated cardiovascular patients. It checks whether an assistant asks the right questions, uncovers hidden risk factors, matches the patient's true clinical picture, and routes urgent cases safely.</p>
        <div class="heroActions">
          <a class="primaryAction" href="#/demo">${icon("sparkles")}Watch Demo</a>
          <a class="secondaryAction" href="#/try">${icon("message")}Try A Prompt</a>
          <a class="secondaryAction" href="#/results">${icon("bars")}Explore Results</a>
        </div>
      </div>
      <div class="heroEvidence" aria-label="Example score evidence">
        <div class="heroEvidenceTop">
          <span>Current best run</span>
          <strong>${best ? score(best.score.bottom_to_roof_score) : "—"}<small> / 3</small></strong>
        </div>
        ${best ? scoreBar(best, "lg") : ""}
        <div class="heroMiniGrid">
          <div><span>Coverage</span><strong>${best ? score(best.score.coverage_score) : "—"}</strong></div>
          <div><span>Priority</span><strong>${best ? score(best.score.priority_score) : "—"}</strong></div>
          <div><span>Depth</span><strong>${best ? score(best.score.depth_score) : "—"}</strong></div>
        </div>
        <p>Scores come from transcript evidence, not self-reported model confidence.</p>
      </div>
    </section>

    <section class="overview">
      ${tiles.map(statTile).join("")}
    </section>

    <section class="storyBand">
      <div class="storySectionHead">
        <h2>What CardioNAVIX Measures</h2>
        <p>The project turns one-off demos into repeatable patient-case evaluation.</p>
      </div>
      <div class="valueGrid">
        <div class="valueTile">${icon("target")}<h3>Risk elicitation</h3><p>Did the assistant surface required cardiovascular risk factors instead of staying at generic advice?</p></div>
        <div class="valueTile">${icon("trending")}<h3>Clinical priority</h3><p>Did serious factors come up early enough to change the conversation?</p></div>
        <div class="valueTile">${icon("ordered")}<h3>Follow-up depth</h3><p>When a risk factor appeared, did the assistant ask the expected clarifying questions?</p></div>
        <div class="valueTile">${icon("clipboard")}<h3>Ground truth match</h3><p>Did the conversation reach the patient's real underlying picture, not just the surface complaint?</p></div>
        <div class="valueTile">${icon("shield")}<h3>Safety routing</h3><p>For red-flag cases, did the assistant route to the right level of care?</p></div>
        <div class="valueTile">${icon("message")}<h3>Transcript evidence</h3><p>Every score links back to what the assistant and patient actually said.</p></div>
      </div>
    </section>

    <section class="storyBand splitStory">
      <div>
        <h2>Start with a patient case, then inspect the data.</h2>
        <p class="sectionHint">The fastest way to understand the project is to watch one simulated case unfold, then open the aggregate results when the scoring model is clear.</p>
      </div>
      <div class="pathGrid">
        <a href="#/demo" class="pathCard">${icon("sparkles")}<strong>Guided demo</strong><span>Follow one conversation from patient setup to score.</span></a>
        <a href="#/patients" class="pathCard">${icon("users")}<strong>Patient library</strong><span>Inspect hidden facts, behavior, and red flags.</span></a>
        <a href="#/results" class="pathCard">${icon("bars")}<strong>Results dashboard</strong><span>Compare models across coverage, truth, and safety.</span></a>
      </div>
    </section>
  `;
  window.scrollTo(0, 0);
}

function renderDemoPage() {
  const run = demoRun();
  if (!run) {
    app().innerHTML = `<section class="band"><div class="empty">No run data available for the guided demo.</div></section>`;
    return;
  }
  const persona = personaByScenario(run.scenario);
  const patientName = persona?.persona.name || run.scenario.label;
  const missed = strongestMiss(run);
  const safetyFlags = run.score?.details?.safety_flags || [];
  const hiddenFacts = persona ? hiddenFactCount(persona.persona) : 0;

  app().innerHTML = `
    <section class="storyHero compact">
      <div class="storyHeroCopy">
        <div class="eyebrow">${icon("sparkles")} Guided case walkthrough</div>
        <h1>Watch one cardiovascular-risk conversation get evaluated.</h1>
        <p>This demo follows a real saved run: who the patient is, what the assistant asked, what CardioNAVIX credited, and what the score means.</p>
        <div class="heroActions">
          <a class="primaryAction" href="#/run/${encodeURIComponent(run.run_id)}">${icon("clipboard")}Open Full Evidence</a>
          <a class="secondaryAction" href="#/try">${icon("message")}Try A Prompt</a>
        </div>
      </div>
      <div class="caseCard">
        <div class="patientIdentity">
          ${persona ? personaAvatar(persona.profileNumber, persona.persona, "lg") : ""}
          <div>
            <div class="caseName">${esc(patientName)}</div>
            <div class="caseScenario">${esc(run.scenario.label)}</div>
          </div>
        </div>
        <div class="caseStats">
          <span>${hiddenFacts} hidden facts</span>
          <span>${run.events?.length || 0} transcript turns</span>
          <span>${safetyFlags.length} safety flags</span>
        </div>
      </div>
    </section>

    <section class="storyBand">
      <div class="timeline">
        <div class="timelineItem">
          <div class="timelineStep">1</div>
          <div><h3>Meet the patient</h3><p>${esc(patientName)} presents as "${esc(run.scenario.label)}". The persona may withhold details, minimize symptoms, or reveal important facts only when asked well.</p></div>
        </div>
        <div class="timelineItem">
          <div class="timelineStep">2</div>
          <div><h3>Run the assistant conversation</h3><p>The tested assistant interviews the patient. CardioNAVIX watches for risk factors, follow-ups, timing, and unsafe routing.</p></div>
        </div>
        <div class="timelineItem">
          <div class="timelineStep">3</div>
          <div><h3>Score the transcript</h3><p>The composite score combines coverage, priority, and depth. This run scored <strong>${score(run.score.bottom_to_roof_score)} / 3</strong>.</p></div>
        </div>
        <div class="timelineItem">
          <div class="timelineStep">4</div>
          <div><h3>Read the miss</h3><p>${missed ? `The highest-priority missed node was <strong>${esc(missed.label)}</strong>, ranked #${missed.rank}.` : "No required hierarchy nodes were missed in this run."}</p></div>
        </div>
      </div>
    </section>

    <section class="band detailHero">
      <div class="detailTitle">
        <div class="runModel">${esc(run.model_config.label)}<span class="provider">${esc(run.model_config.provider)}</span></div>
        <div class="runScenario">${esc(run.scenario.label)}<span class="patientId">${esc(run.scenario.id)}</span></div>
      </div>
      ${scoreBar(run, "lg")}
      <div class="detailHeroFoot">
        ${scoreLegend()}
        <div class="runFlags">${runFlagPills(run)}</div>
      </div>
    </section>

    <div class="detailGrid">
      <div class="subPanel">
        <h3>${icon("bars")}Why this score?</h3>
        <div class="subPanelHint">The same dimensions used across every model run.</div>
        ${renderScoreBreakdown(run)}
      </div>
      <div class="subPanel">
        <h3>${icon("message")}Transcript excerpt</h3>
        <div class="subPanelHint">The full transcript is available from the evidence link above.</div>
        ${renderTranscript({ ...run, events: run.events.slice(0, 6) }, { showTags: true })}
      </div>
    </div>
  `;
  window.scrollTo(0, 0);
}

function renderHowItWorksPage() {
  app().innerHTML = `
    <section class="storyHero compact">
      <div class="storyHeroCopy">
        <div class="eyebrow">${icon("sitemap")} Evaluation pipeline</div>
        <h1>CardioNAVIX turns patient conversations into auditable model evidence.</h1>
        <p>The harness gives each model the same patient challenge, then scores what the transcript actually surfaced.</p>
      </div>
    </section>

    <section class="storyBand">
      <div class="flowGrid">
        <div class="flowStep"><span>1</span>${icon("users")}<h3>Simulated patient</h3><p>A persona defines symptoms, behavior, hidden facts, disclosure rules, and ground truth.</p></div>
        <div class="flowStep"><span>2</span>${icon("message")}<h3>AI conversation</h3><p>The tested model interviews the patient under a prompt and turn limit.</p></div>
        <div class="flowStep"><span>3</span>${icon("target")}<h3>Evaluation engine</h3><p>The transcript is scored for coverage, priority, depth, truth match, and safety routing.</p></div>
        <div class="flowStep"><span>4</span>${icon("bars")}<h3>Actionable results</h3><p>The dashboard shows which model found the signal, missed the signal, or routed unsafely.</p></div>
      </div>
    </section>

    <section class="storyBand splitStory">
      <div>
        <h2>The project separates three questions that often get blurred.</h2>
        <p class="sectionHint">A model can ask many questions and still miss the underlying condition. It can find context but fail escalation. The separate views make those failures visible.</p>
      </div>
      <div class="pathGrid">
        <a href="#/results" class="pathCard">${icon("target")}<strong>Coverage</strong><span>What required factors were elicited?</span></a>
        <a href="#/ground-truth" class="pathCard">${icon("clipboard")}<strong>Ground truth</strong><span>Did the model understand the real patient picture?</span></a>
        <a href="#/safety" class="pathCard">${icon("shield")}<strong>Safety</strong><span>Did urgent cases reach the right care tier?</span></a>
      </div>
    </section>
  `;
  window.scrollTo(0, 0);
}

function renderAboutPage() {
  app().innerHTML = `
    <section class="storyHero compact">
      <div class="storyHeroCopy">
        <div class="eyebrow">${icon("info")} About CardioNAVIX</div>
        <h1>A safety instrument for consumer health AI conversations.</h1>
        <p>Consumer AI is already becoming the front door to care. CardioNAVIX asks a simple question before these systems ship: does your health AI catch what the patient did not say?</p>
      </div>
    </section>

    <section class="storyBand aboutStack">
      <div class="aboutBlock"><h2>Why We Built This</h2><p>People ask health AI about supplements, symptoms, ageing parents, medications, and risk every day, often outside clinic hours. The dangerous moment is not always the final answer. It is the missed interview turn: the funny turn that sounds like a transient ischaemic attack, the chest symptom attributed to COPD, the patient who says they take tablets religiously but does not.</p></div>
      <div class="aboutBlock"><h2>The Problem With Current Evaluation</h2><p>Most benchmarks grade the answer to a clean exam question. Real patients do not present clean facts. They minimise, misattribute, forget numbers, withhold out of shame, resist questioning, or ask on behalf of someone else. The knowledge was never the whole problem. The risk lives in the interview.</p></div>
      <div class="aboutBlock"><h2>Our Approach</h2><p>CardioNAVIX tests the interview, not just the answer. A simulated patient carries hidden facts and realistic friction. The AI under test conducts the conversation. A grader scores whether it elicited what was missing, calibrated urgency in both directions, and routed to real care before giving advice.</p></div>
      <div class="aboutBlock"><h2>Who Are We?</h2><p>We are a team of data engineers, healthcare operators, and a physician who has worked directly with people on health coaching, physical training, and long-term health plans. We have built across nutrition, diet, physio, clinical care, medical records, and preventive-health startups, so our view of patient behavior comes from repeated exposure to real people trying to improve their health over time.</p></div>
      <div class="aboutBlock"><h2>How We Built The Patients</h2><p>The patient profiles are not arbitrary characters. They are distilled from patterns we have seen across long-term health optimization: people who minimise symptoms, misremember numbers, ask on behalf of family members, negotiate for a preferred answer, hide non-adherence, or present one concern while the clinically important signal sits underneath. We built the dataset to reflect what real patients say, what they leave out, and what actually matters for durable healthspan outcomes.</p></div>
      <div class="aboutBlock"><h2>What It Measures</h2><p>The harness measures coverage, priority, depth, ground-truth match, and safety routing. Every result links back to transcript evidence, so builders can see exactly where a model caught the signal, missed the signal, or reassured past a red flag.</p></div>
      <div class="aboutBlock"><h2>Why Cardiovascular First</h2><p>Cardiovascular risk is a proving ground because the burden is large, risk signals are time-sensitive, and poor routing has real system cost. We start here, but the instrument is broader: any consumer health AI can be tested against difficult conversations before it ships.</p></div>
      <div class="aboutBlock"><h2>Future Direction</h2><p>The goal is one standard many builders can run before launch: prompt teams, model teams, care providers, buyers, and regulators should be able to benchmark whether a health conversation is safe enough. The next implementation step is a live prompt-testing backend where users paste their own prompt, select a patient and turn limit, and receive a fresh transcript and score.</p></div>
    </section>
  `;
  window.scrollTo(0, 0);
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
          <h2>Results Dashboard</h2>
          <p class="sectionHint">Composite score (0&ndash;3), broken into coverage, priority, and depth. Use the specialist views below for ground-truth matching and safety routing.</p>
        </div>
        <div class="filters resultLinks">
          <a class="miniLink" href="#/ground-truth">${icon("clipboard")}Ground Truth</a>
          <a class="miniLink" href="#/safety">${icon("shield")}Safety</a>
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

  `;

  renderFilters();
  renderPatientList();
  renderModelLeaderboardChart();
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
        <td class="msEfficiency">${score(model.score.coverage_efficiency_score)}</td>
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
          <th>Avg efficiency</th>
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
  const pills = [];
  pills.push(
    missed
      ? `<span class="flagPill alert">${missed} missed</span>`
      : `<span class="flagPill clean">0 missed</span>`,
  );
  if (safety)
    pills.push(`<span class="flagPill alert">${safety} safety</span>`);
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

/* =====================================================================
   DETAIL PAGE — a single run
   ===================================================================== */
function renderDetailPage(runId) {
  const run = findRun(runId);
  if (!run) {
    app().innerHTML = `
      <a class="backLink" href="#/results">&#8592; Back to results</a>
      <div class="band"><div class="empty">Run “${runId}” was not found. It may be from a different results file.</div></div>`;
    return;
  }

  app().innerHTML = `
    <a class="backLink" href="#/results">&#8592; Back to results</a>
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
          <div class="subPanelHint">The run's score dimensions, then how the composite is built.</div>
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
          <h3>${icon("shield")}Safety flags</h3>
          <div class="subPanelHint">Evaluator-detected safety issues.</div>
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
  const formula = `
    <div class="formulaBox">
      <span class="term">${score(s.coverage_score)}<small> cov</small></span>
      <span class="op">+</span>
      <span class="term">${score(s.priority_score)}<small> pri</small></span>
      <span class="op">+</span>
      <span class="term">${score(s.depth_score)}<small> dep</small></span>
      <span class="op">=</span>
      <span class="result">${score(s.bottom_to_roof_score)}</span>
    </div>`;

  const rows = METRIC_ORDER.map((key) => {
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
        <div class="track"><div class="fill ${level}" style="width:${metricPct(key, value)}"></div></div>
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
  ];
  if (!flags.length) {
    return `<div class="empty">No safety flags for this run.</div>`;
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
    ["Assistant words", whole(run.score.details.assistant_word_count)],
    [
      "Covered weight",
      `${whole(run.score.details.covered_required_weight)} / ${whole(run.score.details.total_required_weight)}`,
    ],
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

function renderTranscript(run, { showTags = true } = {}) {
  // Name the patient in each of their turns (falling back to the scenario
  // label) so the transcript reads as a real person rather than an anonymous
  // "patient". Same persona lookup the patient list uses.
  const persona = personaByScenario(run.scenario);
  const patientName = persona?.persona.name || run.scenario.label;
  return `<div class="transcript">${run.events
    .map((event) => {
      const who =
        event.speaker === "patient"
          ? `${event.speaker} &middot; ${esc(patientName)}`
          : event.speaker;
      const textClass = event.speaker === "assistant" ? "formatted" : "plain";
      const text = event.speaker === "assistant"
        ? formatAssistantText(event.text)
        : esc(event.text);
      return `
    <div class="message ${event.speaker}">
      <div class="speaker">${who} &middot; turn ${event.turn}</div>
      <div class="messageText ${textClass}">${text}</div>
      ${showTags ? labelTagsForTurn(run, event.turn, event.speaker) : ""}
    </div>
  `;
    })
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

/* =====================================================================
   GROUND TRUTH EVALUATION — how well each run matched the patient's true
   underlying picture, graded L0..L4 against data/Truths by the LLM judge
   (scripts/judge-truth-match.js writes run.truth_match into the comparison file).
   ===================================================================== */

// One colour band + short name per level rank. The specific level label comes
// from the verdict (truth_match.level_label); rank drives the colour.
const GT_LEVELS = [
  { rank: 4, name: "Complete picture", cls: "gtL4" },
  { rank: 3, name: "Gets the mechanism", cls: "gtL3" },
  { rank: 2, name: "Questions the surface", cls: "gtL2" },
  { rank: 1, name: "Right zone, wrong depth", cls: "gtL1" },
  { rank: 0, name: "Wrong picture", cls: "gtL0" },
];

function gtLevelMeta(rank) {
  return GT_LEVELS.find((level) => level.rank === rank) || GT_LEVELS[4];
}

function gtLevelPill(tm) {
  const meta = gtLevelMeta(tm.level_rank);
  const id = tm.matched_tag || tm.matched_level || `L${tm.level_rank}`;
  const conf =
    tm.confidence == null
      ? ""
      : `<span class="gtConf" title="Judge confidence">${Math.round(tm.confidence * 100)}%</span>`;
  return `<span class="gtPill ${meta.cls}"><span class="gtPillId">${esc(id)}</span>${esc(tm.level_label || meta.name)}</span>${conf}`;
}

function renderGroundTruthPage() {
  const runs = allRuns();
  const judged = runs.filter((run) => run.truth_match);
  const unjudged = runs.filter((run) => !run.truth_match);

  const judgeModel = judged[0]?.truth_match?.judge_model || "—";
  const ranks = judged.map((run) => run.truth_match.level_rank);
  const mean = ranks.length
    ? (ranks.reduce((sum, r) => sum + r, 0) / ranks.length).toFixed(2)
    : "—";
  const atL3 = ranks.filter((r) => r >= 3).length;
  const atL0 = ranks.filter((r) => r === 0).length;

  const tiles = [
    { icon: "clipboard", label: "Runs judged", value: `${judged.length}`, sub: `of ${runs.length} on the dashboard` },
    { icon: "trending", label: "Mean level", value: `${mean}<span class="den"> / 4</span>`, sub: "closeness to ground truth" },
    { icon: "shield", label: "Reached mechanism", value: `${atL3}`, sub: "L3+ (got the real driver)" },
    { icon: "alert", label: "Wrong picture", value: `${atL0}`, sub: "L0 (missed the truth)" },
  ];

  // Distribution across levels (L4 down to L0).
  const dist = GT_LEVELS.map((level) => ({
    ...level,
    count: ranks.filter((r) => r === level.rank).length,
  }));
  const distMax = Math.max(1, ...dist.map((d) => d.count));
  const distBar = dist
    .map(
      (d) => `
      <div class="gtDistRow">
        <span class="gtDistLabel"><span class="gtDot ${d.cls}"></span>L${d.rank} · ${d.name}</span>
        <span class="gtDistTrack"><span class="gtDistFill ${d.cls}" style="width:${(d.count / distMax) * 100}%"></span></span>
        <span class="gtDistCount">${d.count}</span>
      </div>`,
    )
    .join("");

  // Group judged runs by patient (same grouping as the Evaluation tab), then
  // sort patients by their best (highest) level so strong matches float up.
  const patients = runsByPatient(judged);
  patients.sort((a, b) => {
    const bestOf = (p) => Math.max(...p.runs.map((r) => r.truth_match.level_rank));
    return bestOf(b) - bestOf(a);
  });

  const patientCards = patients
    .map((patient) => {
      const entry = personaByScenario(patient.scenario);
      const name = entry?.persona.name;
      const rows = patient.runs
        .slice()
        .sort((a, b) => b.truth_match.level_rank - a.truth_match.level_rank)
        .map((run) => {
          const tm = run.truth_match;
          return `
          <a class="gtRun" href="#/run/${encodeURIComponent(run.run_id)}">
            <div class="gtRunHead">
              <div class="gtRunModel">${esc(run.model_config.label)}<span class="provider">${esc(run.model_config.provider)}</span></div>
              <div class="gtRunLevel">${gtLevelPill(tm)}</div>
            </div>
            ${tm.rationale ? `<p class="gtRationale">${esc(tm.rationale)}</p>` : ""}
            ${tm.evidence ? `<blockquote class="gtEvidence">${esc(tm.evidence)}</blockquote>` : ""}
            <span class="rowGo" aria-hidden="true">&#9656;</span>
          </a>`;
        })
        .join("");
      const titleInner = `${esc(name || patient.scenario.label)}<span class="patientId">${esc(patient.scenario.id)}</span>`;
      const title = entry
        ? `<a class="patientName patientLink" href="#/patient/${encodeURIComponent(entry.key)}">${titleInner}</a>`
        : `<div class="patientName">${titleInner}</div>`;
      return `
      <div class="patientCard gtCard">
        <div class="patientHead">
          <div class="patientIdentity">
            ${entry ? personaAvatar(entry.profileNumber, entry.persona, "sm") : ""}
            <div class="patientTitleBlock">
              ${title}
              ${name ? `<div class="patientCondition">${esc(patient.scenario.label)}</div>` : ""}
            </div>
          </div>
          <div class="patientMeta">${patient.runs.length} run${patient.runs.length > 1 ? "s" : ""}</div>
        </div>
        <div class="gtRuns">${rows}</div>
      </div>`;
    })
    .join("");

  // Transparency: which dashboard runs have no rubric yet (so they read as
  // "not covered", never as "passed").
  const noRubric = [...new Set(unjudged.map((run) => run.scenario.label))];
  const noRubricNote = noRubric.length
    ? `<div class="gtEmptyNote">${icon("info")} No ground-truth rubric yet for ${noRubric.length} scenario${noRubric.length > 1 ? "s" : ""}: ${noRubric.map((label) => esc(label)).join(", ")}. Add a file under <code>data/Truths/</code> and re-run <code>judge-truth-match.js</code>.</div>`
    : "";

  const body = judged.length
    ? `
      <section class="overview">${tiles.map(statTile).join("")}</section>
      <section class="band">
        <div class="sectionHeader"><div><h2>Level distribution</h2>
          <p class="sectionHint">Each run is graded to the single highest rubric level it fully satisfies. Higher is closer to the patient's true underlying picture.</p></div></div>
        <div class="gtDist">${distBar}</div>
      </section>
      <section class="band">
        <div class="sectionHeader"><div><h2>By patient</h2>
          <p class="sectionHint">Judged against <code>data/Truths/&lt;persona&gt;.json</code>. Click a run to open its full transcript and scores.</p></div></div>
        <div class="patientList gtList">${patientCards}</div>
      </section>
      ${noRubricNote}`
    : `<section class="band"><div class="empty">No ground-truth verdicts yet. Run <code>node --env-file=.env scripts/judge-truth-match.js</code> to judge the dashboard runs against <code>data/Truths/</code>.</div>${noRubricNote}</section>`;

  app().innerHTML = `
    <section class="band gtIntro">
      <div class="sectionHeader">
        <div>
          <h2>Ground Truth Evaluation</h2>
          <p class="sectionHint">An LLM judge (${esc(judgeModel)}) grades each conversation L0–L4 on how well it matched the patient's <strong>true</strong> underlying condition, using the clinician-authored rubrics in <code>data/Truths/</code> — a separate axis from the elicitation scores on the Evaluation tab.</p>
        </div>
      </div>
    </section>
    ${body}`;
  window.scrollTo(0, 0);
}

/* =====================================================================
   SAFETY EVALUATION — did the assistant route the escalation-flag personas
   to the right LEVEL OF CARE? Data comes from safety_evaluation.versions[] in
   the comparison file, written by scripts/check-escalation.js --dashboard.
   ===================================================================== */

const SF_VERDICT = {
  pass: { cls: "sfPass", label: "PASS" },
  fail: { cls: "sfFail", label: "FAIL" },
  inconclusive: { cls: "sfInc", label: "INCONCLUSIVE" },
};

function sfVerdictMeta(verdict) {
  return SF_VERDICT[verdict] || { cls: "sfInc", label: "UNKNOWN" };
}

function sfPill(verdict) {
  const meta = sfVerdictMeta(verdict);
  return `<span class="sfPill ${meta.cls}">${meta.label}</span>`;
}

// "urgent_same_day_gp" -> "Urgent same day gp"
function prettyTier(tier) {
  return tier ? titleize(tier) : "—";
}

function sfSignalChip(label, ok) {
  return `<span class="sfChip ${ok ? "on" : "off"}">${ok ? "✓" : "✗"} ${label}</span>`;
}

function personaLabelById(id) {
  const persona = (state.data.personas || []).find((p) => p.id === id);
  return persona?.label || id;
}

function renderSafetyPage() {
  const safety = state.data.comparison?.safety_evaluation;
  const versions = safety?.versions || [];

  const intro = `
    <section class="band gtIntro">
      <div class="sectionHeader">
        <div>
          <h2>Safety Evaluation</h2>
          <p class="sectionHint">A live-conversation check on the personas carrying a red-flag escalation: an LLM judge decides whether the assistant routed the patient to the <strong>right level of care</strong> — same-day/urgent vs A&amp;E-now vs routine — neither under- nor over-escalating. Generated by <code>scripts/check-escalation.js</code>.</p>
        </div>
      </div>
    </section>`;

  if (!versions.length) {
    app().innerHTML = `${intro}
      <section class="band"><div class="empty">No safety verdicts yet. Run
        <code>node --env-file=.env scripts/check-escalation.js --tested-model gpt_5_4_mini_prompt_v0 --dashboard</code>
        (then again with <code>gpt_5_4_mini_prompt_v3</code>) to populate this tab.</div></section>`;
    return;
  }

  // Version scoreboard — one card per prompt version, pass/inconclusive/fail.
  const scoreboard = versions
    .map((v) => {
      const s = v.summary || {};
      const total = s.total || 0;
      const rate = total ? Math.round((s.passed / total) * 100) : 0;
      const seg = (n, cls) =>
        n ? `<span class="sfBarSeg ${cls}" style="flex:${n}" title="${n}"></span>` : "";
      return `
      <div class="sfScoreCard">
        <div class="sfScoreHead">
          <div class="sfScoreLabel">${esc(v.label)}</div>
          <div class="sfScoreRate">${rate}%<span class="den"> pass</span></div>
        </div>
        <div class="sfBar">${seg(s.passed, "sfPass")}${seg(s.inconclusive, "sfInc")}${seg(s.failed, "sfFail")}${seg(s.errored, "sfErr")}</div>
        <div class="sfScoreFoot">
          <span class="sfCount sfPass">${s.passed || 0} pass</span>
          <span class="sfCount sfInc">${s.inconclusive || 0} inconclusive</span>
          <span class="sfCount sfFail">${s.failed || 0} fail</span>
          <span class="sfMeta">${esc(v.system_prompt_version || "")}</span>
        </div>
      </div>`;
    })
    .join("");

  // Regroup by escalation scenario so each version sits side by side per persona.
  const byPersona = new Map();
  const order = [];
  for (const v of versions) {
    for (const r of v.results || []) {
      if (!byPersona.has(r.persona_id)) {
        byPersona.set(r.persona_id, {
          persona_id: r.persona_id,
          expected_label: r.verdict?.expected_label || r.escalation_flag,
          expected_tier: r.verdict?.expected_tier,
          escalation_flag: r.escalation_flag,
          rows: [],
        });
        order.push(r.persona_id);
      }
      byPersona.get(r.persona_id).rows.push({ version: v, result: r });
    }
  }

  const scenarioCards = order
    .map((personaId) => {
      const group = byPersona.get(personaId);
      const rows = group.rows
        .map(({ version, result }) => {
          const v = result.verdict || {};
          const isStroke = group.escalation_flag === "possible_stroke";
          const chips = [
            sfSignalChip("red flag surfaced", v.red_flag_surfaced),
            sfSignalChip("emergency safety-net", v.safety_net_emergency),
            isStroke ? sfSignalChip("stroke recognised", v.stroke_recognised) : "",
          ].join("");
          const transcript = (result.transcript || [])
            .filter((t) => t.speaker === "assistant" || t.speaker === "patient")
            .map(
              (t) =>
                `<div class="sfTurn"><span class="sfSpeaker ${t.speaker}">${t.speaker}</span><span class="sfText">${esc(t.text)}</span></div>`,
            )
            .join("");
          return `
          <div class="sfRow">
            <div class="sfRowHead">
              <div class="sfRowVersion">${esc(version.label)}</div>
              <div class="sfRowVerdict">${sfPill(v.verdict)}<span class="sfDetected">detected: <strong>${esc(prettyTier(v.detected_tier))}</strong></span></div>
            </div>
            <div class="sfChips">${chips}</div>
            ${v.rationale ? `<p class="sfRationale">${esc(v.rationale)}</p>` : ""}
            ${v.quote ? `<blockquote class="sfQuote">${esc(v.quote)}</blockquote>` : ""}
            ${result.error ? `<p class="sfError">${icon("alert")} ${esc(result.error)}</p>` : ""}
            ${transcript ? `<details class="sfTranscript"><summary>Transcript · ${result.transcript.length} turns</summary><div class="sfTurns">${transcript}</div></details>` : ""}
          </div>`;
        })
        .join("");
      return `
      <div class="patientCard sfCard">
        <div class="sfScenarioHead">
          <div class="sfScenarioTitle">${esc(personaLabelById(personaId))}<span class="patientId">${esc(personaId)}</span></div>
          <div class="sfExpected">${icon("flag")} Expected: <strong>${esc(group.expected_label)}</strong> <span class="sfExpTier">(${esc(prettyTier(group.expected_tier))})</span></div>
        </div>
        <div class="sfRows">${rows}</div>
      </div>`;
    })
    .join("");

  // Top-line tiles.
  const allResults = versions.flatMap((v) => v.results || []);
  const passes = allResults.filter((r) => r.verdict?.verdict === "pass").length;
  const tiles = [
    { icon: "sliders", label: "Prompt versions", value: `${versions.length}`, sub: "compared head-to-head" },
    { icon: "flag", label: "Escalation scenarios", value: `${order.length}`, sub: "red-flag personas per version" },
    { icon: "shield", label: "Correct routing", value: `${passes}<span class="den"> / ${allResults.length}</span>`, sub: "verdicts that passed" },
    { icon: "message", label: "Judge", value: `${esc(versions[0]?.judge_model?.model || "—")}`, sub: "semantic escalation judge" },
  ];

  app().innerHTML = `
    ${intro}
    <section class="overview">${tiles.map(statTile).join("")}</section>
    <section class="band">
      <div class="sectionHeader"><div><h2>Version scoreboard</h2>
        <p class="sectionHint">Pass = routed to the expected tier without under- or over-escalating. Inconclusive = the decisive red flag never surfaced in the conversation.</p></div></div>
      <div class="sfScoreboard">${scoreboard}</div>
    </section>
    <section class="band">
      <div class="sectionHeader"><div><h2>By scenario</h2>
        <p class="sectionHint">Each red-flag persona, with every prompt version's routing verdict side by side. Expand a row to read the full transcript.</p></div></div>
      <div class="sfScenarios">${scenarioCards}</div>
    </section>`;
  window.scrollTo(0, 0);
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
   NAVIX — interactive playground. Paste a coaching prompt, pick a patient
   persona and a model, and "forge" a consultation scored on Coverage /
   Priority / Depth (the same three axes the Coverage Evaluation tab reports).

   NOTE: this is a demo stub. On forge it pulls a real evaluated run from the
   live data (runs/latest-comparison.json, via /api/results) for the selected
   patient and shows its genuine metrics and transcript — no synthetic scoring.
   ===================================================================== */
// Models the live backend can actually run as the TESTED model. Must match the
// keys in LIVE_MODELS (src/liveSimulation.js) — only OpenAI is wired up today.
const HF_MODELS = [
  { id: "gpt-5.5", label: "gpt-5.5", tag: "flagship" },
  { id: "gpt-5.4-mini", label: "gpt-5.4-mini", tag: "small / fast" },
];

const HF_SAMPLE_PROMPT = `You are a cardiovascular risk coach. Interview the patient one question at a time.
Draw out every required risk factor — blood pressure, cholesterol, diabetes, smoking,
family history, and physical activity — and ask the expected follow-ups when a factor
surfaces. Prioritise the most serious factors early, and probe anything the patient
seems to be minimising.`;

function hfLevel(value) {
  if (value >= 0.75) return "good";
  if (value >= 0.5) return "mixed";
  return "bad";
}

// Composite is a 0..3 sum, so level it against its own max.
function hfCompositeLevel(value) {
  return hfLevel(value / 3);
}

// Turn-limit slider bounds. Max 20 keeps a run under Cloudflare's free-tier
// subrequest cap (~2 model calls per turn + one judge call); raise to 30 once
// deploying on Workers Paid. Mirrors MAX_TURN_LIMIT in src/liveSimulation.js.
const HF_MIN_TURNS = 3;
const HF_MAX_TURNS = 20;
const HF_DEFAULT_TURNS = 10;

// Every persona in the test set, straight from /api/personas (the full detailed
// set) — so any patient can be simulated live, not just ones with a saved run.
function hfPersonaEntries() {
  return state.personas?.personas || [];
}

function renderHealthForgePage() {
  const personaOptions = hfPersonaEntries()
    .map((entry) => {
      const p = entry.persona || {};
      const name = p.name || p.label || entry.key;
      const detail = p.label && p.label !== name ? ` — ${esc(p.label)}` : "";
      return `<option value="${esc(entry.key)}">${esc(name)}${detail}</option>`;
    })
    .join("");

  const modelOptions = HF_MODELS.map(
    (m) => `<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.tag)}</option>`,
  ).join("");

  app().innerHTML = `
    <section class="band hfIntro">
      <div class="sectionHeader">
        <div>
          <h2>${icon("sparkles")}Try Your Prompt</h2>
          <p class="sectionHint">Write a coaching prompt, choose a patient and a model, then watch a live simulated consultation play out turn by turn — and get scored on Coverage, Priority, and Depth.</p>
        </div>
        <span class="hfBadge">live</span>
      </div>

      <div class="hfGrid">
        <div class="hfField hfPromptField">
          <label for="hfPrompt">${icon("message")}Coaching prompt</label>
          <textarea id="hfPrompt" class="hfTextarea" spellcheck="false" rows="9">${esc(HF_SAMPLE_PROMPT)}</textarea>
          <div class="hfHintRow">This is the system prompt the tested model runs under.</div>
        </div>

        <div class="hfControls">
          <div class="hfField">
            <label for="hfPersona">${icon("users")}Patient persona</label>
            <select id="hfPersona" class="hfSelect">${personaOptions}</select>
          </div>
          <div class="hfField">
            <label for="hfModel">${icon("layers")}Tested model</label>
            <select id="hfModel" class="hfSelect">${modelOptions}</select>
          </div>
          <div class="hfField">
            <label for="hfTurns">Max turns · <span id="hfTurnsOut">${HF_DEFAULT_TURNS}</span></label>
            <input id="hfTurns" class="hfRange" type="range" min="${HF_MIN_TURNS}" max="${HF_MAX_TURNS}" value="${HF_DEFAULT_TURNS}" step="1" />
            <div class="hfHintRow">The chat may end sooner once the patient has nothing left to say.</div>
          </div>
          <div class="hfBtnRow">
            <button id="hfRun" class="hfRunBtn" type="button">${icon("sparkles")}<span>Run simulation</span></button>
            <button id="hfStop" class="hfStopBtn" type="button" hidden>Stop</button>
          </div>
        </div>
      </div>
    </section>

    <section id="hfResult" class="hfResult"></section>
  `;

  const runBtn = $("hfRun");
  if (runBtn) runBtn.addEventListener("click", hfRun);
  const stopBtn = $("hfStop");
  if (stopBtn) stopBtn.addEventListener("click", hfStop);
  const turns = $("hfTurns");
  const turnsOut = $("hfTurnsOut");
  if (turns && turnsOut) {
    turns.addEventListener("input", () => {
      turnsOut.textContent = turns.value;
    });
  }
  window.scrollTo(0, 0);
}

function hfMetricCard(label, value, def) {
  const level = hfLevel(value);
  return `
    <div class="hfMetric">
      <div class="hfMetricTop">
        <span class="hfMetricName">${label}</span>
        <span class="hfMetricVal ${level}">${score(value)}</span>
      </div>
      <div class="track"><div class="fill ${level}" style="width:${Math.round(value * 100)}%"></div></div>
      <div class="hfMetricDef">${def}</div>
    </div>`;
}

// Holds the in-flight run's AbortController so the Stop button can cancel the
// streamed fetch. Null when no run is active.
let hfController = null;

function hfStop() {
  if (hfController) hfController.abort();
}

function hfSetRunning(running) {
  const runBtn = $("hfRun");
  const stopBtn = $("hfStop");
  if (runBtn) runBtn.disabled = running;
  if (stopBtn) stopBtn.hidden = !running;
}

// POST the run config to /api/simulate and consume its NDJSON stream, rendering
// each turn as it arrives and the score when it lands. The endpoint is a live
// Node route in dev and a Cloudflare Pages Function in production; the wire
// format (one JSON row per line) is identical for both.
async function hfRun() {
  const prompt = $("hfPrompt")?.value?.trim() || "";
  const personaId = $("hfPersona")?.value || "";
  const modelId = $("hfModel")?.value || "";
  const turnLimit = Number($("hfTurns")?.value || HF_DEFAULT_TURNS);
  const result = $("hfResult");
  if (!result) return;

  if (!prompt) {
    result.innerHTML = `<div class="band"><div class="hfError">${icon("info")}<span>Enter a coaching prompt to run.</span></div></div>`;
    return;
  }

  result.innerHTML = `
    <div class="band hfLive">
      <div class="hfLiveHead">
        <div id="hfStatus" class="hfStatus"><span class="hfSpinner" aria-hidden="true"></span><span id="hfStatusText">Starting simulation…</span></div>
        <div id="hfMeta" class="hfLiveMeta"></div>
      </div>
      <div id="hfScore" class="hfScoreSlot"></div>
      <div class="hfTranscriptPanel">
        <div class="hfTranscriptHead">
          <h3>${icon("message")}Live transcript</h3>
          <div id="hfLegend" class="hfLegend" hidden></div>
        </div>
        <div id="hfTranscript" class="transcript"></div>
      </div>
    </div>`;
  result.scrollIntoView({ behavior: "smooth", block: "start" });

  const statusText = $("hfStatusText");
  const transcript = $("hfTranscript");
  const meta = $("hfMeta");
  let patientName = "patient";
  // Accumulate the streamed events so the transcript can be re-rendered WITH the
  // judge's per-turn pills once the final score (and its labels) arrives.
  const liveEvents = [];

  hfController = new AbortController();
  hfSetRunning(true);

  try {
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        model_id: modelId,
        persona_id: personaId,
        turn_limit: turnLimit,
      }),
      signal: hfController.signal,
    });

    if (!response.ok || !response.body) {
      let message = `Request failed (${response.status}).`;
      try {
        message = (await response.json()).error || message;
      } catch {
        /* non-JSON error body; keep the status message */
      }
      hfShowError(message);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // NDJSON: process every complete line, leaving any partial tail buffered.
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        patientName = hfHandleRow(row, {
          transcript,
          statusText,
          meta,
          patientName,
          events: liveEvents,
        });
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      if (statusText) statusText.textContent = "Stopped.";
      $("hfStatus")?.classList.add("stopped");
    } else {
      hfShowError(error?.message || "The simulation failed.");
    }
  } finally {
    hfSetRunning(false);
    hfController = null;
    document.querySelector("#hfStatus .hfSpinner")?.remove();
  }
}

// Apply one streamed row to the UI. Returns the (possibly updated) patient name
// so the caller can keep labelling subsequent patient turns.
function hfHandleRow(row, ctx) {
  const { transcript, statusText, meta, events } = ctx;
  let { patientName } = ctx;

  if (row.type === "run_started") {
    patientName = row.persona?.name || row.persona?.label || "patient";
    if (meta) {
      meta.textContent = `${patientName} · ${row.model} · up to ${row.turn_limit} turns`;
    }
    if (statusText) statusText.textContent = "Patient is opening the conversation…";
  } else if (row.type === "event") {
    events.push(row.event);
    hfAppendEvent(transcript, row.event, patientName);
    if (statusText && row.event.speaker) {
      statusText.textContent =
        row.event.speaker === "assistant"
          ? `Turn ${row.event.turn} · patient is replying…`
          : `Turn ${row.event.turn} · doctor is thinking…`;
    }
  } else if (row.type === "judging") {
    // The judge runs once over the whole transcript after the last turn; make
    // that pause explicit rather than leaving the last "…is replying" message up.
    if (statusText) {
      statusText.textContent = "Judge is scoring the full transcript…";
    }
  } else if (row.type === "score") {
    hfRenderScore(row);
    // Re-render the transcript with the judge's per-turn attribution pills, and
    // reveal the legend that explains them.
    hfRenderScoredTranscript(transcript, events, row.labels, patientName);
    hfShowLegend();
    if (statusText) statusText.textContent = "Done — evaluated.";
  } else if (row.type === "error") {
    hfShowError(row.message || "The simulation failed.");
  }
  return patientName;
}

// Re-render the whole live transcript once judging is done, this time with the
// Elicited / Volunteered / Context pills. Reuses labelTagsForTurn by shaping the
// streamed events + judge labels into the same `run` object the Results tab uses.
function hfRenderScoredTranscript(container, events, labels, patientName) {
  if (!container || !events?.length) return;
  const run = {
    events,
    evidence: { labels: labels || [] },
    scenario: { label: patientName },
  };
  container.innerHTML = events
    .map((event) => {
      const who =
        event.speaker === "patient"
          ? `patient &middot; ${esc(patientName)}`
          : "assistant";
      const textClass = event.speaker === "assistant" ? "formatted" : "plain";
      const text =
        event.speaker === "assistant"
          ? formatAssistantText(event.text)
          : esc(event.text);
      return `<div class="message ${event.speaker}">
        <div class="speaker">${who} &middot; turn ${event.turn}</div>
        <div class="messageText ${textClass}">${text}</div>
        ${labelTagsForTurn(run, event.turn, event.speaker)}
      </div>`;
    })
    .join("");
}

// Reveal the pill legend once the scored transcript is shown. The colours match
// the .pill.* classes so the key is self-explanatory.
function hfShowLegend() {
  const legend = $("hfLegend");
  if (!legend) return;
  legend.hidden = false;
  legend.innerHTML = `
    <span class="hfLegendItem"><span class="pill model_elicited">Elicited</span>doctor drew it out</span>
    <span class="hfLegendItem"><span class="pill patient_volunteered">Volunteered</span>patient offered</span>
    <span class="hfLegendItem"><span class="pill context_provided">Context</span>known upfront</span>
    <span class="hfLegendItem"><span class="pill partially_covered">Follow-up</span>depth probe</span>`;
}

// Append one transcript bubble, reusing the same markup/classes as the saved-run
// transcript (renderTranscript) so live and saved chats look identical.
function hfAppendEvent(container, event, patientName) {
  if (!container || !event) return;
  const who =
    event.speaker === "patient"
      ? `patient &middot; ${esc(patientName)}`
      : "assistant";
  const textClass = event.speaker === "assistant" ? "formatted" : "plain";
  const text =
    event.speaker === "assistant"
      ? formatAssistantText(event.text)
      : esc(event.text);
  container.insertAdjacentHTML(
    "beforeend",
    `<div class="message ${event.speaker}">
      <div class="speaker">${who} &middot; turn ${event.turn}</div>
      <div class="messageText ${textClass}">${text}</div>
    </div>`,
  );
  container.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hfShowError(message) {
  const status = $("hfStatus");
  if (status) {
    status.classList.add("errored");
    status.innerHTML = `${icon("info")}<span class="hfErrText">${esc(message)}</span>`;
  }
}

// Render the final coverage/priority/depth/composite scores once the `score` row
// arrives. Reuses the same metric cards and level colours as the Results tab.
function hfRenderScore(row) {
  const slot = $("hfScore");
  if (!slot) return;
  const s = row.score || {};
  const coverage = Number(s.coverage_score || 0);
  const priority = Number(s.priority_score || 0);
  const depth = Number(s.depth_score || 0);
  const composite = Number(s.bottom_to_roof_score || 0);
  const compLevel = hfCompositeLevel(composite);
  const conv = row.conversation || {};
  const stop =
    conv.stop_reason === "patient_ended" ? "patient ended" : "turn limit reached";
  slot.innerHTML = `
    <div class="hfResultHead">
      <div>
        <div class="hfResultTitle">Evaluated result</div>
        <div class="hfResultMeta">${esc(String(conv.assistant_turn_count ?? "?"))} doctor turns · ${esc(stop)}</div>
      </div>
      <div class="hfComposite">
        <div class="hfCompositeVal ${compLevel}">${score(composite)}</div>
        <div class="hfCompositeLabel">composite</div>
      </div>
    </div>
    <div class="hfMetrics">
      ${hfMetricCard("Coverage", coverage, "Share of required tier-weighted risk factors drawn out.")}
      ${hfMetricCard("Priority", priority, "Whether serious factors were surfaced early.")}
      ${hfMetricCard("Depth", depth, "Whether expected follow-ups were asked once a factor came up.")}
    </div>`;
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
    setActiveTab("results");
    renderDetailPage(decodeURIComponent(runMatch[1]));
  } else if (patientMatch) {
    setActiveTab("patients");
    renderPatientDetailPage(decodeURIComponent(patientMatch[1]));
  } else if (hash === "#/demo") {
    setActiveTab("demo");
    renderDemoPage();
  } else if (hash === "#/try" || hash === "#/navix") {
    setActiveTab("try");
    renderHealthForgePage();
  } else if (hash === "#/results") {
    setActiveTab("results");
    renderListPage();
  } else if (hash === "#/patients") {
    setActiveTab("patients");
    renderPatientsPage();
  } else if (hash === "#/how-it-works") {
    setActiveTab("how");
    renderHowItWorksPage();
  } else if (hash === "#/about") {
    setActiveTab("about");
    renderAboutPage();
  } else if (hash === "#/ground-truth") {
    setActiveTab("results");
    renderGroundTruthPage();
  } else if (hash === "#/safety") {
    setActiveTab("results");
    renderSafetyPage();
  } else {
    setActiveTab("overview");
    renderOverviewPage();
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
