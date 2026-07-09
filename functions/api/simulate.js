// Cloudflare Pages Function: POST /api/simulate
//
// The live counterpart to the Node dev server's /api/simulate route. It streams
// newline-delimited JSON rows (run_started, per-turn event, final score, or
// error) for one live "Try It" simulation. The heavy lifting lives in the
// shared, host-agnostic src/liveSimulation.js; this file only adapts the Workers
// runtime (Request/Response + ReadableStream + the `env` secret binding) to it.
//
// Data comes from the generated bundle (src/generated/dataBundle.js) rather than
// the filesystem, because a Worker has none. Provider API keys arrive as Pages
// secrets on `env` (set once with: wrangler pages secret put OPENAI_API_KEY).
//
// Requires `nodejs_compat` (see wrangler.toml): the shared engine transitively
// imports node:fs via src/artifacts.js, but the live path never calls it — the
// flag just lets that import resolve.

import {
  hierarchy,
  patientHarnessPrompt,
  personaByKey,
} from "../../src/generated/dataBundle.js";
import {
  resolveSimulationRequest,
  runLiveSimulation,
} from "../../src/liveSimulation.js";

const data = { hierarchy, patientHarnessPrompt, personaByKey };

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: "Request body is not valid JSON" });
  }

  // Validate before opening the stream so bad input gets a real HTTP 400.
  try {
    resolveSimulationRequest(payload, data);
  } catch (error) {
    return jsonResponse(error.status || 400, { error: error.message });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (row) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(row)}\n`));
      };
      // runLiveSimulation catches its own run-time errors and emits an `error`
      // row, so the stream always closes cleanly.
      await runLiveSimulation({ payload, data, apiKeys: env, emit });
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      ...CORS_HEADERS,
    },
  });
}
