import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(srcDir, "..");

export function loadDotEnvFile(env = process.env, filePath = path.join(PROJECT_ROOT, ".env")) {
  if (!fs.existsSync(filePath)) return false;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return true;
}

function readJson(relativeOrAbsolutePath) {
  const resolvedPath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(PROJECT_ROOT, relativeOrAbsolutePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function numberFromEnv(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function stringFromEnv(value, fallback) {
  return value === undefined || value === "" ? fallback : value;
}

function boolFromEnv(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return fallback;
}

export function loadAppConfig(env = process.env) {
  if (env === process.env) loadDotEnvFile(env);

  const configPath = stringFromEnv(env.APP_CONFIG_PATH, "config/default.json");
  const defaults = readJson(configPath);

  return {
    server: {
      port: numberFromEnv(env.PORT, defaults.server?.port ?? 5173, "PORT")
    },
    run: {
      turnLimit: numberFromEnv(
        env.RUN_TURN_LIMIT ?? env.EVAL_TURN_LIMIT ?? env.TURN_LIMIT,
        defaults.run?.turnLimit ?? 10,
        "RUN_TURN_LIMIT"
      )
    },
    engine: stringFromEnv(env.EVAL_ENGINE ?? env.ENGINE, defaults.engine ?? "scripted"),
    scoring: {
      // Noise penalty is disabled by default: it is still detected and shown as
      // flags, but does not subtract from the composite score.
      noisePenalty: boolFromEnv(env.SCORING_NOISE_PENALTY, defaults.scoring?.noisePenalty ?? false)
    },
    patient: {
      provider: stringFromEnv(env.PATIENT_PROVIDER, defaults.patient?.provider ?? "openai"),
      model: stringFromEnv(env.PATIENT_MODEL, defaults.patient?.model ?? "gpt-5.4-mini"),
      temperature: numberFromEnv(
        env.PATIENT_TEMPERATURE,
        defaults.patient?.temperature ?? 0.7,
        "PATIENT_TEMPERATURE"
      ),
      max_tokens: numberFromEnv(
        env.PATIENT_MAX_TOKENS,
        defaults.patient?.max_tokens ?? 220,
        "PATIENT_MAX_TOKENS"
      )
    },
    judge: {
      provider: stringFromEnv(env.JUDGE_PROVIDER, defaults.judge?.provider ?? "openai"),
      model: stringFromEnv(env.JUDGE_MODEL, defaults.judge?.model ?? "gpt-5.4-mini"),
      temperature: numberFromEnv(
        env.JUDGE_TEMPERATURE,
        defaults.judge?.temperature ?? 0,
        "JUDGE_TEMPERATURE"
      ),
      max_tokens: numberFromEnv(
        env.JUDGE_MAX_TOKENS,
        defaults.judge?.max_tokens ?? 1600,
        "JUDGE_MAX_TOKENS"
      )
    },
    modelConfigs: {
      path: stringFromEnv(env.MODEL_CONFIG_PATH, defaults.modelConfigs?.path ?? "config/model_configs.json")
    },
    storage: {
      outputDir: stringFromEnv(env.RUN_OUTPUT_DIR, defaults.storage?.outputDir ?? "runs"),
      latestComparisonFile: stringFromEnv(
        env.LATEST_COMPARISON_FILE,
        defaults.storage?.latestComparisonFile ?? "latest-comparison.json"
      ),
      demoComparisonFile: stringFromEnv(
        env.DEMO_COMPARISON_FILE,
        defaults.storage?.demoComparisonFile ?? "demo-results.json"
      )
    }
  };
}
