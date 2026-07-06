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

test("openai chat adapter uses max_completion_tokens", async () => {
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  let requestBody = null;

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: "ok" } }],
          usage: { total_tokens: 1 }
        };
      }
    };
  };

  try {
    const adapter = createModelAdapter({
      provider: "openai",
      model: "gpt-5.4-mini",
      max_tokens: 500
    });
    assert.equal((await adapter.complete([{ role: "user", content: "Hi" }])).text, "ok");
    assert.equal(requestBody.max_completion_tokens, 500);
    assert.equal("max_tokens" in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAI;
  }
});
