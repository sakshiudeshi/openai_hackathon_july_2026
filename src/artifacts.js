import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHierarchyYaml } from "./yaml.js";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(srcDir, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

export function loadHierarchy() {
  return parseHierarchyYaml(readText("data/hierarchy/cardiovascular_risk_v0.yaml"));
}

export function loadSystemPrompt() {
  return readText("data/prompts/tested_model_system_prompt_v0.txt").trim();
}

export function loadPersonas() {
  const dir = path.join(PROJECT_ROOT, "data/personas");
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
}

export function loadGoldTranscripts() {
  return readJson("data/validation/gold_transcripts.json");
}

export function loadModelConfigs(configPath) {
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(PROJECT_ROOT, configPath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

