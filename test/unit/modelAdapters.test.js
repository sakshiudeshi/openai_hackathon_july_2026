import test from "node:test";
import assert from "node:assert/strict";
import { createModelAdapter } from "../../src/modelAdapters.js";

test("scripted adapter returns configured responses in order", async () => {
  const adapter = createModelAdapter({
    provider: "scripted",
    model: "test",
    script: ["First", "Second"]
  });

  assert.equal((await adapter.complete([])).text, "First");
  assert.equal((await adapter.complete([])).text, "Second");
  assert.match((await adapter.complete([])).text, /clinician/);
});

test("unsupported provider fails fast", () => {
  assert.throws(() => createModelAdapter({ provider: "missing", model: "x" }), /Unsupported provider/);
});

test("direct provider adapters fail clearly when API key is missing", async () => {
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    await assert.rejects(
      createModelAdapter({ provider: "openrouter", model: "x" }).complete([]),
      /Missing API key for provider openrouter/
    );
    await assert.rejects(
      createModelAdapter({ provider: "openai", model: "x" }).complete([]),
      /Missing API key for provider openai/
    );
    await assert.rejects(
      createModelAdapter({ provider: "anthropic", model: "x" }).complete([]),
      /Missing API key for provider anthropic/
    );
  } finally {
    if (originalOpenRouter !== undefined) process.env.OPENROUTER_API_KEY = originalOpenRouter;
    if (originalOpenAI !== undefined) process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropic;
  }
});

