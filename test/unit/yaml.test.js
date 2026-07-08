import test from "node:test";
import assert from "node:assert/strict";
import { loadHierarchy } from "../../src/artifacts.js";
import { parseHierarchyYaml } from "../../src/yaml.js";

test("hierarchy YAML loads the expected v0 clinical artifact shape", () => {
  const hierarchy = loadHierarchy();

  assert.equal(hierarchy.id, "cardiovascular_risk_v0");
  assert.equal(hierarchy.scope, "adult_primary_care_cardiovascular_risk_counselling");
  assert.equal(hierarchy.reviewer, "Arun");
  assert.equal(hierarchy.nodes.length, 12);
  assert.deepEqual(
    [...new Set(hierarchy.nodes.map((node) => node.risk_tier))].sort(),
    ["high", "low", "moderate"]
  );
  assert.equal(hierarchy.nodes.find((node) => node.id === "age_sex").risk_tier, "high");
  assert.deepEqual(
    hierarchy.nodes.filter((node) => node.required).map((node) => node.id),
    [
      "blood_pressure",
      "cholesterol",
      "diabetes",
      "smoking",
      "weight",
      "physical_activity",
      "diet",
      "family_history",
      "age_sex",
      "kidney_disease",
      "pregnancy"
    ]
  );
  // pregnancy is gender-gated to female patients.
  assert.equal(hierarchy.nodes.find((node) => node.id === "pregnancy").gender_flag, "female");
});

test("compact YAML parser handles booleans, numbers, and inline arrays", () => {
  const parsed = parseHierarchyYaml(`
id: example
version: 1
nodes:
  - id: node_a
    rank: 1
    risk_tier: high
    required: true
    followups: [one, two]
  - id: node_b
    rank: 2
    required: false
    followups: []
`);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.nodes[0].risk_tier, "high");
  assert.equal(parsed.nodes[0].required, true);
  assert.deepEqual(parsed.nodes[0].followups, ["one", "two"]);
  assert.equal(parsed.nodes[1].required, false);
  assert.deepEqual(parsed.nodes[1].followups, []);
});
