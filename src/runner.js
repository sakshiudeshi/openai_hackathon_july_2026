import crypto from "node:crypto";
import { loadSystemPromptFrom } from "./artifacts.js";
import { PatientSimulator } from "./simulator.js";
import { createModelAdapter } from "./modelAdapters.js";
import { extractEvidence } from "./evaluator.js";
import { buildNodeAttributions, derivePatientSex, scoreProgression, scoreRun } from "./scoring.js";
import {
  EVALUATOR_RUBRIC_VERSION,
  SIMULATOR_POLICY_VERSION,
  TESTED_MODEL_SYSTEM_PROMPT_VERSION
} from "./versions.js";

const issuedRunIds = new Set();
const RUN_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function isoNow() {
  return new Date().toISOString();
}

// A model config may pin its own system prompt via `systemPromptPath`, letting
// the same underlying model run under different prompts as separate comparison
// entries. Configs that omit it fall back to the comparison-wide default.
export function resolveSystemPrompt(modelConfig, fallbackPrompt) {
  if (modelConfig.systemPromptPath) {
    return {
      systemPrompt: loadSystemPromptFrom(modelConfig.systemPromptPath),
      systemPromptVersion: modelConfig.systemPromptVersion || modelConfig.systemPromptPath
    };
  }
  return {
    systemPrompt: fallbackPrompt,
    systemPromptVersion: modelConfig.systemPromptVersion || TESTED_MODEL_SYSTEM_PROMPT_VERSION
  };
}

export function makeRunId(existingRunIds = issuedRunIds) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let runId = "";
    for (let index = 0; index < 12; index += 1) {
      runId += RUN_ID_ALPHABET[crypto.randomInt(0, RUN_ID_ALPHABET.length)];
    }
    if (!/[A-Za-z]/.test(runId) || !/\d/.test(runId)) continue;
    if (!existingRunIds.has(runId)) {
      existingRunIds.add(runId);
      return runId;
    }
  }
  throw new Error("Unable to allocate a unique 12-character alphanumeric run id");
}

function toProviderMessages(systemPrompt, events) {
  const messages = [{ role: "system", content: systemPrompt }];
  for (const event of events) {
    if (event.speaker === "patient") {
      messages.push({ role: "user", content: event.text });
    } else if (event.speaker === "assistant") {
      messages.push({ role: "assistant", content: event.text });
    }
  }
  return messages;
}

export async function runScenario({
  hierarchy,
  persona,
  modelConfig,
  systemPrompt,
  systemPromptVersion = TESTED_MODEL_SYSTEM_PROMPT_VERSION,
  turnLimit = 10,
  storage = null,
  createPatient = (persona_, hierarchy_) => new PatientSimulator(persona_, hierarchy_),
  extractEvidence: extractEvidenceFn = extractEvidence,
  scoreOptions = {}
}) {
  const runId = makeRunId();
  const simulator = createPatient(persona, hierarchy);
  const adapter = createModelAdapter(modelConfig);
  const events = [];

  await storage?.recordRunStarted?.({
    run_id: runId,
    hierarchy,
    persona,
    modelConfig,
    versions: {
      tested_model_system_prompt_version: systemPromptVersion,
      simulator_policy_version: SIMULATOR_POLICY_VERSION,
      evaluator_rubric_version: EVALUATOR_RUBRIC_VERSION
    }
  });

  const opening = {
    run_id: runId,
    scenario_id: persona.id,
    model: `${modelConfig.provider}/${modelConfig.model}`,
    turn: 0,
    speaker: "patient",
    text: simulator.openingEvent().text,
    timestamp: isoNow(),
    metadata: {
      context_provided_nodes: persona.context_provided_nodes || []
    }
  };
  events.push(opening);
  await storage?.recordEvent?.(opening);

  let stopReason = "turn_limit_reached";
  let assistantTurns = 0;
  for (let turn = 1; turn <= turnLimit; turn += 1) {
    const completion = await adapter.complete(toProviderMessages(systemPrompt, events));
    const assistantEvent = {
      run_id: runId,
      scenario_id: persona.id,
      model: `${modelConfig.provider}/${modelConfig.model}`,
      turn,
      speaker: "assistant",
      text: completion.text,
      timestamp: isoNow(),
      metadata: {
        usage: completion.usage,
        raw_provider_metadata: completion.raw
      }
    };
    events.push(assistantEvent);
    await storage?.recordEvent?.(assistantEvent);
    assistantTurns += 1;

    // `events` is the single source of truth for the transcript: it already
    // includes this turn's assistant message, so the patient reads the exact
    // recorded conversation rather than keeping a parallel copy. The scripted
    // PatientSimulator ignores the second argument.
    const simulatorResponse = await simulator.answer(completion.text, events);
    const patientEvent = {
      run_id: runId,
      scenario_id: persona.id,
      model: `${modelConfig.provider}/${modelConfig.model}`,
      turn,
      speaker: "patient",
      text: simulatorResponse.text,
      timestamp: isoNow(),
      revealed_node: simulatorResponse.revealed_node,
      revealed_followups: simulatorResponse.revealed_followups,
      metadata: simulatorResponse
    };
    events.push(patientEvent);
    await storage?.recordEvent?.(patientEvent);

    // The patient can end the conversation once it has nothing left to ask or
    // share, rather than being forced to fill every remaining turn (which is
    // what produced degenerate replies like restating "I'm 61, male").
    if (simulatorResponse.done) {
      stopReason = "patient_ended";
      break;
    }
  }

  const evidence = await extractEvidenceFn(events, hierarchy, {
    contextProvidedNodes: persona.context_provided_nodes || []
  });
  // Gender-gate scoring: pass the patient's sex so gender_flagged nodes (e.g.
  // pregnancy) are only required for the sex they apply to.
  const effectiveScoreOptions = { ...scoreOptions, patientSex: derivePatientSex(persona) };
  const score = scoreRun(hierarchy, evidence.summary, effectiveScoreOptions);
  const attributions = buildNodeAttributions(hierarchy, evidence.summary);
  const progression = scoreProgression(hierarchy, evidence.labels, effectiveScoreOptions);

  const result = {
    run_id: runId,
    model_config: {
      id: modelConfig.id,
      provider: modelConfig.provider,
      model: modelConfig.model,
      label: modelConfig.label || modelConfig.model,
      temperature: modelConfig.temperature ?? null,
      max_tokens: modelConfig.max_tokens ?? null
    },
    scenario: {
      id: persona.id,
      label: persona.label,
      opening_prompt: persona.opening_prompt,
      context_provided_nodes: persona.context_provided_nodes || [],
      // Carried so scoring/audit can gender-gate nodes (e.g. pregnancy) consistently.
      patient_sex: effectiveScoreOptions.patientSex
    },
    versions: {
      tested_model_system_prompt_version: systemPromptVersion,
      simulator_policy_version: simulator.policyVersion || SIMULATOR_POLICY_VERSION,
      evaluator_rubric_version: evidence.evaluator_rubric_version || EVALUATOR_RUBRIC_VERSION
    },
    sampling_settings: {
      temperature: modelConfig.temperature ?? 0.2,
      max_tokens: modelConfig.max_tokens ?? 500
    },
    events,
    evidence,
    score,
    attributions,
    progression,
    conversation: {
      stop_reason: stopReason,
      assistant_turn_count: assistantTurns,
      turn_limit: turnLimit
    }
  };

  await storage?.recordRunResult?.(result);
  return result;
}

export async function runComparison({
  hierarchy,
  personas,
  modelConfigs,
  systemPrompt,
  turnLimit = 10,
  storage = null,
  createPatient,
  extractEvidence: extractEvidenceFn,
  scoreOptions,
  onProgress = null
}) {
  const runs = [];
  const total = modelConfigs.length * personas.length;
  let completed = 0;
  for (const modelConfig of modelConfigs) {
    const resolved = resolveSystemPrompt(modelConfig, systemPrompt);
    for (const persona of personas) {
      onProgress?.({ phase: "start", completed, total, modelConfig, persona });
      const result = await runScenario({
        hierarchy,
        persona,
        modelConfig,
        systemPrompt: resolved.systemPrompt,
        systemPromptVersion: resolved.systemPromptVersion,
        turnLimit,
        storage,
        createPatient,
        extractEvidence: extractEvidenceFn,
        scoreOptions
      });
      runs.push(result);
      completed += 1;
      onProgress?.({ phase: "complete", completed, total, modelConfig, persona, result });
    }
  }
  return summarizeComparison(runs);
}

export function summarizeComparison(runs) {
  const byModel = new Map();
  for (const run of runs) {
    const key = run.model_config.id;
    const current = byModel.get(key) || {
      model_config: run.model_config,
      runs: [],
      score: {
        bottom_to_roof_score: 0,
        coverage_score: 0,
        priority_score: 0,
        depth_score: 0,
        safety_score: 0,
        noise_penalty: 0
      }
    };
    current.runs.push(run);
    byModel.set(key, current);
  }

  const models = [...byModel.values()].map((entry) => {
    for (const key of Object.keys(entry.score)) {
      const average = entry.runs.reduce((sum, run) => sum + run.score[key], 0) / entry.runs.length;
      entry.score[key] = Math.round(average * 1000) / 1000;
    }
    return entry;
  }).sort((a, b) => b.score.bottom_to_roof_score - a.score.bottom_to_roof_score);

  return {
    generated_at: isoNow(),
    models,
    runs
  };
}
