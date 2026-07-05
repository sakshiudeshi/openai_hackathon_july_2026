const state = {
  data: null,
  selectedModelId: null,
  selectedScenarioId: null
};

const $ = (id) => document.getElementById(id);

function score(value) {
  return Number(value || 0).toFixed(3);
}

function labelForNode(nodeId) {
  const node = state.data.hierarchy.nodes.find((candidate) => candidate.id === nodeId);
  return node?.label || nodeId;
}

function selectedModel() {
  return state.data.comparison.models.find((model) => model.model_config.id === state.selectedModelId);
}

function selectedRun() {
  return selectedModel().runs.find((run) => run.scenario.id === state.selectedScenarioId);
}

function renderValidation() {
  const validation = state.data.validation;
  const badge = $("validationBadge");
  badge.textContent = validation.passed ? "Validation passed" : "Validation failed";
  badge.className = `badge ${validation.passed ? "pass" : "fail"}`;

  const metrics = validation.aggregate;
  $("validationDetails").innerHTML = [
    ["Model-elicited precision", metrics.model_elicited_nodes.precision],
    ["Model-elicited recall", metrics.model_elicited_nodes.recall],
    ["Volunteered precision", metrics.patient_volunteered_nodes.precision],
    ["Volunteered recall", metrics.patient_volunteered_nodes.recall],
    ["Safety precision", metrics.safety_flags.precision],
    ["Safety recall", metrics.safety_flags.recall],
    ["Self-consistency", validation.self_consistency]
  ].map(([label, value]) => `
    <div class="metricBox">
      <strong>${label}</strong>
      <span>${score(value)}</span>
    </div>
  `).join("");
}

function renderControls() {
  $("scenarioSelect").innerHTML = state.data.personas.map((persona) => {
    return `<option value="${persona.id}">${persona.label}</option>`;
  }).join("");
  $("scenarioSelect").value = state.selectedScenarioId;
  $("scenarioSelect").addEventListener("change", (event) => {
    state.selectedScenarioId = event.target.value;
    renderAll();
  });

  $("modelSelect").innerHTML = state.data.comparison.models.map((model) => {
    return `<option value="${model.model_config.id}">${model.model_config.label}</option>`;
  }).join("");
  $("modelSelect").value = state.selectedModelId;
  $("modelSelect").addEventListener("change", (event) => {
    state.selectedModelId = event.target.value;
    renderAll();
  });
}

function renderTable() {
  $("modelRows").innerHTML = state.data.comparison.models.map((model) => {
    const selected = model.model_config.id === state.selectedModelId ? "selected" : "";
    return `
      <tr class="${selected}">
        <td><button class="modelButton" data-model="${model.model_config.id}">${model.model_config.label}</button></td>
        <td>${score(model.score.bottom_to_roof_score)}</td>
        <td>${score(model.score.coverage_score)}</td>
        <td>${score(model.score.priority_score)}</td>
        <td>${score(model.score.depth_score)}</td>
        <td>${score(model.score.safety_score)}</td>
        <td>${score(model.score.noise_penalty)}</td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll("[data-model]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedModelId = button.dataset.model;
      $("modelSelect").value = state.selectedModelId;
      renderAll();
    });
  });
}

function renderHierarchy() {
  const run = selectedRun();
  $("hierarchyList").innerHTML = run.attributions.map((node) => {
    const tier = node.risk_tier || "low";
    const followups = node.followups.length
      ? `Follow-ups: ${node.followups.join(", ")}`
      : "No follow-ups elicited";
    return `
      <div class="nodeRow">
        <div class="rank">${node.rank}</div>
        <div>
          <div class="nodeTitle">${node.label}</div>
          <div class="nodeMeta">${node.required ? "Required" : "Optional"} · ${tier} tier · ${followups}</div>
        </div>
        <span class="pill ${node.attribution}">${node.attribution.replaceAll("_", " ")}</span>
      </div>
    `;
  }).join("");
}

function renderProgression() {
  const run = selectedRun();
  const maxScore = Math.max(1, ...run.progression.map((item) => item.score));
  $("progression").innerHTML = run.progression.map((item) => {
    const height = Math.max(8, (item.score / maxScore) * 140);
    return `<div class="bar" style="height:${height}px"><span>${score(item.score)}</span></div>`;
  }).join("");

  const missed = run.score.details.missed_required_nodes
    .map((nodeId) => state.data.hierarchy.nodes.find((node) => node.id === nodeId))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);
  $("missedNodes").innerHTML = missed.length
    ? missed.map((node) => {
      const tier = node.risk_tier || "low";
      return `<div class="metricBox"><strong>${node.label}</strong><span>Rank ${node.rank} · ${tier} tier</span></div>`;
    }).join("")
    : `<div class="empty">No required hierarchy nodes missed in this scenario.</div>`;
}

function labelTagsForTurn(run, turn, speaker) {
  const label = run.evidence.labels.find((candidate) => candidate.turn === turn);
  if (!label) return "";
  const tags = [];
  if (speaker === "assistant") {
    tags.push(...label.model_elicited_nodes.map((nodeId) => `Elicited ${labelForNode(nodeId)}`));
    tags.push(...label.model_elicited_followups.map((followup) => `Follow-up ${followup}`));
    tags.push(...label.safety_flags.map((flag) => `Safety ${flag}`));
    tags.push(...label.noise_flags.map((flag) => `Noise ${flag}`));
  } else {
    tags.push(...label.patient_volunteered_nodes.map((nodeId) => `Volunteered ${labelForNode(nodeId)}`));
    tags.push(...label.context_provided_nodes.map((nodeId) => `Context ${labelForNode(nodeId)}`));
  }
  return tags.length
    ? `<div class="evidenceTags">${tags.map((tag) => `<span class="pill context_provided">${tag}</span>`).join("")}</div>`
    : "";
}

function renderTranscript() {
  const run = selectedRun();
  $("transcript").innerHTML = run.events.map((event) => `
    <div class="message ${event.speaker}">
      <div class="speaker">${event.speaker} · turn ${event.turn}</div>
      <div class="messageText">${event.text}</div>
      ${labelTagsForTurn(run, event.turn, event.speaker)}
    </div>
  `).join("");
}

function renderFlags() {
  const run = selectedRun();
  const flags = [
    ...run.score.details.safety_flags.map((flag) => ["Safety", flag]),
    ...run.score.details.noise_flags.map((flag) => ["Noise", flag])
  ];
  $("flags").innerHTML = flags.length
    ? flags.map(([kind, flag]) => `<div class="metricBox"><strong>${kind}</strong><span>${flag}</span></div>`).join("")
    : `<div class="empty">No safety or noise flags for this run.</div>`;
}

function renderAll() {
  renderTable();
  renderHierarchy();
  renderProgression();
  renderTranscript();
  renderFlags();
}

async function init() {
  const response = await fetch("/api/demo");
  state.data = await response.json();
  state.selectedModelId = state.data.comparison.models[0].model_config.id;
  state.selectedScenarioId = state.data.personas[0].id;
  renderValidation();
  renderControls();
  renderAll();
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
