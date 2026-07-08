// Runs one or more personas through two model-config versions and prints the
// scores side by side. Handy for eyeballing the effect of a prompt-version bump
// (e.g. prompt simple vs prompt coach) on the same base model.
//
//   node scripts/compare-versions.js --personas 4
//   node scripts/compare-versions.js --personas 4,5,6 --configs gpt_5_5_prompt_simple,gpt_5_5_prompt_coach
//   node scripts/compare-versions.js --personas 4,5,6 --concurrency 6
//   node scripts/compare-versions.js --personas 4 --engine scripted
//
// The (version × persona) pairs are fully independent, so --concurrency N runs
// up to N of them at once via a worker pool. Live progress shows the current
// turn for each version. Results are byte-identical regardless of concurrency.
//
// Every run is persisted to runs/<run_id>/ (and streamed to Supabase when its
// env vars are set), the same as run-evaluation.js, so runs from this script
// appear in the manifest and their judge tags can be audited later.
//
// NOTE: the prompt versions shipped in config/model_configs.json are v0 and v1
// (there is no v2). Pass --configs to compare any two config ids.

import { loadHierarchy, loadModelConfigs, loadPersonasByFileNumbers, loadSystemPrompt } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { buildEngine } from "../src/engine.js";
import { resolveSystemPrompt, runScenario, summarizeComparison } from "../src/runner.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";
import { SupabaseStore } from "../src/storage/supabaseStore.js";
import { createTurnProgress } from "./lib/turn-progress.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

// Runs `worker(item)` over `items` with at most `concurrency` in flight at once,
// preserving input order in the returned results array.
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function drain() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, drain);
  await Promise.all(workers);
  return results;
}

const appConfig = loadAppConfig();
const configPath = argValue("--config", appConfig.modelConfigs.path);
const turnLimit = Number(argValue("--turn-limit", String(appConfig.run.turnLimit)));
const concurrency = Math.max(1, Number(argValue("--concurrency", "4")) || 1);

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
const configIds = argValue("--configs", "gpt_5_5_prompt_simple,gpt_5_5_prompt_coach")
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
const fallbackPrompt = loadSystemPrompt();
const hierarchy = loadHierarchy();

// Every run is persisted: locally to runs/<run_id>/ (same layout as
// run-evaluation.js) and streamed to Supabase when its env vars are set. This
// mirrors run-evaluation.js so runs from this script show up in the manifest
// and can be audited later.
const localStore = new LocalRunStore(appConfig.storage.outputDir);
const supabaseStore = new SupabaseStore();
const storage = {
  async recordRunStarted(run) {
    await supabaseStore.recordRunStarted(run);
  },
  async recordEvent(event) {
    await localStore.recordEvent(event);
    await supabaseStore.recordEvent(event);
  },
  async recordRunResult(result) {
    await localStore.recordRunResult(result);
    await supabaseStore.recordRunResult(result);
  }
};

console.log(`Engine: ${engine.mode}`);
console.log(`Personas: ${personas.map((p) => p.id).join(", ")}`);
console.log(`Versions: ${modelConfigs.map((c) => c.label || c.id).join("  vs  ")}`);
console.log(`Concurrency: ${concurrency}\n`);

// One task per (version × persona) pair. Resolve each version's system prompt
// once so every persona under that version shares it.
const resolvedByConfig = new Map(
  modelConfigs.map((cfg) => [cfg.id, resolveSystemPrompt(cfg, fallbackPrompt)])
);
const tasks = [];
for (const modelConfig of modelConfigs) {
  for (const persona of personas) {
    tasks.push({ modelConfig, persona });
  }
}

const progress = createTurnProgress({ modelConfigs, personasPerVersion: personas.length });

const runs = await runPool(tasks, concurrency, async ({ modelConfig, persona }) => {
  const resolved = resolvedByConfig.get(modelConfig.id);
  const result = await runScenario({
    hierarchy,
    persona,
    modelConfig,
    systemPrompt: resolved.systemPrompt,
    systemPromptVersion: resolved.systemPromptVersion,
    turnLimit,
    storage,
    createPatient: engine.createPatient,
    extractEvidence: engine.extractEvidence,
    scoreOptions: { applyNoisePenalty: appConfig.scoring.noisePenalty },
    onTurn: (info) => progress.onTurn(info)
  });
  progress.onComplete({ modelConfig, persona, result });
  return result;
});
progress.finish();

const comparison = summarizeComparison(runs);

console.log(`\nSaved ${comparison.runs.length} runs to ${appConfig.storage.outputDir}/<run_id>/`
  + (supabaseStore.enabled ? " (also streamed to Supabase)." : " (Supabase env not set; local only)."));

console.log("\nRun IDs:");
for (const run of comparison.runs) {
  console.log(`  ${run.run_id}  ${run.model_config.label || run.model_config.id}  ×  ${run.scenario.id}`);
}

// Per-persona breakdown: for each persona, one row per version.
const rows = comparison.runs.map((run) => ({
  persona: run.scenario.id,
  version: run.model_config.label || run.model_config.id,
  run_id: run.run_id,
  score: run.score.bottom_to_roof_score,
  coverage: run.score.coverage_score,
  priority: run.score.priority_score,
  depth: run.score.depth_score,
  efficiency: run.score.coverage_efficiency_score
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
  efficiency: model.score.coverage_efficiency_score
})));
