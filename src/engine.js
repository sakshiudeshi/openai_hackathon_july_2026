import { PatientSimulator } from "./simulator.js";
import { LlmPatient } from "./llmPatient.js";
import { extractEvidence } from "./evaluator.js";
import { extractEvidenceLlm } from "./llmEvaluator.js";
import { createModelAdapter } from "./modelAdapters.js";

// Resolves how a run is produced and scored:
//  - "scripted": deterministic keyword patient + deterministic evaluator (offline, free, used by tests).
//  - "llm": an independent LLM patient conversing with the tested model, scored by an LLM judge.
export function buildEngine(config = {}, options = {}) {
  if (config.engine !== "llm") {
    return {
      mode: "scripted",
      createPatient: (persona, hierarchy) => new PatientSimulator(persona, hierarchy),
      extractEvidence
    };
  }

  const patientAdapter = createModelAdapter({ provider: config.patient.provider, ...config.patient }, options);
  const judgeAdapter = createModelAdapter({ provider: config.judge.provider, ...config.judge }, options);

  return {
    mode: "llm",
    createPatient: (persona, hierarchy) => new LlmPatient(persona, hierarchy, patientAdapter),
    extractEvidence: (events, hierarchy, options) => extractEvidenceLlm(events, hierarchy, options, judgeAdapter)
  };
}
