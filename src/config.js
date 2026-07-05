import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(srcDir, "..");

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

export function loadAppConfig(env = process.env) {
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
