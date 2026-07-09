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

// Uniform random integer in [0, max) via rejection sampling over random bytes.
// Uses Web Crypto (`crypto.getRandomValues`), which is a global in both Node 20+
// and Cloudflare Workers, so run-id generation needs no `node:crypto` and works
// unchanged in a Pages Function. Rejecting bytes at/above the largest multiple of
// `max` keeps the distribution unbiased.
function randomIndex(max) {
  const limit = Math.floor(256 / max) * max;
  const buffer = new Uint8Array(1);
  let value;
  do {
    globalThis.crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
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
      runId += RUN_ID_ALPHABET[randomIndex(RUN_ID_ALPHABET.length)];
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
  scoreOptions = {},
  // Provider API keys for the tested-model adapter, as a plain object
  // ({ OPENAI_API_KEY, ... }). Defaults (undefined) let createModelAdapter fall
  // back to process.env, so Node callers are unchanged; a Cloudflare Worker —
  // where process.env is empty — passes its `env` binding through here.
  apiKeys = undefined,
  // Optional per-turn hook, fired at the START of each turn (before the tested
  // model is called) so callers can render live turn-by-turn progress. No-op by
  // default, keeping the existing runComparison path unchanged.
  onTurn = null,
  // Optional per-event hook, fired right AFTER each event (opening, assistant,
  // patient) is recorded, so a streaming caller can push it to the client as it
  // happens. No-op by default. Awaited so a slow writer applies backpressure.
  onEvent = null
}) {
  const runId = makeRunId();
  const simulator = createPatient(persona, hierarchy);
  const adapter = createModelAdapter(modelConfig, { apiKeys });
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
  await onEvent?.(opening);

  // Wall-clock timing so a saved run shows where its seconds went: per-turn
  // tested-model vs patient latency, plus the judge call and the total. The
  // event timestamps alone can't reveal judge time (the judge runs after the
  // last event), which is usually the single biggest call.
  const runStartedAt = Date.now();
  const turnTimings = [];

  let stopReason = "turn_limit_reached";
  let assistantTurns = 0;
  for (let turn = 1; turn <= turnLimit; turn += 1) {
    onTurn?.({ runId, persona, modelConfig, turn, turnLimit });
    const modelStartedAt = Date.now();
    const completion = await adapter.complete(toProviderMessages(systemPrompt, events));
    const modelMs = Date.now() - modelStartedAt;
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
    await onEvent?.(assistantEvent);
    assistantTurns += 1;

    // `events` is the single source of truth for the transcript: it already
    // includes this turn's assistant message, so the patient reads the exact
    // recorded conversation rather than keeping a parallel copy. The scripted
    // PatientSimulator ignores the second argument.
    const patientStartedAt = Date.now();
    const simulatorResponse = await simulator.answer(completion.text, events);
    const patientMs = Date.now() - patientStartedAt;
    turnTimings.push({ turn, model_ms: modelMs, patient_ms: patientMs });
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
    await onEvent?.(patientEvent);

    // The patient can end the conversation once it has nothing left to ask or
    // share, rather than being forced to fill every remaining turn (which is
    // what produced degenerate replies like restating "I'm 61, male").
    if (simulatorResponse.done) {
      stopReason = "patient_ended";
      break;
    }
  }

  const judgeStartedAt = Date.now();
  const evidence = await extractEvidenceFn(events, hierarchy, {
    contextProvidedNodes: persona.context_provided_nodes || []
  });
  const judgeMs = Date.now() - judgeStartedAt;
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
    },
    // Where the seconds went. model/patient totals are the sums of per-turn
    // latency; judge_ms is the single post-conversation judge call. The gap
    // between total_ms and (model+patient+judge) is scoring/overhead and, under
    // concurrency, time this run spent waiting on shared rate-limit backoff.
    timings: {
      total_ms: Date.now() - runStartedAt,
      model_ms_total: turnTimings.reduce((sum, t) => sum + t.model_ms, 0),
      patient_ms_total: turnTimings.reduce((sum, t) => sum + t.patient_ms, 0),
      judge_ms: judgeMs,
      turns: turnTimings
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
        coverage_efficiency_score: 0
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
