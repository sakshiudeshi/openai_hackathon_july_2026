// Runs one or more personas through two model-config versions and prints the
// scores side by side. Handy for eyeballing the effect of a prompt-version bump
// (e.g. prompt v0 vs prompt v1) on the same base model.
//
//   node scripts/compare-versions.js --personas 4
//   node scripts/compare-versions.js --personas 4,5,6 --configs gpt_5_5_prompt_v0,gpt_5_5_prompt_v1
//   node scripts/compare-versions.js --personas 4 --engine scripted
//
// NOTE: the prompt versions shipped in config/model_configs.json are v0 and v1
// (there is no v2). Pass --configs to compare any two config ids.

import { loadHierarchy, loadModelConfigs, loadPersonasByFileNumbers, loadSystemPrompt } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { buildEngine } from "../src/engine.js";
import { runComparison } from "../src/runner.js";
import { createProgressBar } from "./lib/progress-bar.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

const appConfig = loadAppConfig();
const configPath = argValue("--config", appConfig.modelConfigs.path);
const turnLimit = Number(argValue("--turn-limit", String(appConfig.run.turnLimit)));

// --personas 4 (one) or --personas 4,5,6 (n) -> persona_<N>.json files.
const personaArg = argValue("--personas");
if (!personaArg) {
  console.error("Pass --personas <N> (e.g. --personas 4) or a comma list (--personas 4,5,6).");
  process.exit(1);
}
const personaNumbers = personaArg
  .split(",")
  .map((token) => Number(token.trim()))
  .filter((n) => Number.isFinite(n));
const personas = loadPersonasByFileNumbers(personaNumbers);
if (personas.length === 0) {
  console.error(`No personas matched: ${personaArg}`);
  process.exit(1);
}

// The two versions to compare. Defaults to the two prompt versions of GPT-5.5.
const configIds = argValue("--configs", "gpt_5_5_prompt_v0,gpt_5_5_prompt_v1")
  .split(",")
  .map((id) => id.trim());
const allConfigs = loadModelConfigs(configPath);
const modelConfigs = configIds.map((id) => {
  const found = allConfigs.find((cfg) => cfg.id === id);
  if (!found) {
    console.error(`Unknown config id "${id}". Available: ${allConfigs.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  return found;
});

const engineConfig = { ...appConfig, engine: argValue("--engine", appConfig.engine) };
const engine = buildEngine(engineConfig);

console.log(`Engine: ${engine.mode}`);
console.log(`Personas: ${personas.map((p) => p.id).join(", ")}`);
console.log(`Versions: ${modelConfigs.map((c) => c.label || c.id).join("  vs  ")}\n`);

const progress = createProgressBar({ total: modelConfigs.length * personas.length });

const comparison = await runComparison({
  hierarchy: loadHierarchy(),
  personas,
  modelConfigs,
  systemPrompt: loadSystemPrompt(),
  turnLimit,
  storage: null,
  createPatient: engine.createPatient,
  extractEvidence: engine.extractEvidence,
  scoreOptions: { applyNoisePenalty: appConfig.scoring.noisePenalty },
  onProgress: progress
});

// Per-persona breakdown: for each persona, one row per version.
const rows = comparison.runs.map((run) => ({
  persona: run.scenario.id,
  version: run.model_config.label || run.model_config.id,
  score: run.score.bottom_to_roof_score,
  coverage: run.score.coverage_score,
  priority: run.score.priority_score,
  depth: run.score.depth_score,
  safety: run.score.safety_score,
  noise: run.score.noise_penalty
}));
rows.sort((a, b) => (a.persona < b.persona ? -1 : a.persona > b.persona ? 1 : 0));

console.log("\nPer-persona scores:");
console.table(rows);

console.log("\nAverage across personas (per version):");
console.table(comparison.models.map((model) => ({
  version: model.model_config.label || model.model_config.id,
  score: model.score.bottom_to_roof_score,
  coverage: model.score.coverage_score,
  priority: model.score.priority_score,
  depth: model.score.depth_score,
  safety: model.score.safety_score,
  noise: model.score.noise_penalty
})));
