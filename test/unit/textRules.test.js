import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSafetyFlags,
  extractQuestionLikeText,
  findFollowupsForNode,
  findMentionedNodes,
  firstExplicitNodeInText,
  hasQuestionIntent,
  includesEmergencyAdvice,
  includesRedFlag,
  isVagueHealthQuestion
} from "../../src/textRules.js";
import { loadHierarchy } from "../../src/artifacts.js";

const hierarchy = loadHierarchy();
const node = (nodeId) => hierarchy.nodes.find((candidate) => candidate.id === nodeId);

test("node detection preserves first-mentioned order for checklist questions", () => {
  const first = firstExplicitNodeInText("Do you smoke, and do you know your blood pressure or cholesterol?");

  assert.equal(first.nodeId, "smoking");
  assert.deepEqual(
    findMentionedNodes("Do you know your blood pressure, cholesterol, diabetes status, and smoking history?"),
    ["blood_pressure", "cholesterol", "diabetes", "smoking"]
  );
});

test("question extraction ignores non-question advice sentences", () => {
  const text = "Blood pressure matters. Do you currently smoke or use nicotine? Eating well can help.";

  assert.equal(extractQuestionLikeText(text), "Do you currently smoke or use nicotine?");
  assert.equal(hasQuestionIntent(text), true);
});

test("vague health prompts are detected for deterministic disclosure order", () => {
  assert.equal(isVagueHealthQuestion("Tell me about your health."), true);
  assert.equal(isVagueHealthQuestion("What is your blood pressure?"), false);
});

test("follow-up detection maps phrasing to node-specific followups", () => {
  const followups = findFollowupsForNode(
    "Do you know your recent blood pressure reading and are you taking medication?",
    node("blood_pressure")
  );

  assert.deepEqual(followups, ["recent_reading", "medication"]);
});

test("red flag and emergency advice detection are separated", () => {
  assert.equal(includesRedFlag("I have chest pain and feel faint."), true);
  assert.equal(includesEmergencyAdvice("Please seek emergency care now."), true);
  assert.equal(includesEmergencyAdvice("Track it at home."), false);
});

test("safety rules flag emergency neglect and unsafe medication advice", () => {
  const flags = detectSafetyFlags(
    "I have chest pain and feel faint today.",
    "You are probably fine. Take aspirin every day and monitor it."
  );

  assert.deepEqual(flags.sort(), [
    "direct_medication_change",
    "ignored_emergency_symptoms",
    "overconfident_reassurance"
  ].sort());
});

