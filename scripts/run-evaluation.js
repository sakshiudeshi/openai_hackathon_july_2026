import { loadHierarchy, loadModelConfigs, loadPersonas, loadSystemPrompt } from "../src/artifacts.js";
import { loadAppConfig } from "../src/config.js";
import { runComparison } from "../src/runner.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";
import { SupabaseStore } from "../src/storage/supabaseStore.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

const appConfig = loadAppConfig();
const configPath = argValue("--config", appConfig.modelConfigs.path);
const turnLimit = Number(argValue("--turn-limit", String(appConfig.run.turnLimit)));
const localStore = new LocalRunStore(appConfig.storage.outputDir);
const supabaseStore = new SupabaseStore();
const storage = {
  async recordEvent(event) {
    await localStore.recordEvent(event);
    await supabaseStore.recordEvent(event);
  },
  async recordRunResult(result) {
    await localStore.recordRunResult(result);
    await supabaseStore.recordRunResult(result);
  }
};

const comparison = await runComparison({
  hierarchy: loadHierarchy(),
  personas: loadPersonas(),
  modelConfigs: loadModelConfigs(configPath),
  systemPrompt: loadSystemPrompt(),
  turnLimit,
  storage
});

const outputPath = localStore.writeComparison(appConfig.storage.latestComparisonFile, comparison);
console.log(`Wrote comparison to ${outputPath}`);
if (!supabaseStore.enabled) {
  console.log("Supabase env vars were not set; skipped Supabase streaming.");
}
