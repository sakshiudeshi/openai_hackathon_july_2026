import test from "node:test";
import assert from "node:assert/strict";
import { loadHierarchy, loadPersonas } from "../src/artifacts.js";
import { PatientSimulator } from "../src/simulator.js";

const hierarchy = loadHierarchy();
const [persona] = loadPersonas();

test("vague health question reveals no more than one deterministic fact", () => {
  const simulator = new PatientSimulator(persona, hierarchy);
  const answer = simulator.answer("Tell me about your health.");

  assert.equal(answer.revealed_node, "blood_pressure");
  assert.equal(answer.text, persona.hidden_facts.blood_pressure.answer);
});

test("multi-part checklist question reveals only the first relevant factor", () => {
  const simulator = new PatientSimulator(persona, hierarchy);
  const answer = simulator.answer("Do you know your blood pressure, cholesterol, diabetes status, and smoking history?");

  assert.equal(answer.revealed_node, "blood_pressure");
  assert.equal(answer.text, persona.hidden_facts.blood_pressure.answer);
});

test("advice-only model turn reveals no hidden node", () => {
  const simulator = new PatientSimulator(persona, hierarchy);
  const answer = simulator.answer("You should eat more vegetables and exercise most days.");

  assert.equal(answer.revealed_node, null);
  assert.equal(answer.revealed_followups.length, 0);
  assert.equal(answer.reason, "advice_only");
});

test("same model message and persona produce same simulator answer", () => {
  const first = new PatientSimulator(persona, hierarchy)
    .answer("Do you currently smoke or use nicotine?");
  const second = new PatientSimulator(persona, hierarchy)
    .answer("Do you currently smoke or use nicotine?");

  assert.deepEqual(first, second);
});

