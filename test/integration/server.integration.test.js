import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequest } from "../../src/server.js";
import { validateComparisonShape } from "../../src/resultValidation.js";

test("dashboard API returns demo comparison data with validation summary", async () => {
  const response = await resolveRequest({ url: "/api/demo", headers: { host: "localhost" } });
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.equal(payload.validation.passed, true);
  assert.equal(validateComparisonShape(payload.comparison), true);
});

test("dashboard API returns latest comparison payload when provided", async () => {
  const latestPayload = {
    hierarchy: { nodes: [] },
    personas: [],
    validation: { passed: true },
    comparison: {
      generated_at: "2026-07-05T00:00:00.000Z",
      models: [],
      runs: []
    },
    source: {
      kind: "latest",
      label: "Latest real run",
      path: "runs/latest-comparison.json"
    }
  };
  const response = await resolveRequest(
    { url: "/api/results", headers: { host: "localhost" } },
    { latestProvider: async () => latestPayload }
  );
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.source.kind, "latest");
  assert.equal(payload.source.path, "runs/latest-comparison.json");
});

test("dashboard root serves the JS app shell", async () => {
  const response = await resolveRequest({ url: "/", headers: { host: "localhost" } });
  const body = response.body.toString("utf8");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(body, /Cardiovascular Risk Hierarchy Evaluation/);
  // The dashboard is a client-rendered SPA: the shell only ships a mount point
  // and the app script, which renders the run list.
  assert.match(body, /<main id="app">/);
  assert.match(body, /\/app.js/);
});

test("dashboard request resolver blocks path traversal", async () => {
  const response = await resolveRequest({ url: "/../package.json", headers: { host: "localhost" } });
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 404);
  assert.deepEqual(payload, { error: "Not found" });
});
