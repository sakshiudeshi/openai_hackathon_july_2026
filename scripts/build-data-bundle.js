#!/usr/bin/env node
// Snapshot the on-disk data artifacts (hierarchy YAML, personas, prompt files)
// into a single self-contained ESM module: src/generated/dataBundle.js.
//
// Why: the live simulation runs both under Node (src/server.js, which can read
// these files off disk via src/artifacts.js) AND inside a Cloudflare Pages
// Function, where there is no filesystem. The Worker imports this generated
// bundle instead of using fs. Regenerate it whenever the underlying data
// changes; the build (build-pages.js) runs this first so the deployed Worker
// always ships the current data.
//
// Usage: node scripts/build-data-bundle.js

import fs from "node:fs";
import path from "node:path";
import {
  PROJECT_ROOT,
  loadHierarchy,
  loadPatientHarnessPrompt,
  loadPersonasDetailed,
  loadSystemPromptFrom,
} from "../src/artifacts.js";

const OUT_DIR = path.join(PROJECT_ROOT, "src", "generated");
const OUT_FILE = path.join(OUT_DIR, "dataBundle.js");

function main() {
  const hierarchy = loadHierarchy();
  const personasDetailed = loadPersonasDetailed();
  const patientHarnessPrompt = loadPatientHarnessPrompt();
  const testedPromptSimple = loadSystemPromptFrom(
    "data/prompts/tested_model_system_prompt_simple.txt",
  );
  const testedPromptCoach = loadSystemPromptFrom(
    "data/prompts/tested_model_system_prompt_coach.txt",
  );

  // JSON.stringify produces valid JS literals for plain data and correctly
  // escapes the prompt strings, so the emitted module is safe to `import`.
  const banner =
    "// GENERATED FILE — do not edit by hand.\n" +
    "// Produced by scripts/build-data-bundle.js from data/. Run `npm run build:data`\n" +
    "// (or `npm run build:pages`) to refresh. Bundles the hierarchy, personas, and\n" +
    "// prompt text so the live simulation can run without filesystem access\n" +
    "// (e.g. inside a Cloudflare Pages Function).\n\n";

  const body =
    `export const hierarchy = ${JSON.stringify(hierarchy)};\n\n` +
    `export const personasDetailed = ${JSON.stringify(personasDetailed)};\n\n` +
    `export const patientHarnessPrompt = ${JSON.stringify(patientHarnessPrompt)};\n\n` +
    `export const testedPromptSimple = ${JSON.stringify(testedPromptSimple)};\n\n` +
    `export const testedPromptCoach = ${JSON.stringify(testedPromptCoach)};\n\n` +
    "export function personaByKey(key) {\n" +
    "  return personasDetailed.find((entry) => entry.key === key) || null;\n" +
    "}\n";

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, banner + body);
  const bytes = fs.statSync(OUT_FILE).size;
  console.log(
    `[build-data-bundle] wrote ${path.relative(PROJECT_ROOT, OUT_FILE)} ` +
      `(${(bytes / 1024).toFixed(1)} KiB, ${personasDetailed.length} personas)`,
  );
}

main();
