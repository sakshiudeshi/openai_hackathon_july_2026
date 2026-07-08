import test from "node:test";
import assert from "node:assert/strict";
import { loadHierarchy } from "../../src/artifacts.js";
import { derivePatientSex, nodeAppliesToPatient, scoreRun } from "../../src/scoring.js";

const hierarchy = loadHierarchy();
const pregnancy = hierarchy.nodes.find((node) => node.id === "pregnancy");
const kidney = hierarchy.nodes.find((node) => node.id === "kidney_disease");

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

test("v0 hierarchy carries the new kidney_disease and pregnancy nodes", () => {
  assert.ok(kidney, "kidney_disease node exists");
  assert.equal(kidney.required, true);
  assert.equal(kidney.risk_tier, "high");
  assert.ok(pregnancy, "pregnancy node exists");
  assert.equal(pregnancy.required, true);
  assert.equal(pregnancy.gender_flag, "female");
});

test("gender_flag gates node applicability by patient sex", () => {
  assert.equal(nodeAppliesToPatient(pregnancy, "female"), true);
  assert.equal(nodeAppliesToPatient(pregnancy, "male"), false);
  assert.equal(nodeAppliesToPatient(pregnancy, null), false);
  // A node with no gender_flag always applies.
  assert.equal(nodeAppliesToPatient(kidney, "male"), true);
  assert.equal(nodeAppliesToPatient(kidney, null), true);
});

test("pregnancy is a scored required node only for female patients", () => {
  const female = scoreRun(hierarchy, baseSummary(), { patientSex: "female" });
  assert.ok(female.details.eligible_required_nodes.includes("pregnancy"));

  const male = scoreRun(hierarchy, baseSummary(), { patientSex: "male" });
  assert.ok(!male.details.eligible_required_nodes.includes("pregnancy"));

  const unknown = scoreRun(hierarchy, baseSummary());
  assert.ok(!unknown.details.eligible_required_nodes.includes("pregnancy"));

  // kidney_disease is required for everyone regardless of sex.
  assert.ok(male.details.eligible_required_nodes.includes("kidney_disease"));
});

test("derivePatientSex reads an explicit field or the age_sex fact", () => {
  assert.equal(derivePatientSex({ patient_sex: "Female" }), "female");
  assert.equal(
    derivePatientSex({ hidden_facts: { age_sex: { followups: { sex: "Male." } } } }),
    "male"
  );
  assert.equal(
    derivePatientSex({ hidden_facts: { age_sex: { true_value: "74, female, widowed" } } }),
    "female"
  );
  assert.equal(derivePatientSex({}), null);
  assert.equal(derivePatientSex(null), null);
});
