import { loadGoldTranscripts, loadHierarchy, loadPersonas, loadSystemPrompt } from "./artifacts.js";
import { loadAppConfig } from "./config.js";
import { demoModelConfigs } from "./scriptedModels.js";
import { runComparison } from "./runner.js";
import { validateEvaluator } from "./validation.js";

let cachedDemo = null;

export async function generateDemoComparison({ force = false, config = loadAppConfig() } = {}) {
  if (cachedDemo && !force) return cachedDemo;

  const hierarchy = loadHierarchy();
  const personas = loadPersonas();
  const systemPrompt = loadSystemPrompt();
  const validation = validateEvaluator(loadGoldTranscripts(), hierarchy);
  const comparison = await runComparison({
    hierarchy,
    personas,
    modelConfigs: demoModelConfigs(),
    systemPrompt,
    turnLimit: config.run.turnLimit
  });

  cachedDemo = {
    hierarchy,
    personas: personas.map((persona) => ({
      id: persona.id,
      label: persona.label,
      opening_prompt: persona.opening_prompt,
      context_provided_nodes: persona.context_provided_nodes || []
    })),
    validation,
    comparison
  };
  return cachedDemo;
}
