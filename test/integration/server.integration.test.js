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

test("dashboard root serves the JS app shell", async () => {
  const response = await resolveRequest({ url: "/", headers: { host: "localhost" } });
  const body = response.body.toString("utf8");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(body, /Cardiovascular Risk Hierarchy Evaluation/);
  assert.match(body, /\/app.js/);
});

test("dashboard request resolver blocks path traversal", async () => {
  const response = await resolveRequest({ url: "/../package.json", headers: { host: "localhost" } });
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 404);
  assert.deepEqual(payload, { error: "Not found" });
});

