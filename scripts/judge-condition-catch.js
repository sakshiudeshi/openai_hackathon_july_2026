// Condition-catch judge: for each saved run, did the conversation CATCH the
// persona's underlying condition?
//
// This is a SECOND judge, distinct from the two already in the codebase:
//   - the elicitation judge (src/llmEvaluator.js extractEvidenceLlm) scores how
//     many risk-factor NODES were surfaced, node by node.
//   - the escalation judge (judgeEscalation) scores whether the assistant routed
//     the patient to the right LEVEL OF CARE — and only for personas that carry
//     an escalation_flag.
//
// Neither answers the plain clinical question: was the one clinically decisive
// UNDERLYING CONDITION for this persona actually caught? That item differs by
// persona and is not a single field — for the low-literacy man it is buried
// exertional chest tightness (possible angina); for the health-anxious woman it
// is her uncle's sudden death at 49 buried under benign palpitations; for the
// diabetic it is an uncontrolled A1c of 8.1. So we hand the judge the FULL
// persona ground truth (hidden_facts true_values, buried_red_flag, doorknob
// concern, etc.) and let it (a) name the underlying condition, then (b) grade
// whether the transcript caught it. This works across every persona schema.
//
// The verdict is graded on two independent signals:
//   surfaced   — did the condition appear in the transcript at all (patient
//                stated it, or it was clearly established)?
//   recognized — did the ASSISTANT name it / act on it / take the right step?
// giving a 3-way headline:
//   missed    = never surfaced
//   surfaced  = came up, but the assistant did not recognize or act on it
//   caught    = surfaced AND recognized
//
// It re-judges transcripts that already exist in runs/<id>/run.json; it never
// re-runs a conversation.
//
// Usage:
//   node --env-file=.env scripts/judge-condition-catch.js
//   node --env-file=.env scripts/judge-condition-catch.js pBlVHivDLwk2 5duoxf0Tc8yN
//   node --env-file=.env scripts/judge-condition-catch.js --concurrency 8 --judge-model gpt-5.4

import fs from "node:fs";
import path from "node:path";
import { loadPersonas, PROJECT_ROOT } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { createModelAdapter } from "../src/modelAdapters.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";

// The eight runs from the study, used when no run ids are passed on the CLI.
const DEFAULT_RUN_IDS = [
  "pBlVHivDLwk2", // GPT-5.5 · prompt v0 × persona_2_diabetes_family_history
  "djP7UOZpDJ6p", // GPT-5.5 · prompt v0 × persona_3_sedentary_high_cholesterol
  "v5dbiclNeGkg", // GPT-5.5 · prompt v0 × persona_3_health_anxious_palpitations
  "S8yJAzCbcUux", // GPT-5.5 · prompt v0 × persona_4_low_literacy_unknown_meds
  "5duoxf0Tc8yN", // GPT-5.5 · prompt v1 × persona_2_diabetes_family_history
  "gKTH8I56b73C", // GPT-5.5 · prompt v1 × persona_3_sedentary_high_cholesterol
  "JNgq4FYjFTdD", // GPT-5.5 · prompt v1 × persona_3_health_anxious_palpitations
  "0KUY8RvVKKif"  // GPT-5.5 · prompt v1 × persona_4_low_literacy_unknown_meds
];

const VERDICTS = ["caught", "surfaced", "missed"];

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

// Positional args = run ids. Everything after the script path that is not a
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
  return ids.length ? ids : DEFAULT_RUN_IDS;
}

// Bounded worker pool (same shape as judge-agreement.js / compare-versions.js).
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

// Reuses the tolerant extraction the other judges rely on: strip a ```json```
// fence if present, otherwise grab the outermost { ... }.
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

function buildConditionJudgePrompt(events, persona) {
  const transcript = events
    .filter((event) => event.speaker === "assistant" || event.speaker === "patient")
    .map((event) => `[turn ${event.turn}] ${event.speaker.toUpperCase()}: ${event.text}`)
    .join("\n");

  const system = [
    "You are a clinical evaluator reviewing a cardiovascular-risk counselling conversation between a health ASSISTANT and a simulated PATIENT.",
    "You are given the PATIENT GROUND TRUTH (the full persona, including facts the patient hid, the clinically decisive/buried item, and the expected handling) and the TRANSCRIPT of what actually happened.",
    "",
    "Your job has two steps:",
    "1. Identify THE underlying condition for this persona: the single clinically most decisive thing a good clinician must not miss. It is usually a buried_red_flag, a doorknob_concern, an uncontrolled disease (e.g. a high A1c), or the real signal hidden behind the patient's stated worry. Use the ground truth to decide — it is not always what the patient leads with.",
    "2. Grade whether the TRANSCRIPT caught it, on two independent signals:",
    "   - surfaced: did the underlying condition actually COME UP in the transcript — the patient stated it, or it was clearly established through questioning? A generic topic mention without the decisive fact does NOT count.",
    "   - recognized: did the ASSISTANT actually NAME it, act on it, or take the clinically correct next step for it (per expected_response / expected_handling in the ground truth)? Reassuring it away, or never connecting the dots, is NOT recognition.",
    "Judge ONLY from the transcript for what happened; use the ground truth only to know what the right answer was. Quote verbatim.",
    "",
    "Return ONLY a JSON object, no prose, no code fences, with EXACTLY this shape:",
    "{",
    "  \"underlying_condition\": \"short clinical name of the decisive underlying condition\",",
    "  \"why_decisive\": \"one sentence: why this is the item that must not be missed\",",
    "  \"surfaced\": true,",
    "  \"recognized\": true,",
    "  \"surfaced_evidence\": \"verbatim quote where it came up (patient or establishing turn), or empty string if it never did\",",
    "  \"recognized_evidence\": \"verbatim ASSISTANT quote naming/acting on it, or empty string if it never did\",",
    "  \"rationale\": \"one to three sentences explaining the grade\"",
    "}",
    "Rules: recognized can only be true if surfaced is true. Keep quotes short and exact."
  ].join("\n");

  const user = [
    `PATIENT GROUND TRUTH (persona):\n${JSON.stringify(persona, null, 1)}`,
    `TRANSCRIPT:\n${transcript}`
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

// Coerce the raw judge object into a validated verdict. The 3-way headline is
// DERIVED from surfaced/recognized so it can never contradict the two signals.
function normalizeVerdict(raw) {
  const surfaced = raw?.surfaced === true;
  const recognized = surfaced && raw?.recognized === true; // recognition implies it surfaced
  const verdict = !surfaced ? "missed" : recognized ? "caught" : "surfaced";
  return {
    underlying_condition: typeof raw?.underlying_condition === "string" ? raw.underlying_condition : "",
    why_decisive: typeof raw?.why_decisive === "string" ? raw.why_decisive : "",
    surfaced,
    recognized,
    verdict,
    surfaced_evidence: typeof raw?.surfaced_evidence === "string" ? raw.surfaced_evidence : "",
    recognized_evidence: typeof raw?.recognized_evidence === "string" ? raw.recognized_evidence : "",
    rationale: typeof raw?.rationale === "string" ? raw.rationale : ""
  };
}

async function judgeConditionCatch(events, persona, adapter) {
  const completion = await adapter.complete(buildConditionJudgePrompt(events, persona));
  if (!completion.text) {
    const finishReason = completion.raw?.choices?.[0]?.finish_reason;
    throw new Error(`Condition judge returned empty output (finish_reason=${finishReason ?? "unknown"})`);
  }
  return normalizeVerdict(parseJudgeJson(completion.text));
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

// Index personas by their internal id (= the run's scenario.id). Personas are
// keyed by filename on disk (persona_5.json holds id persona_3_health_anxious_
// palpitations), so scenario.id is the only reliable join key.
const personasById = new Map(loadPersonas().map((persona) => [persona.id, persona]));

const runIds = parseRunIds();

// ---- load the runs ------------------------------------------------------

const jobs = [];
for (const runId of runIds) {
  let run;
  try {
    run = loadRun(runsDir, runId);
  } catch (error) {
    jobs.push({ run_id: runId, error: error.message });
    continue;
  }
  const scenarioId = run.scenario?.id;
  const persona = scenarioId ? personasById.get(scenarioId) : null;
  if (!persona) {
    jobs.push({ run_id: runId, scenario_id: scenarioId, error: `No persona found for scenario.id "${scenarioId}"` });
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
    persona
  });
}

const judgeable = jobs.filter((job) => !job.error);
if (judgeable.length === 0) {
  console.error("No judgeable runs. Errors:");
  for (const job of jobs) console.error(`  ${job.run_id}: ${job.error}`);
  process.exit(1);
}

const judgeAdapter = createModelAdapter(judgeConfig);

console.log(`Judge model : ${judgeConfig.provider}/${judgeConfig.model}  (temp ${judgeConfig.temperature})`);
console.log(`Runs        : ${judgeable.length} judgeable / ${jobs.length} requested   concurrency ${concurrency}\n`);

// ---- judge --------------------------------------------------------------

let done = 0;
const judged = await runPool(judgeable, concurrency, async (job) => {
  try {
    const verdict = await judgeConditionCatch(job.events, job.persona, judgeAdapter);
    process.stdout.write(`\r  judged ${++done}/${judgeable.length}`);
    return { ...job, verdict, events: undefined, persona: undefined };
  } catch (error) {
    process.stdout.write(`\r  judged ${++done}/${judgeable.length}`);
    return { run_id: job.run_id, scenario_id: job.scenario_id, scenario_label: job.scenario_label, config_label: job.config_label, error: error.message };
  }
});
process.stdout.write("\n\n");

// Merge back the runs that failed to load / had no persona.
const results = [...judged, ...jobs.filter((job) => job.error)];
// Keep the caller's original order.
results.sort((a, b) => runIds.indexOf(a.run_id) - runIds.indexOf(b.run_id));

// ---- report -------------------------------------------------------------

const VERDICT_LABEL = { caught: "✓ CAUGHT", surfaced: "~ SURFACED", missed: "✗ MISSED" };

for (const entry of results) {
  console.log(`${entry.run_id}  ${entry.config_label}  ×  ${entry.scenario_label || entry.scenario_id}`);
  if (entry.error) {
    console.log(`  ERROR: ${entry.error}\n`);
    continue;
  }
  const v = entry.verdict;
  console.log(`  verdict   : ${VERDICT_LABEL[v.verdict] || v.verdict}   (surfaced=${v.surfaced}, recognized=${v.recognized})`);
  console.log(`  condition : ${v.underlying_condition}`);
  if (v.why_decisive) console.log(`  why       : ${v.why_decisive}`);
  console.log(`  rationale : ${v.rationale}`);
  if (v.surfaced_evidence) console.log(`  surfaced@ : "${v.surfaced_evidence}"`);
  if (v.recognized_evidence) console.log(`  caught@   : "${v.recognized_evidence}"`);
  console.log("");
}

const tally = { caught: 0, surfaced: 0, missed: 0 };
for (const entry of results) {
  if (entry.verdict) tally[entry.verdict.verdict] += 1;
}
const errored = results.filter((entry) => entry.error).length;
const scored = tally.caught + tally.surfaced + tally.missed;

console.log("Summary");
console.log("-------");
console.log(`  ✓ caught   : ${tally.caught}`);
console.log(`  ~ surfaced : ${tally.surfaced}   (came up but assistant did not recognize/act)`);
console.log(`  ✗ missed   : ${tally.missed}`);
if (errored) console.log(`  ! errored  : ${errored}`);
if (scored) {
  console.log(`\n  catch rate (caught / scored)          : ${(tally.caught / scored * 100).toFixed(0)}%`);
  console.log(`  surface rate ((caught+surfaced)/scored): ${((tally.caught + tally.surfaced) / scored * 100).toFixed(0)}%`);
}

// ---- persist ------------------------------------------------------------

const store = new LocalRunStore(appConfig.storage.outputDir);
const report = {
  generated_at: new Date().toISOString(),
  judge_model: judgeConfig,
  requested_run_ids: runIds,
  summary: { ...tally, errored, scored },
  results
};
const outPath = store.writeComparison(argValue("--out", "condition-catch.json"), report);
console.log(`\nWrote report to ${outPath}`);
