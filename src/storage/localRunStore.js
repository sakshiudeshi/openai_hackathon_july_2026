import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../artifacts.js";

export function buildRunManifest(result) {
  const events = result.events || [];
  const assistantTurns = events
    .filter((event) => event.speaker === "assistant")
    .map((event) => event.turn);

  return {
    schema_version: "run_manifest_v1",
    run_id: result.run_id,
    model_config: result.model_config || null,
    scenario: result.scenario || null,
    versions: result.versions || null,
    sampling_settings: result.sampling_settings || null,
    score: result.score || null,
    event_count: events.length,
    assistant_turn_count: assistantTurns.length,
    stop_reason: result.conversation?.stop_reason || null,
    started_at: events[0]?.timestamp || null,
    completed_at: events.at(-1)?.timestamp || null,
    artifacts: {
      run: "run.json"
    }
  };
}

export class LocalRunStore {
  constructor(relativeDir = "runs") {
    this.dir = path.join(PROJECT_ROOT, relativeDir);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async recordEvent() {
    // Events are persisted as part of the final run result for local v0.
  }

  async recordRunResult(result) {
    const runDir = path.join(this.dir, result.run_id);
    fs.mkdirSync(runDir, { recursive: true });

    const runPath = path.join(runDir, "run.json");
    const manifestPath = path.join(runDir, "manifest.json");
    fs.writeFileSync(runPath, `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(manifestPath, `${JSON.stringify(buildRunManifest(result), null, 2)}\n`);
  }

  writeComparison(name, comparison) {
    const filePath = path.join(this.dir, name);
    fs.writeFileSync(filePath, `${JSON.stringify(comparison, null, 2)}\n`);
    return filePath;
  }
}
