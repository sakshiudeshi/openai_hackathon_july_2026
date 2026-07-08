// Parallel variant of run-evaluation.js.
//
// runComparison() runs every (modelConfig × persona) scenario strictly
// sequentially. For a full sweep (4 configs × 13 personas = 52 scenarios, each
// a 30-turn LLM conversation plus a judge call) that is slow. This driver runs
// the same scenarios through a bounded concurrency pool and then produces ONE
// combined comparison (all models together) so the dashboard's single
// latest-comparison.json shows the whole leaderboard.
//
// Each scenario is internally sequential (one in-flight request at a time), so
// peak API concurrency is ~ the pool size. The adapters already back off on 429,
// so a modest pool is safe.
//
// Usage:
//   node scripts/run-evaluation-parallel.js [--config path] [--turn-limit N]
//                                           [--concurrency N] [--personas 1,2,3]

import { loadHierarchy, loadModelConfigs, loadPersonas, loadPersonasByFileNumbers, loadSystemPrompt } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { buildEngine } from "../src/engine.js";
import { resolveSystemPrompt, runScenario, summarizeComparison } from "../src/runner.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";
import { SupabaseStore } from "../src/storage/supabaseStore.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function isoNow() {
  return new Date().toISOString();
}

const appConfig = loadAppConfig();
const configPath = argValue("--config", appConfig.modelConfigs.path);
const turnLimit = Number(argValue("--turn-limit", String(appConfig.run.turnLimit)));
const concurrency = Math.max(1, Number(argValue("--concurrency", "8")));
const engineConfig = { ...appConfig, engine: argValue("--engine", appConfig.engine) };
const engine = buildEngine(engineConfig);

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

const personaArg = argValue("--personas");
const personaNumbers = personaArg
  ? personaArg.split(",").map((token) => Number(token.trim())).filter((n) => Number.isFinite(n))
  : null;
const personas = personaNumbers ? loadPersonasByFileNumbers(personaNumbers) : loadPersonas();
const modelConfigs = loadModelConfigs(configPath);
const hierarchy = loadHierarchy();
const fallbackSystemPrompt = loadSystemPrompt();

// Precompute one task per (config, persona). Each config resolves its own
// system prompt once (simple vs coach) and every persona reuses it.
const tasks = [];
for (const modelConfig of modelConfigs) {
  const resolved = resolveSystemPrompt(modelConfig, fallbackSystemPrompt);
  for (const persona of personas) {
    tasks.push({ modelConfig, persona, resolved });
  }
}

const total = tasks.length;
console.log(`Conversation engine: ${engine.mode}`);
console.log(
  `Patient: ${appConfig.patient.provider}/${appConfig.patient.model} · ` +
  `Judge: ${appConfig.judge.provider}/${appConfig.judge.model}`
);
console.log(
  `Sweep: ${modelConfigs.length} configs × ${personas.length} personas = ${total} scenarios ` +
  `· concurrency ${concurrency} · turn limit ${turnLimit}`
);
for (const mc of modelConfigs) console.log(`  · ${mc.label || mc.id}`);

const startedAt = Date.now();
let completed = 0;
let started = 0;
const results = new Array(total);

function fmt(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

async function runOne(index) {
  const { modelConfig, persona, resolved } = tasks[index];
  const label = `${modelConfig.label || modelConfig.id} × ${persona.label || persona.id}`;
  const n = ++started;
  console.log(`[${n}/${total}] start  ${label}`);
  try {
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
      scoreOptions: { applyNoisePenalty: appConfig.scoring.noisePenalty }
    });
    results[index] = result;
    completed += 1;
    const eta = completed > 0 ? fmt(((Date.now() - startedAt) / completed) * (total - completed)) : "?";
    console.log(
      `[${completed}/${total}] done   ${label} · run ${result.run_id} · ` +
      `B2R ${result.score.bottom_to_roof_score} · elapsed ${fmt(Date.now() - startedAt)} · ETA ${eta}`
    );
  } catch (error) {
    completed += 1;
    console.error(`[${completed}/${total}] FAIL   ${label} · ${error.message}`);
    results[index] = { __error: true, label, message: error.message, modelConfig, persona };
  }
}

// Bounded worker pool: `concurrency` workers pull the next index off a shared cursor.
let cursor = 0;
async function worker() {
  while (cursor < total) {
    const index = cursor++;
    await runOne(index);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

const failures = results.filter((r) => r && r.__error);
const successes = results.filter((r) => r && !r.__error);
const comparison = summarizeComparison(successes);
const outputPath = localStore.writeComparison(appConfig.storage.latestComparisonFile, comparison);

console.log("");
console.log(`Finished ${successes.length}/${total} scenarios in ${fmt(Date.now() - startedAt)}.`);
if (failures.length) {
  console.log(`${failures.length} failed:`);
  for (const f of failures) console.log(`  · ${f.label}: ${f.message}`);
}
console.log(`Wrote combined comparison to ${outputPath}`);
if (!supabaseStore.enabled) {
  console.log("Supabase env vars were not set; skipped Supabase streaming.");
}
process.exit(failures.length ? 1 : 0);
