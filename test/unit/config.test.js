import test from "node:test";
import assert from "node:assert/strict";
import { loadAppConfig } from "../../src/config.js";

test("app config loads central defaults", () => {
  const config = loadAppConfig({ APP_CONFIG_PATH: "config/default.json" });

  assert.equal(config.server.port, 5173);
  assert.equal(config.run.turnLimit, 10);
  assert.equal(config.modelConfigs.path, "config/model_configs.json");
  assert.equal(config.storage.outputDir, "runs");
  assert.equal(config.storage.latestComparisonFile, "latest-comparison.json");
  assert.equal(config.storage.demoComparisonFile, "demo-results.json");
});

test("app config applies environment overrides", () => {
  const config = loadAppConfig({
    APP_CONFIG_PATH: "config/default.json",
    PORT: "6000",
    RUN_TURN_LIMIT: "6",
    MODEL_CONFIG_PATH: "tmp/models.json",
    RUN_OUTPUT_DIR: "tmp/runs",
    LATEST_COMPARISON_FILE: "latest-test.json",
    DEMO_COMPARISON_FILE: "demo-test.json"
  });

  assert.equal(config.server.port, 6000);
  assert.equal(config.run.turnLimit, 6);
  assert.equal(config.modelConfigs.path, "tmp/models.json");
  assert.equal(config.storage.outputDir, "tmp/runs");
  assert.equal(config.storage.latestComparisonFile, "latest-test.json");
  assert.equal(config.storage.demoComparisonFile, "demo-test.json");
});

test("app config rejects non-numeric env overrides for numeric fields", () => {
  assert.throws(
    () => loadAppConfig({ APP_CONFIG_PATH: "config/default.json", RUN_TURN_LIMIT: "many" }),
    /RUN_TURN_LIMIT must be a number/
  );
});
