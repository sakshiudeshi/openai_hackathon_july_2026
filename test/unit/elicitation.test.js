import test from "node:test";
import assert from "node:assert/strict";
import { loadHierarchy } from "../../src/artifacts.js";
import { extractEvidence } from "../../src/evaluator.js";
import { scoreRun } from "../../src/scoring.js";

const hierarchy = loadHierarchy();

// Elicitation = the assistant asked AND the patient disclosed a real fact in
// response. These tests pin that definition against hand-authored transcripts.

test("assistant asks and patient discloses a fact -> model_elicited", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you know your recent blood pressure reading?" },
    { turn: 1, speaker: "patient", text: "It was 148 over 92 at a pharmacy last month." }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, ["blood_pressure"]);
  assert.deepEqual(result.summary.patient_volunteered_nodes, []);
});

test("assistant asks but patient deflects -> NOT elicited", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you know your recent A1c or blood sugar?" },
    { turn: 1, speaker: "patient", text: "I don't know my recent A1c." }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, []);
  assert.deepEqual(result.summary.patient_volunteered_nodes, []);
});

test("single-node yes/no answer counts as a disclosure", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you smoke or use nicotine?" },
    { turn: 1, speaker: "patient", text: "No." }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, ["smoking"]);
});

test("patient volunteers a fact with no assistant question -> patient_volunteered", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you know your blood pressure?" },
    { turn: 1, speaker: "patient", text: "My blood pressure is fine, but my father had a heart attack at 54." }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, ["blood_pressure"]);
  assert.deepEqual(result.summary.patient_volunteered_nodes, ["family_history"]);
});

test("context-provided node is never elicited or volunteered", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "My father had an early heart attack. Where do I start?" },
    { turn: 1, speaker: "assistant", text: "Do you have a family history of heart disease?" },
    { turn: 1, speaker: "patient", text: "Yes, my father had a heart attack at 54." }
  ], hierarchy, { contextProvidedNodes: ["family_history"] });

  assert.deepEqual(result.summary.context_provided_nodes, ["family_history"]);
  assert.deepEqual(result.summary.model_elicited_nodes, []);
  assert.deepEqual(result.summary.patient_volunteered_nodes, []);
});

test("node never disclosed by anyone -> missed", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you know your blood pressure?" },
    { turn: 1, speaker: "patient", text: "It was 148 over 92 last month." }
  ], hierarchy);
  const score = scoreRun(hierarchy, result.summary);

  assert(score.details.missed_required_nodes.includes("cholesterol"));
  assert(!score.details.covered_required_nodes.includes("cholesterol"));
});

test("re-asked node discloses once -> one elicitation and no noise flag", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you know your blood pressure?" },
    { turn: 1, speaker: "patient", text: "It was 148 over 92 last month." },
    { turn: 2, speaker: "assistant", text: "Have you had your blood pressure checked recently?" },
    { turn: 2, speaker: "patient", text: "Same as I said, 148 over 92." }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, ["blood_pressure"]);
  assert.deepEqual(result.summary.noise_flags, []);
});

test("regression: reciting every risk factor with zero disclosures scores ~0 coverage", () => {
  const checklist = "To assess your heart risk: what is your blood pressure, cholesterol, "
    + "blood sugar or diabetes status, smoking, weight, physical activity, diet, family history, "
    + "age and sex, and alcohol intake?";
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: checklist },
    { turn: 1, speaker: "patient", text: "I'm not sure about any of that." }
  ], hierarchy);
  const score = scoreRun(hierarchy, result.summary);

  assert.deepEqual(result.summary.model_elicited_nodes, []);
  assert.equal(score.coverage_score, 0);
});
