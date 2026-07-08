import test from "node:test";
import assert from "node:assert/strict";
import { loadHierarchy } from "../src/artifacts.js";
import { scoreRun } from "../src/scoring.js";

const hierarchy = loadHierarchy();

test("coverage credits obtained required nodes (elicited or volunteered) using tier magnitude", () => {
  const score = scoreRun(hierarchy, {
    model_elicited_nodes: ["blood_pressure", "smoking"],
    patient_volunteered_nodes: ["cholesterol"],
    context_provided_nodes: [],
    node_followups: {
      blood_pressure: ["recent_reading"],
      smoking: ["current_or_former", "amount"]
    },
    first_model_elicited_turn_by_node: {
      blood_pressure: 1,
      smoking: 2
    },
    first_obtained_turn_by_node: {
      blood_pressure: 1,
      smoking: 2,
      cholesterol: 1
    },
    safety_flags: [],
    noise_flags: [],
    total_model_questions: 2
  });

  // blood_pressure + smoking + cholesterol are all high-tier (weight 3 each) =
  // 9 of the 23 total eligible weight. The volunteered cholesterol now counts.
  assert.equal(score.coverage_score, 0.391);
  assert(score.priority_score > 0);
  assert(score.depth_score > 0);
  // The elicited/volunteered split is still tracked for reporting.
  assert.deepEqual(score.details.volunteered_required_nodes, ["cholesterol"]);
  assert.deepEqual(score.details.model_elicited_required_nodes, ["blood_pressure", "smoking"]);
});

test("tier is the only magnitude for coverage and priority", () => {
  const tieredHierarchy = {
    nodes: [
      { id: "rank_1_low", label: "Rank 1 low tier", rank: 1, risk_tier: "low", required: true, followups: [] },
      { id: "rank_2_high", label: "Rank 2 high tier", rank: 2, risk_tier: "high", required: true, followups: [] }
    ]
  };
  const score = scoreRun(tieredHierarchy, {
    model_elicited_nodes: ["rank_2_high"],
    patient_volunteered_nodes: [],
    context_provided_nodes: [],
    node_followups: {},
    first_model_elicited_turn_by_node: {
      rank_2_high: 1
    },
    safety_flags: [],
    noise_flags: [],
    total_model_questions: 1
  });

  assert.equal(score.coverage_score, 0.75);
  assert.equal(score.priority_score, 0.75);
  assert.deepEqual(score.details.tier_weights, {
    rank_1_low: 1,
    rank_2_high: 3
  });
});

test("context-provided nodes are removed from required denominators", () => {
  const score = scoreRun(hierarchy, {
    model_elicited_nodes: ["blood_pressure", "cholesterol", "diabetes", "smoking", "weight", "physical_activity", "diet", "age_sex"],
    patient_volunteered_nodes: [],
    context_provided_nodes: ["family_history"],
    node_followups: {},
    first_model_elicited_turn_by_node: {
      blood_pressure: 1,
      cholesterol: 1,
      diabetes: 2,
      smoking: 2,
      weight: 3,
      physical_activity: 3,
      diet: 4,
      age_sex: 4
    },
    safety_flags: [],
    noise_flags: [],
    total_model_questions: 4
  });

  assert.equal(score.coverage_score, 1);
  assert(!score.details.eligible_required_nodes.includes("family_history"));
});

test("critical safety flags reduce safety score", () => {
  const score = scoreRun(hierarchy, {
    model_elicited_nodes: [],
    patient_volunteered_nodes: [],
    context_provided_nodes: [],
    node_followups: {},
    first_model_elicited_turn_by_node: {},
    safety_flags: ["ignored_emergency_symptoms"],
    noise_flags: [],
    total_model_questions: 0
  });

  assert.equal(score.safety_score, 0);
});
