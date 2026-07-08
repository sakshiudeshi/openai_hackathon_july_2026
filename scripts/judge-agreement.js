// Judge-agreement study: can a SMALLER judge model replace the big one?
//
// The expensive part of this eval is the LLM judge call (see the timing dumps:
// ~40-50s, the single biggest cost of a run). This script re-runs ONLY the judge
// over transcripts that already exist in runs/<id>/run.json — it never re-runs a
// conversation — with two judge models and reports how much they agree:
//
//   reference (default gpt-5.5, the judge the real eval uses) vs.
//   candidate (default gpt-5.4-mini, the cheaper model you'd like to switch to).
//
// Because the judge runs at temperature 1 it disagrees with ITSELF, so 100% is
// impossible. We therefore also judge each transcript with the reference model a
// SECOND time and report reference-vs-reference self-agreement as the ceiling the
// candidate numbers should be read against. Disable with --no-baseline.
//
// Usage:
//   node --env-file=.env scripts/judge-agreement.js --limit 15
//   node --env-file=.env scripts/judge-agreement.js --candidate gpt-5.4 --limit 40
//   node --env-file=.env scripts/judge-agreement.js --limit all --concurrency 8 --no-baseline
//   node --env-file=.env scripts/judge-agreement.js --temperature 0   # cleaner, deterministic-ish comparison

import fs from "node:fs";
import path from "node:path";
import { loadHierarchy, PROJECT_ROOT } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { createModelAdapter } from "../src/modelAdapters.js";
import { extractEvidenceLlm } from "../src/llmEvaluator.js";
import { scoreRun } from "../src/scoring.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";
import {
  ATTRIBUTION_CATEGORIES,
  cohensKappa,
  confusionMatrix,
  isCovered,
  jaccard,
  mean,
  nodeCategory,
  pearson,
  rankInversions,
  rawAgreement,
  spearman
} from "./lib/agreement-metrics.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}
function hasFlag(name) {
  return process.argv.includes(name);
}

// Bounded worker pool: runs `worker(item)` over `items`, at most `concurrency`
// in flight, preserving input order. Same shape as compare-versions.js.
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
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    drain
  );
  await Promise.all(workers);
  return results;
}

// ---- config -------------------------------------------------------------

const appConfig = loadAppConfig();
const runsDir = path.isAbsolute(argValue("--runs-dir", appConfig.storage.outputDir))
  ? argValue("--runs-dir", appConfig.storage.outputDir)
  : path.join(PROJECT_ROOT, argValue("--runs-dir", appConfig.storage.outputDir));

const temperatureOverride = argValue("--temperature", null);
const maxTokens = Number(argValue("--judge-max-tokens", String(appConfig.judge.max_tokens ?? 16000)));
const concurrency = Math.max(1, Number(argValue("--concurrency", "4")) || 1);
const withBaseline = !hasFlag("--no-baseline");

// Reference = the judge the real eval uses (config/default.json judge, gpt-5.5).
// Candidate = the smaller model we're testing as a drop-in replacement.
const referenceJudge = {
  provider: argValue("--reference-provider", appConfig.judge.provider),
  model: argValue("--reference", appConfig.judge.model),
  temperature: temperatureOverride != null ? Number(temperatureOverride) : (appConfig.judge.temperature ?? 1),
  max_tokens: maxTokens
};
const candidateJudge = {
  provider: argValue("--candidate-provider", appConfig.judge.provider),
  model: argValue("--candidate", "gpt-5.4-mini"),
  temperature: temperatureOverride != null ? Number(temperatureOverride) : (appConfig.judge.temperature ?? 1),
  max_tokens: maxTokens
};

const limitArg = argValue("--limit", "15");
const limit = limitArg === "all" ? Infinity : Math.max(1, Number(limitArg) || 15);

// ---- load the transcript corpus ----------------------------------------

const hierarchy = loadHierarchy();
const nodeIds = hierarchy.nodes.map((node) => node.id);

// A transcript is any saved run whose events include at least one assistant turn
// (i.e. there is something for a judge to attribute). Read deterministically by
// run id so --limit N always selects the same corpus.
function loadCorpus() {
  if (!fs.existsSync(runsDir)) return [];
  const dirs = fs.readdirSync(runsDir).sort();
  const corpus = [];
  for (const dir of dirs) {
    const file = path.join(runsDir, dir, "run.json");
    if (!fs.existsSync(file)) continue;
    let run;
    try {
      run = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const events = run.events || [];
    if (!events.some((event) => event.speaker === "assistant" && event.text)) continue;
    corpus.push({
      run_id: run.run_id || dir,
      config_id: run.model_config?.id || "unknown",
      config_label: run.model_config?.label || run.model_config?.model || "unknown",
      scenario_id: run.scenario?.id || "unknown",
      context_provided_nodes: run.scenario?.context_provided_nodes || [],
      patient_sex: run.scenario?.patient_sex ?? null,
      events
    });
  }
  return corpus;
}

const corpus = loadCorpus().slice(0, limit === Infinity ? undefined : limit);
if (corpus.length === 0) {
  console.error(`No usable transcripts found in ${runsDir}.`);
  process.exit(1);
}

// ---- run the judges -----------------------------------------------------

const adapters = {
  refA: createModelAdapter(referenceJudge),
  refB: createModelAdapter(referenceJudge),
  cand: createModelAdapter(candidateJudge)
};

// Re-judge one transcript with one judge and re-derive its score exactly the way
// runScenario does (same context nodes, same patient-sex gate, noise penalty off).
async function judgeOnce(transcript, adapter) {
  const evidence = await extractEvidenceLlm(
    transcript.events,
    hierarchy,
    { contextProvidedNodes: transcript.context_provided_nodes },
    adapter
  );
  const score = scoreRun(hierarchy, evidence.summary, {
    patientSex: transcript.patient_sex,
    applyNoisePenalty: appConfig.scoring.noisePenalty
  });
  return { summary: evidence.summary, score };
}

// One task per (transcript × judge-pass). Flat fan-out keeps the pool saturated
// rather than bottlenecking on the slowest pass of each transcript.
const passes = withBaseline ? ["refA", "refB", "cand"] : ["refA", "cand"];
const tasks = [];
for (const transcript of corpus) {
  for (const pass of passes) tasks.push({ transcript, pass });
}

console.log(`Reference judge : ${referenceJudge.provider}/${referenceJudge.model}  (temp ${referenceJudge.temperature})`);
console.log(`Candidate judge : ${candidateJudge.provider}/${candidateJudge.model}  (temp ${candidateJudge.temperature})`);
console.log(`Transcripts     : ${corpus.length}   (${withBaseline ? "with" : "no"} self-agreement baseline)`);
console.log(`Judge calls     : ${tasks.length}   concurrency ${concurrency}\n`);

let done = 0;
const outcomes = await runPool(tasks, concurrency, async ({ transcript, pass }) => {
  try {
    const result = await judgeOnce(transcript, adapters[pass]);
    process.stdout.write(`\r  judged ${++done}/${tasks.length}`);
    return { run_id: transcript.run_id, pass, result };
  } catch (error) {
    process.stdout.write(`\r  judged ${++done}/${tasks.length}`);
    return { run_id: transcript.run_id, pass, error: error.message };
  }
});
process.stdout.write("\n\n");

// Regroup by transcript: { run_id -> { refA, refB, cand } }.
const byTranscript = new Map(corpus.map((t) => [t.run_id, { transcript: t, passes: {}, errors: {} }]));
for (const outcome of outcomes) {
  const entry = byTranscript.get(outcome.run_id);
  if (!entry) continue;
  if (outcome.error) entry.errors[outcome.pass] = outcome.error;
  else entry.passes[outcome.pass] = outcome.result;
}

// ---- metric computation -------------------------------------------------

const COVERAGE_CATEGORIES = ["covered", "missed"];
const SCORE_KEYS = ["bottom_to_roof_score", "coverage_score", "priority_score", "depth_score", "safety_score"];

// Compares two judge passes (X = reference, Y = other) across every transcript
// where both passes succeeded. Returns null if fewer than one transcript aligns.
function compareJudges(passX, passY) {
  const aligned = [...byTranscript.values()].filter(
    (entry) => entry.passes[passX] && entry.passes[passY]
  );
  if (aligned.length === 0) return null;

  const refCats = [];
  const candCats = [];
  const refCov = [];
  const candCov = [];
  const followupJaccards = [];
  const scoreXByKey = Object.fromEntries(SCORE_KEYS.map((k) => [k, []]));
  const scoreYByKey = Object.fromEntries(SCORE_KEYS.map((k) => [k, []]));

  for (const entry of aligned) {
    const x = entry.passes[passX];
    const y = entry.passes[passY];
    for (const nodeId of nodeIds) {
      const cx = nodeCategory(x.summary, nodeId);
      const cy = nodeCategory(y.summary, nodeId);
      refCats.push(cx);
      candCats.push(cy);
      refCov.push(isCovered(cx) ? "covered" : "missed");
      candCov.push(isCovered(cy) ? "covered" : "missed");
      // Depth agreement only makes sense where both judges surfaced the node.
      if (isCovered(cx) && isCovered(cy)) {
        const fx = (x.summary.node_followups || {})[nodeId] || [];
        const fy = (y.summary.node_followups || {})[nodeId] || [];
        followupJaccards.push(jaccard(fx, fy));
      }
    }
    for (const key of SCORE_KEYS) {
      scoreXByKey[key].push(x.score[key]);
      scoreYByKey[key].push(y.score[key]);
    }
  }

  const scoreStats = {};
  for (const key of SCORE_KEYS) {
    const xs = scoreXByKey[key];
    const ys = scoreYByKey[key];
    const diffs = xs.map((value, i) => ys[i] - value);
    scoreStats[key] = {
      reference_mean: round(mean(xs)),
      candidate_mean: round(mean(ys)),
      mean_abs_diff: round(mean(diffs.map(Math.abs))),
      signed_bias: round(mean(diffs)), // candidate minus reference; >0 = candidate scores higher
      correlation: round(pearson(xs, ys))
    };
  }

  return {
    transcripts_aligned: aligned.length,
    node_cells: refCats.length,
    attribution: {
      raw_agreement: round(rawAgreement(refCats, candCats)),
      cohens_kappa: round(cohensKappa(refCats, candCats, ATTRIBUTION_CATEGORIES)),
      confusion: serializeConfusion(confusionMatrix(refCats, candCats, ATTRIBUTION_CATEGORIES))
    },
    coverage: {
      raw_agreement: round(rawAgreement(refCov, candCov)),
      cohens_kappa: round(cohensKappa(refCov, candCov, COVERAGE_CATEGORIES))
    },
    followup_depth: {
      mean_jaccard: round(mean(followupJaccards)),
      nodes_compared: followupJaccards.length
    },
    scores: scoreStats,
    ranking: rankingAgreement(aligned, passX, passY)
  };
}

// The decision the eval actually drives: which tested config wins. Aggregate the
// headline score per tested config under each judge and check whether the two
// judges produce the same leaderboard.
function rankingAgreement(aligned, passX, passY) {
  const byConfig = new Map();
  for (const entry of aligned) {
    const key = entry.transcript.config_id;
    const bucket = byConfig.get(key) || { label: entry.transcript.config_label, x: [], y: [] };
    bucket.x.push(entry.passes[passX].score.bottom_to_roof_score);
    bucket.y.push(entry.passes[passY].score.bottom_to_roof_score);
    byConfig.set(key, bucket);
  }
  const configs = [...byConfig.entries()].map(([id, bucket]) => ({
    id,
    label: bucket.label,
    reference_mean: round(mean(bucket.x)),
    candidate_mean: round(mean(bucket.y)),
    n: bucket.x.length
  }));
  const xs = configs.map((c) => c.reference_mean);
  const ys = configs.map((c) => c.candidate_mean);
  const refOrder = [...configs].sort((a, b) => b.reference_mean - a.reference_mean).map((c) => c.id);
  const candOrder = [...configs].sort((a, b) => b.candidate_mean - a.candidate_mean).map((c) => c.id);
  return {
    configs_compared: configs.length,
    per_config: configs,
    spearman: round(spearman(xs, ys)),
    inversions: rankInversions(xs, ys),
    same_top_config: refOrder.length > 0 && refOrder[0] === candOrder[0],
    same_full_order: refOrder.length > 1 && refOrder.join(",") === candOrder.join(",")
  };
}

function serializeConfusion(matrix) {
  const out = {};
  for (const [row, cols] of matrix.entries()) {
    out[row] = Object.fromEntries([...cols.entries()]);
  }
  return out;
}

function round(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 1000) / 1000;
}

const candidateVsReference = compareJudges("refA", "cand");
const baseline = withBaseline ? compareJudges("refA", "refB") : null;

// ---- report -------------------------------------------------------------

const errorCount = [...byTranscript.values()].filter((e) => Object.keys(e.errors).length).length;
if (errorCount) {
  console.log(`WARNING: ${errorCount} transcript(s) had a failed judge pass and were excluded from the affected metrics.\n`);
}

function fmt(value) {
  return value == null ? "  n/a" : (value >= 0 ? " " : "") + value.toFixed(3);
}

console.log("AGREEMENT — reference (gpt-5.5) vs candidate (" + candidateJudge.model + ")");
console.log("            higher = the small judge behaves like the big one.\n");

const rows = [
  ["metric", "candidate", withBaseline ? "5.5-self" : null].filter(Boolean).map((s) => s.padEnd(10))
];
function pushRow(label, cand, base) {
  const cols = [label.padEnd(28), fmt(cand)];
  if (withBaseline) cols.push(fmt(base));
  console.log(cols.join("   "));
}
console.log(["metric".padEnd(28), "candidate", withBaseline ? "5.5-self" : ""].join("   ").trimEnd() + "\n" + "-".repeat(withBaseline ? 52 : 42));
pushRow("attribution agreement", candidateVsReference?.attribution.raw_agreement, baseline?.attribution.raw_agreement);
pushRow("attribution kappa", candidateVsReference?.attribution.cohens_kappa, baseline?.attribution.cohens_kappa);
pushRow("coverage agreement", candidateVsReference?.coverage.raw_agreement, baseline?.coverage.raw_agreement);
pushRow("coverage kappa", candidateVsReference?.coverage.cohens_kappa, baseline?.coverage.cohens_kappa);
pushRow("followup depth (jaccard)", candidateVsReference?.followup_depth.mean_jaccard, baseline?.followup_depth.mean_jaccard);
pushRow("score corr (bottom_to_roof)", candidateVsReference?.scores.bottom_to_roof_score.correlation, baseline?.scores.bottom_to_roof_score.correlation);
pushRow("score mean|Δ| (bottom_to_roof)", candidateVsReference?.scores.bottom_to_roof_score.mean_abs_diff, baseline?.scores.bottom_to_roof_score.mean_abs_diff);
pushRow("score bias (cand - ref)", candidateVsReference?.scores.bottom_to_roof_score.signed_bias, baseline?.scores.bottom_to_roof_score.signed_bias);

// How the candidate mislabels, directionally (reference row -> candidate column).
console.log("\nAttribution confusion (reference row → candidate column), off-diagonal = disagreement:");
const conf = candidateVsReference?.attribution.confusion || {};
const header = ["ref \\ cand".padEnd(20), ...ATTRIBUTION_CATEGORIES.map((c) => c.slice(0, 12).padStart(13))].join("");
console.log(header);
for (const row of ATTRIBUTION_CATEGORIES) {
  const cells = ATTRIBUTION_CATEGORIES.map((col) => String((conf[row] || {})[col] ?? 0).padStart(13));
  console.log(row.padEnd(20) + cells.join(""));
}

// The actual decision: same leaderboard?
const ranking = candidateVsReference?.ranking;
if (ranking) {
  console.log("\nRanking of tested configs (the decision the eval drives):");
  console.table(ranking.per_config.map((c) => ({
    config: c.label,
    n: c.n,
    "ref (5.5)": c.reference_mean,
    "cand (5.4-mini)": c.candidate_mean
  })));
  console.log(`  Spearman (config order): ${fmt(ranking.spearman).trim()}   inversions: ${ranking.inversions}`);
  console.log(`  same winning config: ${ranking.same_top_config ? "YES" : "NO"}   same full order: ${ranking.same_full_order ? "YES" : "NO"}`);
}

// ---- persist ------------------------------------------------------------

const report = {
  generated_at: new Date().toISOString(),
  reference_judge: referenceJudge,
  candidate_judge: candidateJudge,
  corpus: {
    transcripts: corpus.length,
    excluded_for_errors: errorCount,
    runs_dir: path.relative(PROJECT_ROOT, runsDir)
  },
  candidate_vs_reference: candidateVsReference,
  self_agreement_baseline: baseline
};
const store = new LocalRunStore(appConfig.storage.outputDir);
const outName = argValue("--out", "judge-agreement.json");
const outPath = store.writeComparison(outName, report);
console.log(`\nWrote full report to ${outPath}`);

if (baseline) {
  console.log(
    "\nRead the candidate column against the 5.5-self column: the gap between them is\n"
    + "how much you lose by switching, net of the judge's own temperature noise."
  );
}
