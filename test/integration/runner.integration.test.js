import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadHierarchy, loadScriptedPersonas, loadSystemPrompt } from "../../src/artifacts.js";
import { PROJECT_ROOT } from "../../src/artifacts.js";
import { runComparison, runScenario } from "../../src/runner.js";
import { demoModelConfigs } from "../../src/scriptedModels.js";
import { LocalRunStore } from "../../src/storage/localRunStore.js";
import { validateAuditInvariants, validateComparisonShape, validateRunResultShape } from "../../src/resultValidation.js";

const hierarchy = loadHierarchy();
const personas = loadScriptedPersonas();
const systemPrompt = loadSystemPrompt();

test("runScenario produces complete auditable result for one persona and scripted model", async () => {
  const result = await runScenario({
    hierarchy,
    persona: personas[0],
    modelConfig: demoModelConfigs()[0],
    systemPrompt,
    turnLimit: 3
  });

  assert.equal(validateRunResultShape(result), true);
  assert.equal(validateAuditInvariants(hierarchy, result), true);
  assert.equal(result.events.length, 7);
  assert(result.evidence.summary.model_elicited_nodes.includes("blood_pressure"));
  assert(result.score.details.covered_required_nodes.includes("blood_pressure"));
});

test("runScenario storage integration writes per-run manifest metadata", async () => {
  const relativeDir = `runs/integration-${Date.now()}`;
  const storage = new LocalRunStore(relativeDir);
  const result = await runScenario({
    hierarchy,
    persona: personas[0],
    modelConfig: demoModelConfigs()[0],
    systemPrompt,
    turnLimit: 1,
    storage
  });
  const manifestPath = path.join(PROJECT_ROOT, relativeDir, result.run_id, "manifest.json");
  const runPath = path.join(PROJECT_ROOT, relativeDir, result.run_id, "run.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(fs.existsSync(runPath), true);
  assert.equal(manifest.run_id, result.run_id);
  assert.equal(manifest.schema_version, "run_manifest_v1");
  assert.equal(manifest.event_count, result.events.length);
  assert.deepEqual(manifest.artifacts, { run: "run.json" });
});

test("runScenario records run startup before streaming events", async () => {
  const calls = [];
  const result = await runScenario({
    hierarchy,
    persona: personas[0],
    modelConfig: demoModelConfigs()[0],
    systemPrompt,
    turnLimit: 1,
    storage: {
      async recordRunStarted(run) {
        calls.push(["started", run.run_id]);
      },
      async recordEvent(event) {
        calls.push(["event", event.run_id]);
      },
      async recordRunResult(run) {
        calls.push(["result", run.run_id]);
      }
    }
  });

  assert.deepEqual(calls[0], ["started", result.run_id]);
  assert.deepEqual(calls.at(-1), ["result", result.run_id]);
  assert(calls.slice(1, -1).every(([kind, runId]) => kind === "event" && runId === result.run_id));
});

test("context-provided scenario removes context node from scoring denominator", async () => {
  const personaWithContext = personas.find((persona) => persona.context_provided_nodes.includes("family_history"));
  const result = await runScenario({
    hierarchy,
    persona: personaWithContext,
    modelConfig: demoModelConfigs()[0],
    systemPrompt,
    turnLimit: 2
  });

  assert.equal(validateAuditInvariants(hierarchy, result), true);
  assert(result.evidence.summary.context_provided_nodes.includes("family_history"));
  assert(!result.score.details.eligible_required_nodes.includes("family_history"));
});

test("runComparison covers every scripted model and persona and sorts model averages", async () => {
  const comparison = await runComparison({
    hierarchy,
    personas,
    modelConfigs: demoModelConfigs(),
    systemPrompt,
    turnLimit: 4
  });

  assert.equal(validateComparisonShape(comparison), true);
  assert.equal(comparison.runs.length, demoModelConfigs().length * personas.length);
  assert.equal(comparison.models[0].model_config.id, "scripted_thorough");
});
