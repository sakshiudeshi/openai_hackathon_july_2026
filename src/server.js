import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadGoldTranscripts,
  loadHierarchy,
  loadPatientHarnessPrompt,
  loadPersonas,
  loadPersonasDetailed,
  PROJECT_ROOT,
} from "./artifacts.js";
import { loadAppConfig } from "./config.js";
import { generateDemoComparison } from "./demo.js";
import {
  resolveSimulationRequest,
  runLiveSimulation,
} from "./liveSimulation.js";
import { validateEvaluator } from "./validation.js";

const appConfig = loadAppConfig();
const PORT = appConfig.server.port;
const publicDir = path.join(PROJECT_ROOT, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function jsonResponse(status, body) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function publicPersonas(personas) {
  return personas.map((persona) => ({
    id: persona.id,
    label: persona.label,
    opening_prompt: persona.opening_prompt,
    context_provided_nodes: persona.context_provided_nodes || [],
  }));
}

async function loadLatestComparisonPayload(config = appConfig) {
  const comparisonPath = path.join(
    PROJECT_ROOT,
    config.storage.outputDir,
    config.storage.latestComparisonFile,
  );
  if (!fs.existsSync(comparisonPath)) {
    const demo = await generateDemoComparison();
    return {
      ...demo,
      source: {
        kind: "demo",
        label: "Scripted demo",
        path: null,
      },
    };
  }

  const hierarchy = loadHierarchy();
  const personas = loadPersonas();
  return {
    hierarchy,
    personas: publicPersonas(personas),
    validation: validateEvaluator(loadGoldTranscripts(), hierarchy),
    comparison: JSON.parse(fs.readFileSync(comparisonPath, "utf8")),
    source: {
      kind: "latest",
      label: "Latest real run",
      path: path.relative(PROJECT_ROOT, comparisonPath),
    },
  };
}

export async function resolveRequest(request, options = {}) {
  const demoProvider = options.demoProvider || generateDemoComparison;
  const latestProvider = options.latestProvider || loadLatestComparisonPayload;
  const root = options.publicDir || publicDir;
  const url = new URL(
    request.url,
    `http://${request.headers?.host || "localhost"}`,
  );

  if (url.pathname === "/api/demo") {
    return jsonResponse(200, {
      ...(await demoProvider()),
      source: {
        kind: "demo",
        label: "Scripted demo",
        path: null,
      },
    });
  }

  if (url.pathname === "/api/results") {
    return jsonResponse(200, await latestProvider());
  }

  // Full persona definitions for the Patient Profiles tab. Unlike the trimmed
  // `personas` in /api/results (used for filtering runs), this exposes the whole
  // persona so the UI can showcase goals, affect, hidden facts, and red flags.
  if (url.pathname === "/api/personas") {
    return jsonResponse(200, {
      hierarchy: loadHierarchy(),
      personas: loadPersonasDetailed(),
    });
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requestedPath));
  if (
    !filePath.startsWith(root) ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    return jsonResponse(404, { error: "Not found" });
  }

  const ext = path.extname(filePath);
  return {
    status: 200,
    headers: {
      "content-type": contentTypes[ext] || "application/octet-stream",
    },
    body: fs.readFileSync(filePath),
  };
}

// Read and JSON-parse a request body, rejecting anything larger than ~256 KiB
// (a prompt + config payload is tiny; this just caps abuse).
function readJsonBody(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

// The bundled data the live simulation needs, read fresh off disk so a dev
// editing a persona or the hierarchy sees changes without a rebuild. The
// Cloudflare Pages Function builds the same shape from the generated bundle.
function buildSimulationData() {
  const personasDetailed = loadPersonasDetailed();
  return {
    hierarchy: loadHierarchy(),
    patientHarnessPrompt: loadPatientHarnessPrompt(),
    personaByKey: (key) => personasDetailed.find((entry) => entry.key === key) || null,
  };
}

// Streaming NDJSON endpoint that runs one live "Try It" simulation. Input is
// validated up front so bad requests still get a real 400; once the stream is
// open, run-time failures arrive as an `error` row (see runLiveSimulation).
async function handleSimulate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  const data = buildSimulationData();
  try {
    resolveSimulationRequest(payload, data);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "access-control-allow-origin": "*",
  });

  const emit = (row) => {
    if (!response.writableEnded) response.write(`${JSON.stringify(row)}\n`);
  };
  await runLiveSimulation({ payload, data, apiKeys: process.env, emit });
  response.end();
}

export function createServer(options = {}) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers?.host || "localhost"}`,
      );
      // CORS preflight, so the endpoint also works when the static site is hosted
      // on a different origin (e.g. Cloudflare Pages) than this API.
      if (request.method === "OPTIONS" && url.pathname === "/api/simulate") {
        response.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/simulate") {
        await handleSimulate(request, response);
        return;
      }

      const resolved = await resolveRequest(request, options);
      response.writeHead(resolved.status, resolved.headers);
      response.end(resolved.body);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error.message });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });
}

const isCliEntry =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCliEntry) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Dashboard available at http://localhost:${PORT}`);
  });
}
