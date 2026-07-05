import { generateDemoComparison } from "../src/demo.js";
import { loadAppConfig } from "../src/config.js";
import { LocalRunStore } from "../src/storage/localRunStore.js";

const appConfig = loadAppConfig();
const store = new LocalRunStore(appConfig.storage.outputDir);
const demo = await generateDemoComparison({ force: true, config: appConfig });
for (const run of demo.comparison.runs) {
  await store.recordRunResult(run);
}
const outputPath = store.writeComparison(appConfig.storage.demoComparisonFile, demo);
console.log(`Wrote demo comparison to ${outputPath}`);
console.log(JSON.stringify(demo.comparison.models.map((model) => ({
  model: model.model_config.label,
  score: model.score.bottom_to_roof_score,
  coverage: model.score.coverage_score,
  priority: model.score.priority_score,
  depth: model.score.depth_score,
  safety: model.score.safety_score,
  noise: model.score.noise_penalty
})), null, 2));
