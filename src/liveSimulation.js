// Host-agnostic driver for a single live "Try It" simulation.
//
// The Try It page lets a user pick a prompt, a tested model, and a patient
// persona, then watches a fresh LLM-patient <-> tested-model conversation play
// out turn by turn and get scored. This module owns that run and is deliberately
// transport-agnostic: it takes an `emit(row)` callback and pushes newline-
// delimited JSON rows (an opening `run_started`, one `event` per turn as it is
// produced, a final `score`, or an `error`). The Node dev server and the
// Cloudflare Pages Function each adapt their own stream to `emit`, so the
// simulation logic lives in exactly one place.

import { runScenario } from "./runner.js";
import { LlmPatient } from "./llmPatient.js";
import { createModelAdapter } from "./modelAdapters.js";
import { extractEvidenceLlm } from "./llmEvaluator.js";

// Models the Try It UI can pick as the TESTED model. Keep in sync with the
// frontend dropdown (HF_MODELS in public/app.js). Only OpenAI is wired up today;
// adding a provider here + a key is all that a new option needs.
export const LIVE_MODELS = {
  "gpt-5.5": { provider: "openai", model: "gpt-5.5", temperature: 1 },
  "gpt-5.4-mini": { provider: "openai", model: "gpt-5.4-mini", temperature: 0.2 },
};

export const DEFAULT_MODEL_ID = "gpt-5.5";

// Free-tier Cloudflare Workers cap subrequests at 50 per request. A run makes
// ~2 model calls per turn plus one judge call, so 20 turns (~41 subrequests)
// leaves headroom for the few retries the adapters may make. Bump this to 30
// once deploying on Workers Paid (1000 subrequests/request).
export const MAX_TURN_LIMIT = 20;
export const MIN_TURN_LIMIT = 3;
export const DEFAULT_TURN_LIMIT = 10;

// Patient and judge always run on the fast/cheap model: the tested model is the
// thing under evaluation, and keeping the other two calls snappy makes the live
// stream feel responsive. maxAttempts is trimmed so a transient rate-limit storm
// can't exhaust the free-tier subrequest budget mid-run.
const PATIENT_CONFIG = {
  provider: "openai",
  model: "gpt-5.4-mini",
  temperature: 1,
  max_tokens: 1000,
  maxAttempts: 2,
};
const JUDGE_CONFIG = {
  provider: "openai",
  model: "gpt-5.4-mini",
  temperature: 1,
  max_tokens: 16000,
  maxAttempts: 2,
};

// Thrown for bad input that is caught BEFORE streaming begins, so the host can
// still send a real HTTP status. Once rows have started flowing the status line
// is already committed and errors are surfaced as an `error` row instead.
export class SimulationInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "SimulationInputError";
    this.status = 400;
  }
}

function clampTurnLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TURN_LIMIT;
  return Math.max(MIN_TURN_LIMIT, Math.min(MAX_TURN_LIMIT, Math.round(n)));
}

// Trim a runner event down to what the transcript UI needs, dropping the heavy
// raw provider metadata so each streamed row stays small.
function publicEvent(event) {
  return {
    turn: event.turn,
    speaker: event.speaker,
    text: event.text,
    revealed_node: event.revealed_node ?? null,
    revealed_followups: event.revealed_followups ?? [],
  };
}

// Validate the request payload against the bundled data and return the resolved
// pieces the run needs. Throws SimulationInputError (HTTP 400) on bad input.
export function resolveSimulationRequest(payload, data) {
  const prompt = String(payload?.prompt ?? "").trim();
  if (!prompt) throw new SimulationInputError("A coaching prompt is required.");

  const modelId = String(payload?.model_id ?? "");
  const modelSpec = LIVE_MODELS[modelId];
  if (!modelSpec) {
    throw new SimulationInputError(
      `Unknown model "${modelId}". Choose one of: ${Object.keys(LIVE_MODELS).join(", ")}.`,
    );
  }

  const personaId = String(payload?.persona_id ?? "");
  const personaEntry = data.personaByKey(personaId);
  if (!personaEntry) {
    throw new SimulationInputError(`Unknown patient persona "${personaId}".`);
  }

  return {
    prompt,
    modelId,
    modelSpec,
    turnLimit: clampTurnLimit(payload?.turn_limit),
    personaEntry,
  };
}

// Run one live simulation, pushing NDJSON rows through `emit` as they occur.
// `data` must provide { hierarchy, patientHarnessPrompt, personaByKey } — the
// Node host builds it from src/artifacts.js, the Worker from the generated
// bundle. `apiKeys` carries the provider keys ({ OPENAI_API_KEY, ... }).
//
// Validation errors (thrown before any row is emitted) propagate to the caller
// so it can send an HTTP 400. Errors DURING the run are emitted as an `error`
// row and swallowed, because the response status is already committed by then.
export async function runLiveSimulation({ payload, data, apiKeys, emit }) {
  const { prompt, modelId, modelSpec, turnLimit, personaEntry } =
    resolveSimulationRequest(payload, data);
  const persona = personaEntry.persona;
  const hierarchy = data.hierarchy;

  const testedModelConfig = {
    id: `live_${modelId}`,
    label: modelId,
    provider: modelSpec.provider,
    model: modelSpec.model,
    temperature: modelSpec.temperature,
    max_tokens: 1000,
    maxAttempts: 2,
  };

  const patientAdapter = createModelAdapter(PATIENT_CONFIG, { apiKeys });
  const judgeAdapter = createModelAdapter(JUDGE_CONFIG, { apiKeys });
  const patient = new LlmPatient(persona, hierarchy, patientAdapter, {
    harnessPrompt: data.patientHarnessPrompt,
  });

  await emit({
    type: "run_started",
    model: modelId,
    turn_limit: turnLimit,
    persona: {
      key: personaEntry.key,
      profile_number: personaEntry.profileNumber,
      label: persona.label,
      name: persona.name ?? null,
      opening_prompt: persona.opening_prompt,
    },
  });

  try {
    const result = await runScenario({
      hierarchy,
      persona,
      modelConfig: testedModelConfig,
      systemPrompt: prompt,
      turnLimit,
      createPatient: () => patient,
      extractEvidence: (events, h, options) =>
        extractEvidenceLlm(events, h, options, judgeAdapter),
      onEvent: async (event) => {
        await emit({ type: "event", event: publicEvent(event) });
      },
    });

    await emit({
      type: "score",
      run_id: result.run_id,
      model: result.model_config,
      scenario: result.scenario,
      score: result.score,
      attributions: result.attributions,
      evidence_summary: result.evidence.summary,
      conversation: result.conversation,
    });
    return result;
  } catch (error) {
    await emit({
      type: "error",
      message: error?.message || "The simulation failed unexpectedly.",
    });
    return null;
  }
}
