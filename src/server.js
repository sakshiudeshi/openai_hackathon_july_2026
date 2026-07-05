import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_ROOT } from "./artifacts.js";
import { loadAppConfig } from "./config.js";
import { generateDemoComparison } from "./demo.js";

const appConfig = loadAppConfig();
const PORT = appConfig.server.port;
const publicDir = path.join(PROJECT_ROOT, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function jsonResponse(status, body) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

export async function resolveRequest(request, options = {}) {
  const demoProvider = options.demoProvider || generateDemoComparison;
  const root = options.publicDir || publicDir;
  const url = new URL(request.url, `http://${request.headers?.host || "localhost"}`);

  if (url.pathname === "/api/demo") {
    return jsonResponse(200, await demoProvider());
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requestedPath));
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return jsonResponse(404, { error: "Not found" });
  }

  const ext = path.extname(filePath);
  return {
    status: 200,
    headers: { "content-type": contentTypes[ext] || "application/octet-stream" },
    body: fs.readFileSync(filePath)
  };
}

export function createServer(options = {}) {
  return http.createServer(async (request, response) => {
    try {
      const resolved = await resolveRequest(request, options);
      response.writeHead(resolved.status, resolved.headers);
      response.end(resolved.body);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCliEntry) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Dashboard available at http://localhost:${PORT}`);
  });
}
