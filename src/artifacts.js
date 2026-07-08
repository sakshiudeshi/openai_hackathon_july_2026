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

export const DEFAULT_SYSTEM_PROMPT_PATH = "data/prompts/tested_model_system_prompt_v0.txt";

export function loadSystemPromptFrom(relativePath) {
  return readText(relativePath).trim();
}

export function loadSystemPrompt() {
  return loadSystemPromptFrom(DEFAULT_SYSTEM_PROMPT_PATH);
}

export function loadPatientHarnessPrompt() {
  return readText("data/prompts/patient_harness_prompt.txt");
}

export function loadPersonas() {
  const dir = path.join(PROJECT_ROOT, "data/personas");
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
}

// The scripted PatientSimulator is the v1/flat path: it discloses a fact's
// `answer` string on cue. Richer v2 personas instead split each fact into
// `stated_value`/`true_value` gated by a reveal condition and are meant to be
// driven by the LLM patient harness (see usesHarness in llmPatient.js), so they
// have no `answer` for the scripted simulator to speak. The deterministic
// scripted comparison therefore runs only the flat personas.
export function isFlatPersona(persona) {
  return Object.values(persona.hidden_facts || {}).every(
    (fact) => fact && fact.stated_value == null && fact.true_value == null
  );
}

export function loadScriptedPersonas() {
  return loadPersonas().filter(isFlatPersona);
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

