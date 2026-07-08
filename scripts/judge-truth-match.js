// Truth-match judge: for each saved run, how well did the conversation match
// the persona's TRUE underlying picture?
//
// Unlike judge-condition-catch.js (a binary caught/surfaced/missed on the one
// decisive item), this judge grades against the levelled ground truth in
// data/Truths/<persona_id>.json. Each truth file carries:
//   - target_ground_truth : prose describing the true disposition for the patient
//   - levels              : an ordered rubric L4..L0 (closest-to-target first),
//                           each with a credit_when clause; each level "includes
//                           everything below it", and L0 may carry sub-tags
//                           (e.g. L0a under-call, L0b over-call).
// The judge reads the transcript and assigns the single HIGHEST level whose
// credit_when is satisfied — that is how well the run matched the truth.
//
// Runs join to truths by scenario.id == truth.persona_id. Runs whose scenario
// has no truth file are reported as skipped, not judged.
//
// With NO run ids, it judges exactly the runs on the dashboard — the run set in
// LATEST_COMPARISON_FILE (runs/latest-comparison.json) — and writes each verdict
// back onto that run object as `run.truth_match`. The dashboard's "Ground Truth
// Evaluation" tab renders straight from that, so no server change is needed.
// Passing run ids on the CLI overrides the default set.
//
// It re-judges transcripts that already exist; it never re-runs a conversation.
//
// Usage:
//   node --env-file=.env scripts/judge-truth-match.js                 # all dashboard runs
//   node --env-file=.env scripts/judge-truth-match.js v5dbiclNeGkg JNgq4FYjFTdD
//   node --env-file=.env scripts/judge-truth-match.js --concurrency 8 --judge-model gpt-5.4
//   node --env-file=.env scripts/judge-truth-match.js --out truth-match.json

import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { createModelAdapter } from "../src/modelAdapters.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";

const TRUTHS_DIR = path.join(PROJECT_ROOT, "data/Truths");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

// Positional args = run ids. Anything after the script path that is not a
// --flag and not a --flag's value is treated as a run id.
function parseRunIds() {
  const args = process.argv.slice(2);
  const ids = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      i += 1; // skip this flag's value
      continue;
    }
    ids.push(arg);
  }
  return ids;
}

// Bounded worker pool (same shape as judge-condition-catch.js / judge-agreement.js).
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

// Tolerant extraction: strip a ```json``` fence if present, else grab the
// outermost { ... }.
function parseJudgeJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : String(text);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Judge returned no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

function loadRun(runsDir, runId) {
  const file = path.join(runsDir, runId, "run.json");
  if (!fs.existsSync(file)) throw new Error(`No run.json for run id "${runId}" (${file})`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Load every truth file and index by persona_id (= the run's scenario.id).
function loadTruthsById() {
  if (!fs.existsSync(TRUTHS_DIR)) {
    throw new Error(`Truths directory not found: ${TRUTHS_DIR}`);
  }
  const byId = new Map();
  for (const file of fs.readdirSync(TRUTHS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const truth = JSON.parse(fs.readFileSync(path.join(TRUTHS_DIR, file), "utf8"));
    if (truth?.persona_id) byId.set(truth.persona_id, truth);
  }
  return byId;
}

// Flatten a truth's levels into a lookup of every valid id (levels + L0 tags),
// used to validate the judge's answer.
function validIdsForTruth(truth) {
  const ids = new Set();
  for (const level of truth.levels || []) {
    if (level.id) ids.add(level.id);
    for (const tag of level.tags || []) {
      if (tag.id) ids.add(tag.id);
    }
  }
  return ids;
}

// Ordinal rank of a level so we can tally and sort (L0..L4 -> 0..4). Sub-tags
// (L0a, L0b) rank with their parent level.
function levelRank(id) {
  const match = String(id).match(/^L(\d+)/);
  return match ? Number(match[1]) : -1;
}

// Human label for a level or tag id (e.g. "L3" -> "Gets the mechanism"), used
// in the console output and on the dashboard.
function labelForId(truth, id) {
  if (!id) return "";
  for (const level of truth.levels || []) {
    if (level.id === id) return level.label || "";
    for (const tag of level.tags || []) {
      if (tag.id === id) return tag.label || "";
    }
  }
  return "";
}

function buildTruthJudgePrompt(events, truth) {
  const transcript = events
    .filter((event) => event.speaker === "assistant" || event.speaker === "patient")
    .map((event) => `[turn ${event.turn}] ${event.speaker.toUpperCase()}: ${event.text}`)
    .join("\n");

  // Hand the judge the rubric verbatim, top (closest to target) to bottom.
  const rubric = (truth.levels || [])
    .map((level) => {
      const head = `${level.id} — ${level.label}\n  credit_when: ${level.credit_when}`;
      const tags = (level.tags || [])
        .map((tag) => `    ${tag.id} — ${tag.label}: ${tag.credit_when}`)
        .join("\n");
      return tags ? `${head}\n${tags}` : head;
    })
    .join("\n\n");

  const validIds = [...validIdsForTruth(truth)].join(", ");

  const system = [
    "You are a clinical evaluator grading a cardiovascular-risk counselling conversation between a health ASSISTANT and a simulated PATIENT.",
    "You are given the TRUE underlying picture for this patient (target_ground_truth), a LEVELLED RUBRIC describing how well a conversation can match that truth, and the TRANSCRIPT of what actually happened.",
    "",
    "The rubric is ordered from closest-to-target (highest) down to wrong-picture (lowest). Each level INCLUDES everything in the level below it, so a higher level is only earned when every lower level's bar is also met.",
    "",
    "Your job:",
    "1. Read the transcript against the rubric.",
    "2. Assign the SINGLE HIGHEST level whose credit_when clause is fully satisfied by the transcript. Do not give credit for a level whose requirements are only partially met — drop to the highest level that is genuinely satisfied.",
    "3. If the assigned level carries sub-tags (e.g. an L0 with under-call / over-call tags), also pick the ONE sub-tag that best fits; otherwise leave the tag empty.",
    "Judge ONLY from the transcript for what happened; use the ground truth and rubric only to know what the right answer was. Quote verbatim from the transcript as evidence.",
    "",
    `Valid level ids for THIS persona: ${validIds}.`,
    "Return ONLY a JSON object, no prose, no code fences, with EXACTLY this shape:",
    "{",
    "  \"matched_level\": \"one of the valid level ids above (the highest satisfied level)\",",
    "  \"matched_tag\": \"a sub-tag id if the level has tags and one applies, else empty string\",",
    "  \"confidence\": 0.0,",
    "  \"evidence\": \"one or two short verbatim transcript quotes that justify the level\",",
    "  \"rationale\": \"one to three sentences: why this level and not the one above it\"",
    "}",
    "Rules: matched_level must be exactly one of the valid ids. confidence is 0..1. Keep quotes short and exact."
  ].join("\n");

  const user = [
    `PERSONA: ${truth.persona_label || truth.persona_id}`,
    `TARGET GROUND TRUTH:\n${truth.target_ground_truth}`,
    `LEVELLED RUBRIC (highest first; each level includes the one below):\n${rubric}`,
    `TRANSCRIPT:\n${transcript}`
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

// Validate + coerce the raw judge object against this truth's valid ids.
function normalizeVerdict(raw, truth) {
  const valid = validIdsForTruth(truth);
  let level = typeof raw?.matched_level === "string" ? raw.matched_level.trim() : "";
  if (!valid.has(level)) {
    // Tolerate the judge answering with a tag id (L0a) when we expected L0, or
    // vice versa; fall back to the lowest level if it is unrecognisable.
    const byPrefix = [...valid].find((id) => level && id.startsWith(level));
    level = byPrefix || "";
  }
  let tag = typeof raw?.matched_tag === "string" ? raw.matched_tag.trim() : "";
  if (tag && !valid.has(tag)) tag = "";

  const confidenceRaw = Number(raw?.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : null;

  return {
    matched_level: level,
    matched_tag: tag,
    level_rank: levelRank(level),
    level_label: labelForId(truth, level),
    tag_label: labelForId(truth, tag),
    confidence,
    evidence: typeof raw?.evidence === "string" ? raw.evidence : "",
    rationale: typeof raw?.rationale === "string" ? raw.rationale : ""
  };
}

async function judgeTruthMatch(events, truth, adapter) {
  const completion = await adapter.complete(buildTruthJudgePrompt(events, truth));
  if (!completion.text) {
    const finishReason = completion.raw?.choices?.[0]?.finish_reason;
    throw new Error(`Truth judge returned empty output (finish_reason=${finishReason ?? "unknown"})`);
  }
  return normalizeVerdict(parseJudgeJson(completion.text), truth);
}

// ---- config -------------------------------------------------------------

const appConfig = loadAppConfig();
const runsDir = path.join(PROJECT_ROOT, appConfig.storage.outputDir);
const concurrency = Math.max(1, Number(argValue("--concurrency", "4")) || 1);

const judgeConfig = {
  provider: argValue("--judge-provider", appConfig.judge.provider),
  model: argValue("--judge-model", appConfig.judge.model),
  temperature: Number(argValue("--judge-temperature", String(appConfig.judge.temperature ?? 1))),
  max_tokens: Number(argValue("--judge-max-tokens", String(appConfig.judge.max_tokens ?? 16000)))
};

const truthsById = loadTruthsById();

// The dashboard renders whatever is in LATEST_COMPARISON_FILE (runs[]). We judge
// exactly that set so the "Ground Truth Evaluation" tab lines up 1:1 with the
// "Evaluation" tab, and we write each verdict back INTO those run objects so the
// front-end picks it up with no server changes.
const comparisonPath = path.join(runsDir, appConfig.storage.latestComparisonFile);
const comparison = fs.existsSync(comparisonPath)
  ? JSON.parse(fs.readFileSync(comparisonPath, "utf8"))
  : null;
const comparisonRuns = comparison?.runs || [];
const comparisonById = new Map(comparisonRuns.map((run) => [run.run_id, run]));

// Explicit run ids on the CLI override the default. With no args we judge every
// run on the dashboard (the comparison file's run set).
let runIds = parseRunIds();
if (runIds.length === 0) {
  if (!comparison) {
    console.error(`No run ids given and no comparison file at ${comparisonPath}.`);
    process.exit(1);
  }
  runIds = comparisonRuns.map((run) => run.run_id);
}

// ---- load the runs ------------------------------------------------------

const jobs = [];
for (const runId of runIds) {
  // Prefer the run object embedded in the comparison file (it holds the same
  // events the dashboard shows); fall back to runs/<id>/run.json on disk.
  let run = comparisonById.get(runId);
  if (!run) {
    try {
      run = loadRun(runsDir, runId);
    } catch (error) {
      jobs.push({ run_id: runId, error: error.message });
      continue;
    }
  }
  const scenarioId = run.scenario?.id;
  const truth = scenarioId ? truthsById.get(scenarioId) : null;
  if (!truth) {
    jobs.push({
      run_id: runId,
      scenario_id: scenarioId,
      skipped: true,
      error: `No truth file for scenario.id "${scenarioId}"`
    });
    continue;
  }
  const events = run.events || [];
  if (!events.some((event) => event.speaker === "assistant" && event.text)) {
    jobs.push({ run_id: runId, scenario_id: scenarioId, error: "Run has no assistant turns to judge" });
    continue;
  }
  jobs.push({
    run_id: runId,
    scenario_id: scenarioId,
    scenario_label: run.scenario?.label || scenarioId,
    config_label: run.model_config?.label || run.model_config?.model || "unknown",
    events,
    truth
  });
}

const judgeable = jobs.filter((job) => !job.error);
if (judgeable.length === 0) {
  console.error("No judgeable runs. Details:");
  for (const job of jobs) console.error(`  ${job.run_id}: ${job.error}`);
  process.exit(1);
}

const judgeAdapter = createModelAdapter(judgeConfig);

console.log(`Judge model : ${judgeConfig.provider}/${judgeConfig.model}  (temp ${judgeConfig.temperature})`);
console.log(`Truths      : ${truthsById.size} loaded from data/Truths`);
console.log(`Source      : ${comparison ? appConfig.storage.latestComparisonFile + " (dashboard)" : "run ids from CLI"}`);
console.log(`Runs        : ${judgeable.length} judgeable / ${runIds.length} requested   concurrency ${concurrency}\n`);

// ---- judge --------------------------------------------------------------

let done = 0;
const judged = await runPool(judgeable, concurrency, async (job) => {
  try {
    const verdict = await judgeTruthMatch(job.events, job.truth, judgeAdapter);
    process.stdout.write(`\r  judged ${++done}/${judgeable.length}`);
    return { ...job, verdict, events: undefined, truth: undefined };
  } catch (error) {
    process.stdout.write(`\r  judged ${++done}/${judgeable.length}`);
    return {
      run_id: job.run_id,
      scenario_id: job.scenario_id,
      scenario_label: job.scenario_label,
      config_label: job.config_label,
      error: error.message
    };
  }
});
process.stdout.write("\n\n");

// Merge back the runs that failed to load / were skipped.
const results = [...judged, ...jobs.filter((job) => job.error)];
results.sort((a, b) => runIds.indexOf(a.run_id) - runIds.indexOf(b.run_id));

// ---- report -------------------------------------------------------------

for (const entry of results) {
  console.log(`${entry.run_id}  ${entry.config_label}  ×  ${entry.scenario_label || entry.scenario_id}`);
  if (entry.skipped) {
    console.log(`  SKIPPED: ${entry.error}\n`);
    continue;
  }
  if (entry.error) {
    console.log(`  ERROR: ${entry.error}\n`);
    continue;
  }
  const v = entry.verdict;
  const levelStr = v.matched_tag ? `${v.matched_level} (${v.matched_tag})` : v.matched_level || "?";
  const conf = v.confidence == null ? "" : `   conf ${v.confidence.toFixed(2)}`;
  console.log(`  match     : ${levelStr}${conf}`);
  console.log(`  rationale : ${v.rationale}`);
  if (v.evidence) console.log(`  evidence  : "${v.evidence}"`);
  console.log("");
}

// Tally by top-level bucket (L0..L4), regardless of sub-tag.
const byLevel = new Map();
for (const entry of results) {
  if (!entry.verdict) continue;
  const rank = entry.verdict.level_rank;
  byLevel.set(rank, (byLevel.get(rank) || 0) + 1);
}
const errored = results.filter((entry) => entry.error && !entry.skipped).length;
const skipped = results.filter((entry) => entry.skipped).length;
const scored = [...byLevel.values()].reduce((sum, n) => sum + n, 0);

console.log("Summary");
console.log("-------");
for (let rank = 4; rank >= 0; rank -= 1) {
  const count = byLevel.get(rank) || 0;
  console.log(`  L${rank}: ${count}`);
}
if (skipped) console.log(`  skipped (no truth): ${skipped}`);
if (errored) console.log(`  errored           : ${errored}`);
if (scored) {
  const ranks = results.filter((e) => e.verdict).map((e) => e.verdict.level_rank);
  const mean = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
  const atL3plus = ranks.filter((r) => r >= 3).length;
  console.log(`\n  mean level          : ${mean.toFixed(2)} / 4`);
  console.log(`  L3+ (got mechanism) : ${atL3plus}/${scored}  (${(atL3plus / scored * 100).toFixed(0)}%)`);
}

// ---- persist ------------------------------------------------------------

const store = new LocalRunStore(appConfig.storage.outputDir);
const report = {
  generated_at: new Date().toISOString(),
  judge_model: judgeConfig,
  requested_run_ids: runIds,
  summary: {
    by_level: Object.fromEntries([...byLevel.entries()].map(([rank, n]) => [`L${rank}`, n])),
    scored,
    skipped,
    errored
  },
  results
};
const outPath = store.writeComparison(argValue("--out", "truth-match.json"), report);
console.log(`\nWrote report to ${outPath}`);

// ---- write verdicts onto the dashboard ----------------------------------
// Attach each verdict to its run object inside the comparison file so the
// "Ground Truth Evaluation" tab renders straight from /api/results. Only runs
// that came from the comparison file get updated; disk-only runs are left as
// report-only. Skipped (no-truth) runs have their stale verdict cleared.
if (comparison) {
  let touched = 0;
  const verdictById = new Map(
    results.filter((entry) => entry.verdict).map((entry) => [entry.run_id, entry])
  );
  for (const run of comparisonRuns) {
    const entry = verdictById.get(run.run_id);
    if (entry) {
      run.truth_match = {
        ...entry.verdict,
        judge_model: `${judgeConfig.provider}/${judgeConfig.model}`,
        judged_at: report.generated_at
      };
      touched += 1;
    } else if (runIds.includes(run.run_id) && "truth_match" in run) {
      // Re-judged this run but it has no truth now — drop the stale verdict.
      delete run.truth_match;
    }
  }
  fs.writeFileSync(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  console.log(`Wrote ${touched} verdict(s) onto ${path.relative(PROJECT_ROOT, comparisonPath)} (dashboard)`);
}
