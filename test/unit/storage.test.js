import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildRunManifest, LocalRunStore } from "../../src/storage/localRunStore.js";
import { SupabaseStore } from "../../src/storage/supabaseStore.js";
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

test("supabase store accepts project URL or REST URL", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers });
    return { ok: true };
  };

  try {
    await new SupabaseStore({
      url: "https://project.supabase.co",
      serviceRoleKey: "sb_secret_test"
    }).insert("conversation_events", { id: 1 });
    await new SupabaseStore({
      url: "https://project.supabase.co/rest/v1/",
      serviceRoleKey: "eyJlegacy"
    }).insert("conversation_events", { id: 2 });

    assert.equal(calls[0].url, "https://project.supabase.co/rest/v1/conversation_events");
    assert.equal(calls[1].url, "https://project.supabase.co/rest/v1/conversation_events");
    assert.equal("authorization" in calls[0].headers, false);
    assert.equal(calls[1].headers.authorization, "Bearer eyJlegacy");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("supabase run startup upserts parents before event inserts", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null
    });
    return { ok: true };
  };

  try {
    const store = new SupabaseStore({
      url: "https://project.supabase.co",
      serviceRoleKey: "sb_secret_test"
    });
    await store.recordRunStarted({
      run_id: "A1b2C3d4E5f6",
      hierarchy: {
        id: "hierarchy_v1",
        scope: "scope",
        reviewer: "Reviewer",
        version: "1",
        nodes: [
          { id: "node_a", label: "Node A", rank: 1, risk_tier: "high", required: true, followups: ["one"] }
        ]
      },
      persona: { id: "persona_a", label: "Persona A", opening_prompt: "Hi" },
      modelConfig: { id: "model_a", provider: "openai", model: "gpt-5.4-mini" },
      versions: {
        tested_model_system_prompt_version: "prompt_v1",
        simulator_policy_version: "sim_v1",
        evaluator_rubric_version: "eval_v1"
      }
    });
    await store.recordEvent({
      run_id: "A1b2C3d4E5f6",
      turn: 0,
      speaker: "patient",
      text: "Hi",
      metadata: {}
    });

    assert.deepEqual(
      calls.map((call) => call.url.replace("https://project.supabase.co/rest/v1/", "").split("?")[0]),
      ["hierarchy_versions", "risk_nodes", "model_configs", "patient_scenarios", "eval_runs", "conversation_events"]
    );
    assert.equal(calls[4].body.id, "A1b2C3d4E5f6");
    assert.equal(calls[5].body.run_id, "A1b2C3d4E5f6");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
