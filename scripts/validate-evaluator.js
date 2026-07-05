import { loadGoldTranscripts, loadHierarchy } from "../src/artifacts.js";
import { validateEvaluator } from "../src/validation.js";

const result = validateEvaluator(loadGoldTranscripts(), loadHierarchy());
console.log(JSON.stringify(result, null, 2));
if (!result.passed) {
  process.exitCode = 1;
}

