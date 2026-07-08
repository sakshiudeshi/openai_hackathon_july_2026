// Escalation check: drive the personas that carry an `escalation_flag` through a
// live conversation with the tested model, then have the LLM escalation judge
// decide whether the assistant routed the patient to the right level of care.
//
// The judgement is semantic (owned by src/llmEvaluator.js judgeEscalation), not a
// keyword classifier — distinguishing "go to A&E now" from "call 999 if it
// worsens" needs to read the sentence. We skip the elicitation judge here and
// only pay for the patient harness, the tested model, and the escalation judge.
//
// With --dashboard, it also merges its verdicts into LATEST_COMPARISON_FILE under
// `safety_evaluation.versions[]` (keyed by tested-model id, accumulating across
// versions) so the dashboard's "Safety Evaluation" tab renders straight from it.
//
// Usage:
//   node --env-file=.env scripts/check-escalation.js
//   node --env-file=.env scripts/check-escalation.js --tested-model gpt_5_4_mini_prompt_v0 --dashboard
//   node --env-file=.env scripts/check-escalation.js --tested-model gpt_5_4_mini_prompt_v3 --dashboard
//   node --env-file=.env scripts/check-escalation.js --tested-provider anthropic --tested-model-name claude-haiku-4-5-20251001

import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/artifacts.js";
import {
  loadHierarchy,
  loadModelConfigs,
  loadPersonas,
  loadSystemPrompt
} from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { LlmPatient } from "../src/llmPatient.js";
import { createModelAdapter } from "../src/modelAdapters.js";
import { resolveSystemPrompt, runScenario } from "../src/runner.js";
import { judgeEscalation } from "../src/llmEvaluator.js";
import { ESCALATION_FLAGS } from "../src/escalation.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const appConfig = loadAppConfig();
const turnLimit = Number(argValue("--turn-limit", String(appConfig.run.turnLimit)));

// Patient harness model (role-plays the persona). Defaults to config.patient.
const patientConfig = {
  provider: argValue("--patient-provider", appConfig.patient.provider),
  model: argValue("--patient-model", appConfig.patient.model),
  temperature: Number(argValue("--patient-temperature", String(appConfig.patient.temperature ?? 1))),
  max_tokens: Number(argValue("--patient-max-tokens", String(appConfig.patient.max_tokens ?? 1000)))
};

// Escalation judge model. Defaults to config.judge.
const judgeConfig = {
  provider: argValue("--judge-provider", appConfig.judge.provider),
  model: argValue("--judge-model", appConfig.judge.model),
  temperature: Number(argValue("--judge-temperature", String(appConfig.judge.temperature ?? 1))),
  max_tokens: Number(argValue("--judge-max-tokens", String(appConfig.judge.max_tokens ?? 16000)))
};

// Tested model (the "bot" under evaluation).
const modelConfigs = loadModelConfigs(appConfig.modelConfigs.path);
const testedModelId = argValue("--tested-model", null);
const testedProvider = argValue("--tested-provider", null);
let testedModelConfig;
if (testedProvider) {
  const name = argValue("--tested-model-name", "model");
  testedModelConfig = {
    id: `${testedProvider}_${name}`,
    label: `${testedProvider}/${name}`,
    provider: testedProvider,
    model: name,
    temperature: Number(argValue("--tested-temperature", "0.2")),
    max_tokens: Number(argValue("--tested-max-tokens", "1000"))
  };
} else if (testedModelId) {
  testedModelConfig = modelConfigs.find((config) => config.id === testedModelId);
  if (!testedModelConfig) {
    throw new Error(`No model config with id "${testedModelId}" in ${appConfig.modelConfigs.path}`);
  }
} else {
  testedModelConfig = modelConfigs[0];
}

const hierarchy = loadHierarchy();
const personas = loadPersonas().filter((persona) => persona.escalation_flag);
if (personas.length === 0) {
  throw new Error("No personas carry an escalation_flag");
}

const patientAdapter = createModelAdapter(patientConfig);
const judgeAdapter = createModelAdapter(judgeConfig);
const createPatient = (persona) => new LlmPatient(persona, hierarchy, patientAdapter);

// Stub the elicitation evidence so runScenario does not call the elicitation judge.
async function noJudgeEvidence(_events, _hierarchy, options = {}) {
  return {
    labels: [],
    summary: {
      model_elicited_nodes: [],
      patient_volunteered_nodes: [],
      context_provided_nodes: options.contextProvidedNodes || [],
      node_followups: {},
      first_model_elicited_turn_by_node: {},
      safety_flags: [],
      noise_flags: [],
      total_model_questions: 0
    }
  };
}

const resolved = resolveSystemPrompt(testedModelConfig, loadSystemPrompt());

console.log(`Tested model : ${testedModelConfig.provider}/${testedModelConfig.model} (${testedModelConfig.id})`);
console.log(`Patient model: ${patientConfig.provider}/${patientConfig.model}`);
console.log(`Judge model  : ${judgeConfig.provider}/${judgeConfig.model}`);
console.log(`System prompt: ${resolved.systemPromptVersion}`);
console.log(`Turn limit   : ${turnLimit}`);
console.log("");

const results = [];
for (const persona of personas) {
  const spec = ESCALATION_FLAGS[persona.escalation_flag];
  process.stdout.write(`Running ${persona.id}  (expect: ${spec?.label ?? persona.escalation_flag}) ... `);
  let run;
  try {
    run = await runScenario({
      hierarchy,
      persona,
      modelConfig: testedModelConfig,
      systemPrompt: resolved.systemPrompt,
      systemPromptVersion: resolved.systemPromptVersion,
      turnLimit,
      createPatient,
      extractEvidence: noJudgeEvidence
    });
  } catch (error) {
    console.log("ERROR (conversation)");
    console.error(`  ${error.message}`);
    results.push({ persona_id: persona.id, escalation_flag: persona.escalation_flag, error: error.message });
    continue;
  }

  let verdict;
  try {
    verdict = await judgeEscalation(run.events, persona, judgeAdapter);
  } catch (error) {
    console.log("ERROR (judge)");
    console.error(`  ${error.message}`);
    results.push({ persona_id: persona.id, escalation_flag: persona.escalation_flag, run_id: run.run_id, error: error.message });
    continue;
  }

  const outcome = verdict.verdict ? verdict.verdict.toUpperCase() : "UNKNOWN";
  console.log(outcome);
  console.log(`  expected : ${verdict.expected_label} (${verdict.expected_tier})`);
  console.log(`  detected : ${verdict.detected_tier} (safety_net_emergency=${verdict.safety_net_emergency}, stroke_recognised=${verdict.stroke_recognised})`);
  console.log(`  red flag surfaced: ${verdict.red_flag_surfaced}`);
  console.log(`  rationale: ${verdict.rationale}`);
  if (verdict.quote) console.log(`  quote    : "${verdict.quote}"`);
  console.log("");

  results.push({
    persona_id: persona.id,
    escalation_flag: persona.escalation_flag,
    run_id: run.run_id,
    verdict,
    transcript: run.events.map((event) => ({ turn: event.turn, speaker: event.speaker, text: event.text }))
  });
}

const passed = results.filter((entry) => entry.verdict?.verdict === "pass").length;
const failed = results.filter((entry) => entry.verdict?.verdict === "fail").length;
const inconclusive = results.filter((entry) => entry.verdict?.verdict === "inconclusive").length;
const errored = results.filter((entry) => entry.error).length;
console.log(`Summary: ${passed} passed, ${failed} failed, ${inconclusive} inconclusive, ${errored} errored (of ${results.length}).`);

const store = new LocalRunStore(appConfig.storage.outputDir);
const generatedAt = new Date().toISOString();
const report = {
  generated_at: generatedAt,
  tested_model: { id: testedModelConfig.id, provider: testedModelConfig.provider, model: testedModelConfig.model, label: testedModelConfig.label },
  patient_model: { provider: patientConfig.provider, model: patientConfig.model },
  judge_model: { provider: judgeConfig.provider, model: judgeConfig.model },
  system_prompt_version: resolved.systemPromptVersion,
  turn_limit: turnLimit,
  summary: { passed, failed, inconclusive, errored, total: results.length },
  results
};
const outputPath = store.writeComparison(argValue("--out", "escalation-check.json"), report);
console.log(`Wrote report to ${outputPath}`);

// With --dashboard, merge this version's verdicts into the comparison file the
// dashboard renders, under safety_evaluation.versions[]. Keyed by tested-model
// id so running v0 then v3 accumulates both instead of overwriting.
if (hasFlag("--dashboard")) {
  const comparisonPath = path.join(
    PROJECT_ROOT,
    appConfig.storage.outputDir,
    appConfig.storage.latestComparisonFile
  );
  if (!fs.existsSync(comparisonPath)) {
    console.warn(`--dashboard: no comparison file at ${comparisonPath}; skipped.`);
  } else {
    const comparison = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));
    const safety = comparison.safety_evaluation || { versions: [] };
    safety.generated_at = generatedAt;
    const versionEntry = {
      key: testedModelConfig.id,
      label: testedModelConfig.label || testedModelConfig.id,
      tested_model: report.tested_model,
      judge_model: report.judge_model,
      system_prompt_version: resolved.systemPromptVersion,
      turn_limit: turnLimit,
      generated_at: generatedAt,
      summary: report.summary,
      results
    };
    safety.versions = [
      ...safety.versions.filter((version) => version.key !== versionEntry.key),
      versionEntry
    ].sort((a, b) => a.key.localeCompare(b.key));
    comparison.safety_evaluation = safety;
    fs.writeFileSync(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
    console.log(
      `Merged "${versionEntry.label}" into ${path.relative(PROJECT_ROOT, comparisonPath)} (dashboard · ${safety.versions.length} version(s))`
    );
  }
}
