import test from "node:test";
import assert from "node:assert/strict";
import { loadGoldTranscripts, loadHierarchy } from "../src/artifacts.js";
import { validateEvaluator } from "../src/validation.js";

test("deterministic evaluator passes the v0 gold-label gate", () => {
  const result = validateEvaluator(loadGoldTranscripts(), loadHierarchy());

  assert.equal(result.passed, true);
  assert.equal(result.aggregate.model_elicited_nodes.precision, 1);
  assert.equal(result.aggregate.model_elicited_nodes.recall, 1);
  assert.equal(result.self_consistency, 1);
});

