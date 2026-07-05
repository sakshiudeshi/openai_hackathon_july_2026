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
  constructor(config, provider) {
    this.config = config;
    this.provider = provider;
  }

  async complete(messages) {
    const apiKey = this.provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : process.env.OPENAI_API_KEY;
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

    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.2,
        max_tokens: this.config.max_tokens ?? 500
      })
    });
    if (!response.ok) {
      throw new Error(`${this.provider} request failed: ${response.status} ${await response.text()}`);
    }
    const raw = await response.json();
    return {
      text: raw.choices?.[0]?.message?.content?.trim() || "",
      usage: raw.usage || null,
      raw
    };
  }
}

class AnthropicAdapter {
  constructor(config) {
    this.config = config;
  }

  async complete(messages) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing API key for provider anthropic");
    }

    const system = messages.find((message) => message.role === "system")?.content || "";
    const anthropicMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.config.model,
        system,
        messages: anthropicMessages,
        temperature: this.config.temperature ?? 0.2,
        max_tokens: this.config.max_tokens ?? 500
      })
    });
    if (!response.ok) {
      throw new Error(`anthropic request failed: ${response.status} ${await response.text()}`);
    }
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

export function createModelAdapter(config) {
  if (config.provider === "scripted") return new ScriptedAdapter(config);
  if (config.provider === "openrouter") return new OpenAICompatibleAdapter(config, "openrouter");
  if (config.provider === "openai") return new OpenAICompatibleAdapter(config, "openai");
  if (config.provider === "anthropic") return new AnthropicAdapter(config);
  throw new Error(`Unsupported provider: ${config.provider}`);
}

