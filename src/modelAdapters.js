const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps fetch with exponential backoff. Retries on transient network failures
// (ETIMEDOUT, ECONNRESET, socket hang-ups surfaced as "fetch failed") and on
// retryable HTTP statuses. Client errors like 400 are permanent and thrown
// immediately so we don't spin on a bad request (e.g. an unsupported param).
async function fetchWithRetry(url, options, { label, maxAttempts = 5 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (networkError) {
      // fetch itself rejected: no HTTP response (DNS, timeout, reset). Retry.
      if (attempt === maxAttempts) throw networkError;
      await backoff(attempt, label, networkError.message);
      continue;
    }

    if (response.ok) return response;

    const body = await response.text();
    const failure = new Error(`${label} request failed: ${response.status} ${body}`);
    // Permanent client errors (e.g. 400 unsupported param) must not be retried.
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
      throw failure;
    }
    await backoff(attempt, label, `${response.status} ${body.slice(0, 100)}`);
  }
}

async function backoff(attempt, label, reason) {
  const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
  console.warn(`  ${label} attempt ${attempt} failed (${String(reason).slice(0, 120)}); retrying in ${backoffMs}ms`);
  await sleep(backoffMs);
}

class ScriptedAdapter {
  constructor(config) {
    this.config = config;
    this.callCount = 0;
  }

  async complete() {
    const text = this.config.script[this.callCount]
      || "I would encourage discussing your risk with a clinician. Is there another specific factor you want to share?";
    this.callCount += 1;
    return {
      text,
      usage: null,
      raw: { scripted_index: this.callCount - 1 }
    };
  }
}

class OpenAICompatibleAdapter {
  constructor(config, provider, apiKeys) {
    this.config = config;
    this.provider = provider;
    this.apiKeys = apiKeys;
  }

  async complete(messages) {
    const apiKey = this.provider === "openrouter"
      ? this.apiKeys.OPENROUTER_API_KEY
      : this.apiKeys.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(`Missing API key for provider ${this.provider}`);
    }

    const baseUrl = this.provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const headers = {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    };
    if (this.provider === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost:5173";
      headers["X-Title"] = "Cardio Risk Hierarchy Eval v0";
    }

    const tokenLimit = this.config.max_completion_tokens ?? this.config.max_tokens ?? 500;
    const tokenLimitParam = this.provider === "openai"
      ? { max_completion_tokens: tokenLimit }
      : { max_tokens: tokenLimit };

    const response = await fetchWithRetry(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.2,
        ...tokenLimitParam
      })
    }, { label: this.provider, maxAttempts: this.config.maxAttempts ?? 5 });
    const raw = await response.json();
    return {
      text: raw.choices?.[0]?.message?.content?.trim() || "",
      usage: raw.usage || null,
      raw
    };
  }
}

class AnthropicAdapter {
  constructor(config, apiKeys) {
    this.config = config;
    this.apiKeys = apiKeys;
  }

  async complete(messages) {
    if (!this.apiKeys.ANTHROPIC_API_KEY) {
      throw new Error("Missing API key for provider anthropic");
    }

    const system = messages.find((message) => message.role === "system")?.content || "";
    const anthropicMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));

    const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKeys.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.config.model,
        system,
        messages: anthropicMessages,
        temperature: this.config.temperature ?? 0.2,
        max_tokens: this.config.max_tokens ?? 500
      })
    }, { label: "anthropic", maxAttempts: this.config.maxAttempts ?? 5 });
    const raw = await response.json();
    return {
      text: (raw.content || [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim(),
      usage: raw.usage || null,
      raw
    };
  }
}

// `options.apiKeys` supplies the provider API keys as a plain object
// ({ OPENAI_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY }). It defaults to
// process.env so every existing Node caller (scripts, tests) is unchanged, while
// Cloudflare Pages Functions — where there is no process.env — can pass the
// Worker's `env` binding through instead.
export function createModelAdapter(config, options = {}) {
  const apiKeys = options.apiKeys
    || (typeof process !== "undefined" && process.env ? process.env : {});
  if (config.provider === "scripted") return new ScriptedAdapter(config);
  if (config.provider === "openrouter") return new OpenAICompatibleAdapter(config, "openrouter", apiKeys);
  if (config.provider === "openai") return new OpenAICompatibleAdapter(config, "openai", apiKeys);
  if (config.provider === "anthropic") return new AnthropicAdapter(config, apiKeys);
  throw new Error(`Unsupported provider: ${config.provider}`);
}
