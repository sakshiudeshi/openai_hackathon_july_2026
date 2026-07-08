import { nodeAppliesToPatient } from "./scoring.js";

const SCORE_FIELDS = [
  "bottom_to_roof_score",
  "coverage_score",
  "priority_score",
  "depth_score"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function isRunId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9]{12}$/.test(value)
    && /[A-Za-z]/.test(value)
    && /\d/.test(value);
}

export function validateRunResultShape(result) {
  assert(result && typeof result === "object", "Run result must be an object");
  assert(isRunId(result.run_id), "Run result needs a 12-character alphanumeric run_id");
  assert(result.model_config?.provider, "Run result needs model_config.provider");
  assert(result.model_config?.model, "Run result needs model_config.model");
  assert(result.scenario?.id, "Run result needs scenario.id");
  assert(Array.isArray(result.events), "Run result needs events array");
  assert(result.events.length > 0, "Run result must contain events");
  assert(result.events[0].speaker === "patient", "First event must be the patient opening prompt");
  assert(result.evidence?.summary, "Run result needs evidence summary");
  assert(Array.isArray(result.evidence.labels), "Run result needs evaluator labels");
  assert(result.score && typeof result.score === "object", "Run result needs score");
  assert(Array.isArray(result.attributions), "Run result needs attributions");
  assert(Array.isArray(result.progression), "Run result needs score progression");

  for (const field of SCORE_FIELDS) {
    assert(Number.isFinite(result.score[field]), `Score field ${field} must be finite`);
  }

  for (const event of result.events) {
    assert(event.run_id === result.run_id, "Each event run_id must match the parent run");
    assert(Number.isInteger(event.turn), "Each event needs integer turn");
    assert(["patient", "assistant", "system"].includes(event.speaker), "Each event needs a valid speaker");
    assert(typeof event.text === "string", "Each event needs text");
    assert(typeof event.timestamp === "string", "Each event needs timestamp");
  }

  return true;
}

export function validateComparisonShape(comparison) {
  assert(comparison && typeof comparison === "object", "Comparison must be an object");
  assert(typeof comparison.generated_at === "string", "Comparison needs generated_at");
  assert(Array.isArray(comparison.models), "Comparison needs models array");
  assert(Array.isArray(comparison.runs), "Comparison needs runs array");
  assert(comparison.models.length > 0, "Comparison must contain models");
  assert(comparison.runs.length > 0, "Comparison must contain runs");

  for (const model of comparison.models) {
    assert(model.model_config?.id, "Each comparison model needs model_config.id");
    assert(Array.isArray(model.runs), "Each comparison model needs runs");
    for (const field of SCORE_FIELDS) {
      assert(Number.isFinite(model.score[field]), `Model average ${field} must be finite`);
    }
  }

  for (let index = 1; index < comparison.models.length; index += 1) {
    const previous = comparison.models[index - 1].score.bottom_to_roof_score;
    const current = comparison.models[index].score.bottom_to_roof_score;
    assert(previous >= current, "Comparison models must be sorted by bottom-to-roof score");
  }

  for (const run of comparison.runs) validateRunResultShape(run);

  return true;
}

export function validateAuditInvariants(hierarchy, run) {
  const contextProvided = new Set(run.evidence.summary.context_provided_nodes || []);
  // Mirror the scorer's gender-gating: a gender_flagged node (e.g. pregnancy) is
  // only an eligible required node for a patient of the matching sex.
  const patientSex = run.scenario?.patient_sex ?? null;
  const eligibleRequired = hierarchy.nodes
    .filter((node) => node.required && !contextProvided.has(node.id) && nodeAppliesToPatient(node, patientSex))
    .map((node) => node.id)
    .sort();
  const scoredEligible = [...run.score.details.eligible_required_nodes].sort();
  assert(
    JSON.stringify(eligibleRequired) === JSON.stringify(scoredEligible),
    "Score eligible nodes must match required nodes minus context-provided nodes"
  );

  const attributions = new Set(run.attributions.map((node) => node.node_id));
  for (const node of hierarchy.nodes) {
    assert(attributions.has(node.id), `Missing attribution for node ${node.id}`);
  }

  // A required fact counts as covered once it is *obtained* — whether the model
  // elicited it or the patient volunteered it (see scoreRun's `obtained` set). So
  // any volunteered node that is an eligible required node must appear as covered.
  const eligibleRequiredSet = new Set(eligibleRequired);
  const coveredRequired = new Set(run.score.details.covered_required_nodes || []);
  for (const nodeId of run.evidence.summary.patient_volunteered_nodes || []) {
    if (!eligibleRequiredSet.has(nodeId)) continue;
    assert(
      coveredRequired.has(nodeId),
      `Patient-volunteered required node ${nodeId} must count as covered`
    );
  }

  return true;
}
