import test from "node:test";
import assert from "node:assert/strict";
import { generateDemoComparison } from "../../src/demo.js";
import { validateAuditInvariants, validateComparisonShape } from "../../src/resultValidation.js";

test("demo comparison payload passes schema and audit invariant validation", async () => {
  const demo = await generateDemoComparison({ force: true });

  assert.equal(demo.validation.passed, true);
  assert.equal(validateComparisonShape(demo.comparison), true);
  for (const run of demo.comparison.runs) {
    assert.equal(validateAuditInvariants(demo.hierarchy, run), true);
  }
});

test("demo leaderboard has expected relative ordering for scripted baselines", async () => {
  const demo = await generateDemoComparison();
  const labels = demo.comparison.models.map((model) => model.model_config.label);

  assert.equal(labels[0], "Thorough ordered");
  assert(labels.indexOf("Labs first") < labels.indexOf("Generic advice"));
});

