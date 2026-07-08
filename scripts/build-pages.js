#!/usr/bin/env node
// Bundle the dashboard into a fully static site for Cloudflare Pages.
//
// The live dashboard is a single-page app that fetches its data from the
// `/api/results` endpoint. Cloudflare Pages just serves static files, so this
// script snapshots that same payload to a static JSON file, copies the frontend
// assets, and rewrites the absolute URLs to relative ones so the site is
// location-independent. The snapshot is produced by the offline scripted-demo
// path, so the build needs no API keys and Cloudflare stores no secrets.
//
// Usage:
//   node scripts/build-pages.js                       # build into ./dist
//   node scripts/build-pages.js --deploy               # build, then publish to Cloudflare Pages
//   node scripts/build-pages.js --deploy --project=my-name
//
// Deploying uses Wrangler and expects Cloudflare credentials in the shell env
// (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID), or a prior `wrangler login`.
// These are Cloudflare account credentials and are unrelated to the app's .env.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PROJECT_ROOT } from "../src/artifacts.js";
import { resolveRequest } from "../src/server.js";

const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const DATA_DIR = path.join(DIST_DIR, "data");
const RESULTS_FILE = path.join(DATA_DIR, "results.json");
const PERSONAS_FILE = path.join(DATA_DIR, "personas.json");

const argv = process.argv.slice(2);
const args = new Set(argv);
const shouldDeploy = args.has("--deploy");
const projectArg = argv.find((arg) => arg.startsWith("--project="))?.split("=")[1];
const CF_PROJECT = projectArg || process.env.CF_PAGES_PROJECT || "cardio-risk-dashboard";

function log(message) {
  console.log(`[build-pages] ${message}`);
}

// Ask the server's own request resolver for the exact payload behind an API
// route, so the static snapshot stays in sync with what the live dashboard
// serves. Used for both /api/results and /api/personas.
async function snapshotRoute(route) {
  const resolved = await resolveRequest({ url: route, headers: { host: "localhost" } });
  if (resolved.status !== 200) {
    throw new Error(`${route} returned status ${resolved.status}`);
  }
  return typeof resolved.body === "string" ? resolved.body : resolved.body.toString("utf8");
}

// GitHub Pages hosts the site under /<repo>/, so absolute paths that begin with
// "/" resolve against the domain root and 404. Rewrite them to relative paths,
// and point the data fetch at the static snapshot instead of the API.
function patchAsset(name, contents) {
  if (name === "index.html") {
    return contents
      .replaceAll('href="/styles.css"', 'href="./styles.css"')
      .replaceAll('src="/app.js"', 'src="./app.js"');
  }
  if (name === "app.js") {
    return contents
      .replaceAll('fetch("/api/results")', 'fetch("./data/results.json")')
      .replaceAll('fetch("/api/personas")', 'fetch("./data/personas.json")');
  }
  return contents;
}

function copyPublicAssets() {
  for (const name of fs.readdirSync(PUBLIC_DIR)) {
    const source = path.join(PUBLIC_DIR, name);
    if (fs.statSync(source).isDirectory()) continue;
    const isText = /\.(html|js|css|json|svg)$/.test(name);
    if (isText) {
      const patched = patchAsset(name, fs.readFileSync(source, "utf8"));
      fs.writeFileSync(path.join(DIST_DIR, name), patched);
    } else {
      fs.copyFileSync(source, path.join(DIST_DIR, name));
    }
    log(`copied ${name}`);
  }
}

// Upload ./dist to Cloudflare Pages via Wrangler. Wrangler resolves credentials
// from CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (for CI / non-interactive use)
// or from a prior interactive `wrangler login`. The static site holds no secrets,
// so nothing from the app's .env is needed here.
function deployToCloudflare() {
  log(`deploying to Cloudflare Pages project "${CF_PROJECT}"`);
  try {
    execFileSync(
      "npx",
      [
        "--yes",
        "wrangler@latest",
        "pages",
        "deploy",
        DIST_DIR,
        `--project-name=${CF_PROJECT}`,
        "--commit-dirty=true"
      ],
      { stdio: "inherit", cwd: PROJECT_ROOT }
    );
  } catch (error) {
    throw new Error(
      "wrangler deploy failed. Ensure the Pages project exists (create it once with " +
        `\`npx wrangler pages project create ${CF_PROJECT}\`) and that CLOUDFLARE_API_TOKEN ` +
        "and CLOUDFLARE_ACCOUNT_ID are set (or run `npx wrangler login`)."
    );
  }
  log("deploy complete — Cloudflare printed the live URL above");
}

async function main() {
  log("building static dashboard");
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const results = await snapshotRoute("/api/results");
  fs.writeFileSync(RESULTS_FILE, results);
  log(`wrote ${path.relative(PROJECT_ROOT, RESULTS_FILE)} (${(results.length / 1024).toFixed(1)} KiB)`);

  const personas = await snapshotRoute("/api/personas");
  fs.writeFileSync(PERSONAS_FILE, personas);
  log(`wrote ${path.relative(PROJECT_ROOT, PERSONAS_FILE)} (${(personas.length / 1024).toFixed(1)} KiB)`);

  copyPublicAssets();
  log(`static site ready in ${path.relative(PROJECT_ROOT, DIST_DIR)}/`);

  if (shouldDeploy) {
    deployToCloudflare();
  } else {
    log("run with --deploy to publish to Cloudflare Pages");
  }
}

main().catch((error) => {
  console.error(`[build-pages] failed: ${error.stack || error.message}`);
  process.exit(1);
});
