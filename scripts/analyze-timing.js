// Shows where a saved run's wall-clock went: per-turn tested-model vs patient
// latency, the judge call, and the unaccounted remainder (scoring + rate-limit
// backoff). Reads the `timings` block that runScenario now records.
//
//   node scripts/analyze-timing.js <run_id> [<run_id> ...]
//   node scripts/analyze-timing.js --latest 6      # 6 most-recently-completed runs
//
// Use it to spot timing issues: a single slow turn, a judge call dominating the
// run, or a big total-vs-accounted gap (the signature of 429 backoff under
// concurrency).

import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";

const runsDir = path.join(PROJECT_ROOT, loadAppConfig().storage.outputDir);

function s(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Resolve requested run ids: explicit ids, or the N most recent by completed_at.
function resolveRunIds(argv) {
  const latestIdx = argv.indexOf("--latest");
  if (latestIdx >= 0) {
    const n = Number(argv[latestIdx + 1]) || 5;
    const entries = fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(runsDir, d.name, "manifest.json"))
      .filter((p) => fs.existsSync(p))
      .map((p) => JSON.parse(fs.readFileSync(p, "utf8")))
      .filter((m) => m.completed_at)
      .sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at)));
    return entries.slice(-n).map((m) => m.run_id);
  }
  return argv.filter((a) => !a.startsWith("--"));
}

function loadRun(runId) {
  const runPath = path.join(runsDir, runId, "run.json");
  if (!fs.existsSync(runPath)) throw new Error(`No run.json for ${runId} (looked in ${runPath})`);
  return JSON.parse(fs.readFileSync(runPath, "utf8"));
}

const runIds = resolveRunIds(process.argv.slice(2));
if (runIds.length === 0) {
  console.error("Usage: node scripts/analyze-timing.js <run_id> [...] | --latest N");
  process.exit(1);
}

for (const runId of runIds) {
  const run = loadRun(runId);
  const t = run.timings;
  const label = `${run.model_config?.label || run.model_config?.id} × ${run.scenario?.id}`;
  console.log(`\n=== ${runId}  ${label} ===`);

  if (!t) {
    console.log("  No timings recorded (run predates timing instrumentation).");
    continue;
  }

  const accounted = t.model_ms_total + t.patient_ms_total + t.judge_ms;
  const overhead = t.total_ms - accounted; // scoring + rate-limit backoff waits
  const pct = (ms) => `${Math.round((ms / t.total_ms) * 100)}%`;

  console.log(`  total        ${s(t.total_ms)}`);
  console.log(`  model  (sum) ${s(t.model_ms_total)}  (${pct(t.model_ms_total)})`);
  console.log(`  patient(sum) ${s(t.patient_ms_total)}  (${pct(t.patient_ms_total)})`);
  console.log(`  judge        ${s(t.judge_ms)}  (${pct(t.judge_ms)})  <- one call`);
  console.log(`  overhead/gap ${s(overhead)}  (${pct(overhead)})  <- scoring + rate-limit backoff`);

  // Per-turn table, sorted slowest-first so a stuck turn jumps out.
  const turns = [...(t.turns || [])].sort((a, b) =>
    (b.model_ms + b.patient_ms) - (a.model_ms + a.patient_ms));
  if (turns.length) {
    console.log("  turns (slowest first):");
    for (const turn of turns) {
      console.log(`    t${String(turn.turn).padStart(2)}  model ${s(turn.model_ms).padStart(6)}  patient ${s(turn.patient_ms).padStart(6)}`);
    }
  }
}
