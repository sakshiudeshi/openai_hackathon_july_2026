import test from "node:test";
import assert from "node:assert/strict";
import { makeRunId } from "../../src/runner.js";
import { isRunId } from "../../src/resultValidation.js";

test("run IDs are exactly 12 alphanumeric characters", () => {
  const runId = makeRunId(new Set());

  assert.equal(isRunId(runId), true);
  assert.match(runId, /^[A-Za-z0-9]{12}$/);
  assert.match(runId, /[A-Za-z]/);
  assert.match(runId, /\d/);
});

test("run ID generator avoids duplicates within an issued set", () => {
  const issued = new Set();
  const runIds = Array.from({ length: 1000 }, () => makeRunId(issued));

  assert.equal(new Set(runIds).size, runIds.length);
  assert.equal(issued.size, runIds.length);
});
