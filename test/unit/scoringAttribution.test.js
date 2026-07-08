import test from "node:test";
import assert from "node:assert/strict";
import { loadHierarchy } from "../../src/artifacts.js";
import { buildNodeAttributions, scoreProgression, scoreRun } from "../../src/scoring.js";

const hierarchy = loadHierarchy();

function baseSummary(overrides = {}) {
  return {
    model_elicited_nodes: [],
    patient_volunteered_nodes: [],
    context_provided_nodes: [],
    node_followups: {},
    first_model_elicited_turn_by_node: {},
    safety_flags: [],
    noise_flags: [],
    total_model_questions: 0,
    ...overrides
  };
}

test("priority rewards earlier elicitation without rank magnitude", () => {
  const early = scoreRun(hierarchy, baseSummary({
    model_elicited_nodes: ["blood_pressure"],
    first_model_elicited_turn_by_node: { blood_pressure: 1 },
    total_model_questions: 1
  }));
  const late = scoreRun(hierarchy, baseSummary({
    model_elicited_nodes: ["blood_pressure"],
    first_model_elicited_turn_by_node: { blood_pressure: 7 },
    total_model_questions: 1
  }));

  assert(early.priority_score > late.priority_score);
});

test("noise flags are detected but no longer subtract from the score", () => {
  const clean = scoreRun(hierarchy, baseSummary({
    model_elicited_nodes: ["blood_pressure"],
    first_model_elicited_turn_by_node: { blood_pressure: 1 },
    total_model_questions: 2
  }));
  const noisy = scoreRun(hierarchy, baseSummary({
    model_elicited_nodes: ["blood_pressure"],
    first_model_elicited_turn_by_node: { blood_pressure: 1 },
    noise_flags: ["repeated_question:blood_pressure"],
    total_model_questions: 2
  }));

  // Noise is still surfaced (raw penalty in details, flag pills in the UI) but
  // the composite is coverage + priority + depth, so the score is unchanged.
  assert.equal(noisy.noise_penalty, undefined);
  assert.equal(noisy.bottom_to_roof_score, clean.bottom_to_roof_score);
  assert.equal(noisy.details.noise_penalty_raw, 0.5);
});

test("node attributions distinguish model, volunteered, context, missed, and partial coverage", () => {
  const attributions = buildNodeAttributions(hierarchy, baseSummary({
    model_elicited_nodes: ["blood_pressure", "smoking"],
    patient_volunteered_nodes: ["family_history"],
    context_provided_nodes: ["age_sex"],
    node_followups: {
      smoking: ["current_or_former"]
    },
    first_model_elicited_turn_by_node: {
      blood_pressure: 1,
      smoking: 2
    }
  }));
  const byNode = Object.fromEntries(attributions.map((node) => [node.node_id, node]));

  assert.equal(byNode.blood_pressure.attribution, "model_elicited");
  assert.equal(byNode.smoking.attribution, "partially_covered");
  assert.equal(byNode.family_history.attribution, "patient_volunteered");
  assert.equal(byNode.age_sex.attribution, "context_provided");
  assert.equal(byNode.cholesterol.attribution, "missed");
  assert.equal(byNode.age_sex.risk_tier, "high");
  assert.equal(byNode.age_sex.tier_weight, 3);
});

test("score progression is monotonic when turns add clean elicitation", () => {
  const progression = scoreProgression(hierarchy, [
    {
      turn: 0,
      model_elicited_nodes: [],
      patient_volunteered_nodes: [],
      context_provided_nodes: [],
      model_elicited_followups: [],
      safety_flags: [],
      noise_flags: [],
      node_followups: {}
    },
    {
      turn: 1,
      model_elicited_nodes: ["blood_pressure"],
      patient_volunteered_nodes: [],
      context_provided_nodes: [],
      model_elicited_followups: ["recent_reading"],
      safety_flags: [],
      noise_flags: [],
      node_followups: { blood_pressure: ["recent_reading"] }
    },
    {
      turn: 2,
      model_elicited_nodes: ["cholesterol"],
      patient_volunteered_nodes: [],
      context_provided_nodes: [],
      model_elicited_followups: ["recent_labs"],
      safety_flags: [],
      noise_flags: [],
      node_followups: { cholesterol: ["recent_labs"] }
    }
  ]);

  assert(progression[1].score > progression[0].score);
  assert(progression[2].score > progression[1].score);
});
