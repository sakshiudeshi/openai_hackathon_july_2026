import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildRunManifest, LocalRunStore } from "../../src/storage/localRunStore.js";
import { PROJECT_ROOT } from "../../src/artifacts.js";

test("local run store writes per-run run.json, manifest.json, and comparison JSON artifacts", () => {
  const relativeDir = `runs/test-${Date.now()}`;
  const store = new LocalRunStore(relativeDir);
  const result = {
    run_id: "A1b2C3d4E5f6",
    model_config: { provider: "scripted", model: "unit" },
    scenario: { id: "persona_unit" },
    versions: { simulator_policy_version: "test" },
    sampling_settings: { temperature: 0 },
    score: { bottom_to_roof_score: 1 },
    events: [
      { run_id: "A1b2C3d4E5f6", turn: 0, speaker: "patient", text: "hello", timestamp: "2026-07-05T00:00:00.000Z" },
      { run_id: "A1b2C3d4E5f6", turn: 1, speaker: "assistant", text: "hi", timestamp: "2026-07-05T00:00:01.000Z" }
    ]
  };
  const comparison = { generated_at: "now", runs: [result] };

  store.recordRunResult(result);
  const comparisonPath = store.writeComparison("comparison.json", comparison);

  const runPath = path.join(PROJECT_ROOT, relativeDir, "A1b2C3d4E5f6", "run.json");
  const manifestPath = path.join(PROJECT_ROOT, relativeDir, "A1b2C3d4E5f6", "manifest.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(runPath, "utf8")), result);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")), buildRunManifest(result));
  assert.deepEqual(JSON.parse(fs.readFileSync(comparisonPath, "utf8")), comparison);
});

test("run manifest contains metadata and points to the full run artifact", () => {
  const manifest = buildRunManifest({
    run_id: "A1b2C3d4E5f6",
    model_config: { provider: "scripted", model: "unit" },
    scenario: { id: "persona_unit" },
    score: { bottom_to_roof_score: 2 },
    events: [
      { speaker: "patient", turn: 0, timestamp: "2026-07-05T00:00:00.000Z" },
      { speaker: "assistant", turn: 1, timestamp: "2026-07-05T00:00:01.000Z" },
      { speaker: "patient", turn: 1, timestamp: "2026-07-05T00:00:02.000Z" }
    ]
  });

  assert.equal(manifest.schema_version, "run_manifest_v1");
  assert.equal(manifest.run_id, "A1b2C3d4E5f6");
  assert.equal(manifest.event_count, 3);
  assert.equal(manifest.assistant_turn_count, 1);
  assert.equal(manifest.started_at, "2026-07-05T00:00:00.000Z");
  assert.equal(manifest.completed_at, "2026-07-05T00:00:02.000Z");
  assert.deepEqual(manifest.artifacts, { run: "run.json" });
});
