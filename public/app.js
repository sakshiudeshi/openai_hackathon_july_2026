const state = {
  data: null,
  personas: null,
  filterModel: "all",
  filterScenario: "all"
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
    if (state.filterModel !== "all" && run.model_config.id !== state.filterModel) return false;
    // Group/filter patients by label, not id: the results file can carry a
    // duplicate scenario id (a persona-data bug), but labels stay distinct.
    if (state.filterScenario !== "all" && run.scenario.label !== state.filterScenario) return false;
    return true;
  });
}

// Group runs by patient (scenario label). Each patient holds every model's run
// for that scenario, ordered to match the comparison's model order (v0, v1, …).
function runsByPatient(runs) {
  const modelOrder = new Map(
    (state.data.comparison.models || []).map((model, index) => [model.model_config.id, index])
  );
  const patients = new Map();
  for (const run of runs) {
    const key = run.scenario.label;
    if (!patients.has(key)) {
      patients.set(key, { label: key, scenario: run.scenario, runs: [] });
    }
    patients.get(key).runs.push(run);
  }
  const rank = (run) => modelOrder.get(run.model_config.id) ?? Number.MAX_SAFE_INTEGER;
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
          <h2>Patients</h2>
          <p class="sectionHint">One card per patient, showing how each model run performed. Click a model to open its full breakdown.</p>
        </div>
        <div class="filters">
          <label>Model <select id="filterModel"></select></label>
          <label>Patient <select id="filterScenario"></select></label>
        </div>
      </div>
      ${renderModelSummary()}
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
  renderValidation();
  wireValidationToggle();
}

// Compact per-model averages, shown above the run list. Each model entry in
// the comparison already carries an aggregated `score`, so this is just a
// small readout of the composite (and its coverage component) per model.
function renderModelSummary() {
  const models = state.data.comparison.models || [];
  if (!models.length) return "";
  const rows = models.map((model) => {
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
  }).join("");
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
  const modelOptions = ['<option value="all">All models</option>']
    .concat(state.data.comparison.models.map((model) =>
      `<option value="${model.model_config.id}">${model.model_config.label}</option>`));
  // Patient options come from the runs' distinct scenario labels (keyed by
  // label, matching how patients are grouped) so the filter stays consistent
  // even when the results file has a duplicate scenario id.
  const patientLabels = [...new Set(allRuns().map((run) => run.scenario.label))]
    .sort((a, b) => a.localeCompare(b));
  const scenarioOptions = ['<option value="all">All patients</option>']
    .concat(patientLabels.map((label) => `<option value="${label}">${label}</option>`));

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
  list.innerHTML = patients.map((patient) => {
    const best = Math.max(...patient.runs.map((run) => run.score.bottom_to_roof_score));
    const multiModel = patient.runs.length > 1;
    const rows = patient.runs.map((run) => {
      const headLevel = compositeLevel(run.score.bottom_to_roof_score);
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

    return `
      <div class="patientCard">
        <div class="patientHead">
          <div class="patientName">${patient.scenario.label}
            <span class="patientId">${esc(patient.scenario.id)}</span>
          </div>
          <div class="patientMeta">${patient.runs.length} model run${multiModel ? "s" : ""}</div>
        </div>
        <div class="patientRuns">${rows}</div>
      </div>`;
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
        <div class="runScenario">${run.scenario.label}
          <span class="patientId">${esc(run.scenario.id)}</span>
        </div>
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
  return Boolean(persona.true_goal || persona.optional_modules || persona.schema_version);
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
  const withRedFlag = entries.filter((entry) => buriedRedFlag(entry.persona)).length;
  const tiles = [
    { label: "Patient profiles", value: entries.length, sub: "Personas in the test set" },
    { label: "Rich personas", value: rich, sub: `${entries.length - rich} flat scripted` },
    { label: "Buried red flags", value: withRedFlag, sub: "Sentinel symptoms to surface" }
  ];

  const cards = entries.map((entry) => renderPersonaCard(entry)).join("");

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
    `<span class="personaChip">${hiddenFactCount(persona)} hidden facts</span>`,
    rich
      ? `<span class="personaChip rich">rich</span>`
      : `<span class="personaChip flat">flat</span>`
  ];
  if (redFlag) chips.push(`<span class="personaChip flag">buried red flag</span>`);

  return `
    <a class="personaCard" href="#/patient/${encodeURIComponent(key)}">
      <div class="personaCardHead">
        <span class="personaNum">#${profileNumber}</span>
        <span class="personaChips">${chips.join("")}</span>
      </div>
      <div class="personaLabel">${esc(persona.label || persona.id)}</div>
      ${persona.opening_prompt ? `<div class="personaOpening">&ldquo;${esc(persona.opening_prompt)}&rdquo;</div>` : ""}
      <span class="rowGo" aria-hidden="true">&#9656;</span>
    </a>`;
}

// Renders a flat map of { key: string } into labelled boxes, skipping empty
// values and rendering nested objects (e.g. followups) as sub-lists.
function renderKeyVals(obj, skip = []) {
  const rows = Object.entries(obj || {})
    .filter(([key, value]) => !skip.includes(key) && value != null && value !== "")
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
    return obj.map((item) => esc(typeof item === "object" ? JSON.stringify(item) : item)).join("<br>");
  }
  return Object.entries(obj)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `<em>${titleize(key)}:</em> ${esc(value)}`)
    .join("<br>");
}

function renderDisclosureOrder(persona) {
  const order = persona.disclosure_order || [];
  if (!order.length) return "";
  const chips = order.map((nodeId, index) =>
    `<span class="orderChip"><span class="orderNum">${index + 1}</span>${esc(labelForNode(nodeId))}</span>`).join("");
  return `
    <div class="subPanel">
      <h3>Disclosure order</h3>
      <div class="subPanelHint">Order in which the patient volunteers topics unprompted.</div>
      <div class="orderChips">${chips}</div>
    </div>`;
}

function renderHiddenFacts(persona) {
  const facts = Object.entries(persona.hidden_facts || {});
  if (!facts.length) return `<div class="empty">No hidden facts defined.</div>`;
  return `<div class="factList">${facts.map(([nodeId, fact]) => {
    const reveal = fact.reveal_condition
      ? `<span class="factReveal">${esc(fact.reveal_condition)}</span>` : "";
    const values = fact.stated_value != null || fact.true_value != null
      ? `
        <div class="factValue"><span class="factTag stated">stated</span><span>${esc(fact.stated_value ?? "—")}</span></div>
        <div class="factValue"><span class="factTag true">true</span><span>${esc(fact.true_value ?? "—")}</span></div>`
      : `<div class="factValue"><span class="factTag answer">answer</span><span>${esc(fact.answer ?? "—")}</span></div>`;
    const withhold = fact.withhold_reason
      ? `<div class="factMeta"><em>Withheld:</em> ${esc(fact.withhold_reason)}</div>` : "";
    const followups = fact.followups && Object.keys(fact.followups).length
      ? `<div class="factMeta"><em>Follow-ups:</em><br>${renderNestedList(fact.followups)}</div>` : "";
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
  }).join("")}</div>`;
}

function renderOptionalModules(persona) {
  const modules = Object.entries(persona.optional_modules || {})
    .filter(([, value]) => value && typeof value === "object");
  if (!modules.length) return "";
  return modules.map(([name, mod]) => `
    <div class="subPanel modulecard ${name === "buried_red_flag" ? "redflag" : ""}">
      <h3>${titleize(name)}</h3>
      ${renderKeyVals(mod)}
    </div>`).join("");
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
  "answer_style"
];

function renderBehaviourProfile(persona) {
  const present = {};
  for (const field of BEHAVIOUR_FIELDS) {
    if (persona[field] != null && persona[field] !== "") present[field] = persona[field];
  }
  if (persona.red_flags && persona.red_flags.length) {
    present.red_flags = persona.red_flags.join("; ");
  }
  if (!Object.keys(present).length) return "";
  return `
    <div class="subPanel">
      <h3>Behavioural profile</h3>
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
    doorknob_reveal_condition: persona.doorknob_reveal_condition
  });

  app().innerHTML = `
    <a class="backLink" href="#/patients">&#8592; Back to patient profiles</a>
    <section class="band detailHeader personaHeader">
      <div class="detailTitle">
        <div class="runModel">
          <span class="personaNum">#${profileNumber}</span>
          <span class="personaChip ${rich ? "rich" : "flat"}">${rich ? "rich" : "flat"}</span>
        </div>
        <div class="runScenario">${esc(persona.label || persona.id)}</div>
      </div>
    </section>

    <div class="runBody detailBody">
      <div class="subPanel">
        <h3>Opening line</h3>
        <div class="personaOpeningFull">&ldquo;${esc(persona.opening_prompt || "—")}&rdquo;</div>
      </div>

      ${brief ? `
      <div class="subPanel">
        <h3>Clinical brief</h3>
        <div class="subPanelHint">What the patient really wants, fears, and is holding back.</div>
        ${brief}
      </div>` : ""}

      ${renderBehaviourProfile(persona)}
      ${renderOptionalModules(persona)}
      ${renderDisclosureOrder(persona)}

      <div class="subPanel">
        <h3>Hidden facts</h3>
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
    fetch("/api/personas").then((response) => response.json())
  ]);
  state.data = results;
  state.personas = personas;
  renderStatus();
  window.addEventListener("hashchange", route);
  route();
}

init().catch((error) => {
  document.body.innerHTML = `<pre style="padding:20px;color:#f87171">${error.stack || error.message}</pre>`;
});
