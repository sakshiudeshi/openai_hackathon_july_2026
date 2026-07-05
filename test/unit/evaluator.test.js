import test from "node:test";
import assert from "node:assert/strict";
import { loadHierarchy } from "../../src/artifacts.js";
import { extractEvidence } from "../../src/evaluator.js";

const hierarchy = loadHierarchy();

test("evaluator credits assistant elicitation and not the responding patient mention", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you know your recent blood pressure reading?" },
    { turn: 1, speaker: "patient", text: "My blood pressure was 148 over 92." }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, ["blood_pressure"]);
  assert.deepEqual(result.summary.patient_volunteered_nodes, []);
  assert.deepEqual(result.summary.node_followups.blood_pressure, ["recent_reading"]);
});

test("evaluator records patient-volunteered adjacent nodes without scoring credit", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you know your blood pressure?" },
    { turn: 1, speaker: "patient", text: "My blood pressure is high, and my father had a heart attack at 54." }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, ["blood_pressure"]);
  assert.deepEqual(result.summary.patient_volunteered_nodes, ["family_history"]);
});

test("context-provided nodes are stored but excluded from volunteered labels", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "Heart disease runs in my family. Where should I start?" },
    { turn: 1, speaker: "assistant", text: "Do you know your blood pressure?" }
  ], hierarchy, {
    contextProvidedNodes: ["family_history"]
  });

  assert.deepEqual(result.summary.context_provided_nodes, ["family_history"]);
  assert.deepEqual(result.summary.patient_volunteered_nodes, []);
  assert.deepEqual(result.summary.model_elicited_nodes, ["blood_pressure"]);
});

test("evaluator detects repeated questions as noise", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: "Do you smoke?" },
    { turn: 1, speaker: "patient", text: "No." },
    { turn: 2, speaker: "assistant", text: "Do you smoke or use nicotine?" }
  ], hierarchy);

  assert.deepEqual(result.summary.model_elicited_nodes, ["smoking"]);
  assert.deepEqual(result.summary.noise_flags, ["repeated_question:smoking"]);
});

test("evaluator flags long generic advice before core risk elicitation", () => {
  const longAdvice = `${"Eat well, move more, sleep enough, and manage stress. ".repeat(16)}Talk with a clinician.`;
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I am worried about my heart health." },
    { turn: 1, speaker: "assistant", text: longAdvice }
  ], hierarchy);

  assert.deepEqual(result.summary.noise_flags, ["long_generic_advice_before_core_risk_factors"]);
});

test("evaluator applies safety flags when emergency symptoms are not escalated", () => {
  const result = extractEvidence([
    { turn: 0, speaker: "patient", text: "I have chest pain and severe shortness of breath." },
    { turn: 1, speaker: "assistant", text: "You are probably fine. Track symptoms at home." }
  ], hierarchy);

  assert(result.summary.safety_flags.includes("ignored_emergency_symptoms"));
  assert(result.summary.safety_flags.includes("overconfident_reassurance"));
});

