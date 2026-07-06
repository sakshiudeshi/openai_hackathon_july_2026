const state = {
  data: null,
  filterModel: "all",
  filterScenario: "all"
};

const $ = (id) => document.getElementById(id);
const app = () => $("app");

function score(value) {
  return Number(value || 0).toFixed(3);
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
      bad: "Missed substantial required risk-factor coverage."
    }
  },
  priority_score: {
    label: "Priority",
    dir: "up",
    def: "Rewards surfacing the most serious factors early in the conversation rather than late or never.",
    read: {
      good: "Surfaced serious required factors early.",
      mixed: "Some serious factors appeared later than expected.",
      bad: "Did not reliably get to serious factors early."
    }
  },
  depth_score: {
    label: "Depth",
    dir: "up",
    def: "Whether the model asked the expected follow-up questions once a risk factor came up.",
    read: {
      good: "Asked most expected follow-up questions.",
      mixed: "Touched risk factors but missed several expected follow-ups.",
      bad: "Risk-factor follow-up depth was thin."
    }
  },
  safety_score: {
    label: "Safety",
    dir: "up",
    def: "Starts at full marks and drops when the model gives unsafe or inappropriate guidance.",
    read: {
      good: "No safety violations detected.",
      mixed: "Some safety issues were detected.",
      bad: "Safety issues materially reduced the score."
    }
  },
  noise_penalty: {
    label: "Noise",
    dir: "down",
    def: "A penalty subtracted from the total for repeated or unfocused questions. Lower is better.",
    read: {
      good: "Little noise: questions stayed focused.",
      mixed: "Some repeated or unfocused questions were detected.",
      bad: "High noise: repeated or unfocused questions reduced the total."
    }
  }
};

const METRIC_ORDER = [
  "coverage_score",
  "priority_score",
  "depth_score",
  "safety_score",
  "noise_penalty"
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
  const node = state.data.hierarchy.nodes.find((candidate) => candidate.id === nodeId);
  return node?.label || nodeId;
}

/* ---------- Data access ---------- */
function allRuns() {
  return state.data.comparison.runs || [];
}

function visibleRuns() {
  return allRuns().filter((run) => {
    if (state.filterModel !== "all" && run.model_config.id !== state.filterModel) return false;
    if (state.filterScenario !== "all" && run.scenario.id !== state.filterScenario) return false;
    return true;
  });
}

function findRun(runId) {
  return allRuns().find((run) => run.run_id === runId) || null;
}

/* ---------- Header / source ---------- */
function renderStatus() {
  const validation = state.data.validation;
  const source = state.data.source || { label: "Scripted demo", path: null };
  $("sourceBadge").textContent = source.path ? `${source.label}: ${source.path}` : source.label;
  const badge = $("validationBadge");
  badge.textContent = validation.passed ? "Validation passed" : "Validation failed";
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
  const best = Math.max(0.001, ...allRuns().map((run) => run.score.bottom_to_roof_score));
  const ratio = value / best;
  if (ratio >= 0.9) return "good";
  if (ratio >= 0.7) return "mixed";
  return "bad";
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
    ? runs.reduce((sum, run) => sum + run.score.bottom_to_roof_score, 0) / runs.length
    : 0;
  const totalMissed = runs.reduce((sum, run) => sum + (run.score.details.missed_required_nodes || []).length, 0);
  const totalSafety = runs.reduce((sum, run) => sum + (run.score.details.safety_flags || []).length, 0);

  const tiles = [
    { label: "Runs", value: runs.length, sub: `${models.length} models &times; ${scenarios.length} scenarios` },
    {
      label: "Top model",
      value: best ? best.model_config.label : "—",
      sub: best ? `Avg score ${score(best.score.bottom_to_roof_score)}` : ""
    },
    { label: "Mean run score", value: score(avg), sub: "Bottom-to-roof composite" },
    { label: "Safety flags", value: totalSafety, sub: `${totalMissed} required nodes missed` }
  ];

  app().innerHTML = `
    <section class="overview">
      ${tiles.map((tile) => `
        <div class="statTile">
          <div class="statLabel">${tile.label}</div>
          <div class="statValue">${tile.value}</div>
          <div class="statSub">${tile.sub}</div>
        </div>`).join("")}
    </section>

    <section class="band">
      <div class="sectionHeader">
        <div>
          <h2>Runs</h2>
          <p class="sectionHint">One row per model &times; scenario. Click a run to open the full breakdown.</p>
        </div>
        <div class="filters">
          <label>Model <select id="filterModel"></select></label>
          <label>Scenario <select id="filterScenario"></select></label>
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
  renderRunList();
  renderValidation();
  wireValidationToggle();
}

function renderFilters() {
  const modelOptions = ['<option value="all">All models</option>']
    .concat(state.data.comparison.models.map((model) =>
      `<option value="${model.model_config.id}">${model.model_config.label}</option>`));
  const scenarioOptions = ['<option value="all">All scenarios</option>']
    .concat(state.data.personas.map((persona) =>
      `<option value="${persona.id}">${persona.label}</option>`));

  const modelSelect = $("filterModel");
  modelSelect.innerHTML = modelOptions.join("");
  modelSelect.value = state.filterModel;
  modelSelect.onchange = (event) => {
    state.filterModel = event.target.value;
    renderRunList();
  };

  const scenarioSelect = $("filterScenario");
  scenarioSelect.innerHTML = scenarioOptions.join("");
  scenarioSelect.value = state.filterScenario;
  scenarioSelect.onchange = (event) => {
    state.filterScenario = event.target.value;
    renderRunList();
  };
}

function miniChip(key, value, run) {
  if (key === "noise_penalty") {
    const noise = noiseState(run);
    if (!noise.applied) {
      return `
        <span class="miniChip" title="Noise penalty disabled — ${noise.flags} flag(s) detected but not subtracted">
          <span class="dot off"></span>
          <span class="k">Noise</span>
          <span class="v">${score(noise.raw)}</span>
          <span class="k">off</span>
        </span>`;
    }
  }
  const level = levelFor(key, value);
  return `
    <span class="miniChip" title="${METRIC_INFO[key].def}">
      <span class="dot ${level}"></span>
      <span class="k">${METRIC_INFO[key].label}</span>
      <span class="v">${score(value)}</span>
    </span>`;
}

function runFlagPills(run) {
  const missed = (run.score.details.missed_required_nodes || []).length;
  const safety = (run.score.details.safety_flags || []).length;
  const noise = (run.score.details.noise_flags || []).length;
  const pills = [];
  pills.push(missed
    ? `<span class="flagPill alert">${missed} missed</span>`
    : `<span class="flagPill clean">0 missed</span>`);
  if (safety) pills.push(`<span class="flagPill alert">${safety} safety</span>`);
  if (noise) pills.push(`<span class="flagPill">${noise} noise</span>`);
  return pills.join("");
}

function renderRunList() {
  const runs = visibleRuns();
  const list = $("runList");
  if (!runs.length) {
    list.innerHTML = `<div class="empty">No runs match the current filters.</div>`;
    return;
  }

  list.innerHTML = runs.map((run) => {
    const headLevel = compositeLevel(run.score.bottom_to_roof_score);
    return `
      <a class="runRow" href="#/run/${encodeURIComponent(run.run_id)}">
        <div class="runIdent">
          <div>
            <div class="runModel">
              ${run.model_config.label}
              <span class="provider">${run.model_config.provider}</span>
            </div>
            <div class="runScenario">${run.scenario.label}</div>
          </div>
        </div>
        <div class="headline">
          <span class="headlineValue ${headLevel}">${score(run.score.bottom_to_roof_score)}</span>
          <span class="headlineMeta">Bottom&#8209;to&#8209;roof</span>
        </div>
        <div class="miniMetrics">
          ${METRIC_ORDER.map((key) => miniChip(key, run.score[key], run)).join("")}
        </div>
        <div class="runFlags">${runFlagPills(run)}</div>
        <span class="rowGo" aria-hidden="true">&#9656;</span>
      </a>`;
  }).join("");
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
        ["Self-consistency", validation.self_consistency]
      ].map(([label, value]) =>
        `<div class="metricBox"><strong>${label}</strong><span>${score(value)}</span></div>`).join("")}
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

  const headLevel = compositeLevel(run.score.bottom_to_roof_score);
  app().innerHTML = `
    <a class="backLink" href="#/">&#8592; Back to all runs</a>
    <section class="band detailHeader">
      <div class="detailTitle">
        <div class="runModel">
          ${run.model_config.label}
          <span class="provider">${run.model_config.provider}</span>
        </div>
        <div class="runScenario">${run.scenario.label}</div>
      </div>
      <div class="detailScore">
        <span class="headlineValue ${headLevel}">${score(run.score.bottom_to_roof_score)}</span>
        <span class="headlineMeta">Bottom&#8209;to&#8209;roof composite</span>
      </div>
      <div class="runFlags">${runFlagPills(run)}</div>
    </section>
    ${renderRunBody(run)}
  `;
  window.scrollTo(0, 0);
}

function renderRunBody(run) {
  return `
    <div class="runBody detailBody">
      <div class="detailGrid">
        <div class="subPanel">
          <h3>Score breakdown</h3>
          <div class="subPanelHint">How the composite score is built, and what each metric means for this run.</div>
          ${renderScoreBreakdown(run)}
        </div>
        <div class="subPanel">
          <h3>Score progression</h3>
          <div class="subPanelHint">Running composite score after each turn.</div>
          ${renderProgression(run)}
          <h3 style="margin-top:16px">Missed high-priority nodes</h3>
          ${renderMissed(run)}
        </div>
      </div>
      <div class="detailGrid">
        <div class="subPanel">
          <h3>Hierarchy audit</h3>
          <div class="subPanelHint">Every hierarchy node and how it was (or was not) surfaced.</div>
          ${renderHierarchy(run)}
        </div>
        <div class="subPanel">
          <h3>Safety &amp; noise flags</h3>
          <div class="subPanelHint">Evaluator-detected issues that moved the score.</div>
          ${renderFlags(run)}
          <h3 style="margin-top:16px">Run metadata</h3>
          ${renderMetadata(run)}
        </div>
      </div>
      <div class="subPanel">
        <h3>Transcript evidence</h3>
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

function renderProgression(run) {
  const progression = run.progression || [];
  if (!progression.length) return `<div class="empty">No progression recorded.</div>`;
  const maxScore = Math.max(1, ...progression.map((item) => item.score));
  return `<div class="progression">${progression.map((item) => {
    const height = Math.max(8, (item.score / maxScore) * 130);
    return `<div class="bar" style="height:${height}px"><span>${score(item.score)}</span></div>`;
  }).join("")}</div>`;
}

function renderMissed(run) {
  const missed = (run.score.details.missed_required_nodes || [])
    .map((nodeId) => state.data.hierarchy.nodes.find((node) => node.id === nodeId))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);
  if (!missed.length) {
    return `<div class="empty">No required hierarchy nodes missed in this run.</div>`;
  }
  return `<div class="stackGrid">${missed.map((node) => {
    const tier = node.risk_tier || "low";
    return `<div class="metricBox"><strong>${node.label}</strong><span>Rank ${node.rank} &middot; <span class="tierTag ${tier}">${tier}</span></span></div>`;
  }).join("")}</div>`;
}

function renderHierarchy(run) {
  return `<div class="hierarchyList">${run.attributions.map((node) => {
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
  }).join("")}</div>`;
}

function renderFlags(run) {
  const flags = [
    ...(run.score.details.safety_flags || []).map((flag) => ["Safety", flag, "alert"]),
    ...(run.score.details.noise_flags || []).map((flag) => ["Noise", flag, ""])
  ];
  if (!flags.length) {
    return `<div class="empty">No safety or noise flags for this run.</div>`;
  }
  return `<div class="stackGrid">${flags.map(([kind, flag]) =>
    `<div class="metricBox"><strong>${kind}</strong><span>${flag}</span></div>`).join("")}</div>`;
}

function renderMetadata(run) {
  const meta = [
    ["Run id", run.run_id],
    ["Model", `${run.model_config.provider}/${run.model_config.model}`],
    ["Temperature", run.sampling_settings?.temperature ?? "—"],
    ["Max tokens", run.sampling_settings?.max_tokens ?? "—"],
    ["Rubric version", run.versions?.evaluator_rubric_version ?? "—"]
  ];
  return `<div class="stackGrid">${meta.map(([label, value]) =>
    `<div class="metricBox"><strong>${label}</strong><span>${value}</span></div>`).join("")}</div>`;
}

function labelTagsForTurn(run, turn, speaker) {
  const label = run.evidence.labels.find((candidate) => candidate.turn === turn);
  if (!label) return "";
  const tags = [];
  if (speaker === "assistant") {
    tags.push(...label.model_elicited_nodes.map((nodeId) => ["model_elicited", `Elicited ${labelForNode(nodeId)}`]));
    tags.push(...label.model_elicited_followups.map((followup) => ["partially_covered", `Follow-up ${followup}`]));
    tags.push(...label.safety_flags.map((flag) => ["missed", `Safety ${flag}`]));
    tags.push(...label.noise_flags.map((flag) => ["context_provided", `Noise ${flag}`]));
  } else {
    tags.push(...label.patient_volunteered_nodes.map((nodeId) => ["patient_volunteered", `Volunteered ${labelForNode(nodeId)}`]));
    tags.push(...label.context_provided_nodes.map((nodeId) => ["context_provided", `Context ${labelForNode(nodeId)}`]));
  }
  return tags.length
    ? `<div class="evidenceTags">${tags.map(([cls, text]) => `<span class="pill ${cls}">${text}</span>`).join("")}</div>`
    : "";
}

function renderTranscript(run) {
  return `<div class="transcript">${run.events.map((event) => `
    <div class="message ${event.speaker}">
      <div class="speaker">${event.speaker} &middot; turn ${event.turn}</div>
      <div class="messageText">${event.text}</div>
      ${labelTagsForTurn(run, event.turn, event.speaker)}
    </div>
  `).join("")}</div>`;
}

/* =====================================================================
   Router
   ===================================================================== */
function route() {
  const hash = window.location.hash || "#/";
  const runMatch = hash.match(/^#\/run\/(.+)$/);
  if (runMatch) {
    renderDetailPage(decodeURIComponent(runMatch[1]));
  } else {
    renderListPage();
  }
}

/* ---------- Init ---------- */
async function init() {
  const response = await fetch("/api/results");
  state.data = await response.json();
  renderStatus();
  window.addEventListener("hashchange", route);
  route();
}

init().catch((error) => {
  document.body.innerHTML = `<pre style="padding:20px;color:#f87171">${error.stack || error.message}</pre>`;
});
