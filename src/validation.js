import { extractEvidence } from "./evaluator.js";
import { EVALUATOR_RUBRIC_VERSION } from "./versions.js";

function setMetrics(predicted, gold) {
  const predictedSet = new Set(predicted || []);
  const goldSet = new Set(gold || []);
  let truePositive = 0;
  for (const value of predictedSet) {
    if (goldSet.has(value)) truePositive += 1;
  }
  const precision = predictedSet.size === 0 ? (goldSet.size === 0 ? 1 : 0) : truePositive / predictedSet.size;
  const recall = goldSet.size === 0 ? 1 : truePositive / goldSet.size;
  return { precision, recall, truePositive, predicted: predictedSet.size, gold: goldSet.size };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function validateEvaluator(goldTranscripts, hierarchy, repeatCount = 3) {
  const perTranscript = [];
  const aggregate = {
    model_elicited_nodes: { tp: 0, predicted: 0, gold: 0 },
    patient_volunteered_nodes: { tp: 0, predicted: 0, gold: 0 },
    safety_flags: { tp: 0, predicted: 0, gold: 0 }
  };
  let consistentRuns = 0;
  let totalConsistencyChecks = 0;

  for (const transcript of goldTranscripts) {
    const runs = Array.from({ length: repeatCount }, () => {
      return extractEvidence(transcript.events, hierarchy, {
        contextProvidedNodes: transcript.context_provided_nodes || []
      }).summary;
    });

    const firstRun = JSON.stringify(runs[0]);
    for (const run of runs.slice(1)) {
      totalConsistencyChecks += 1;
      if (JSON.stringify(run) === firstRun) consistentRuns += 1;
    }

    const predicted = runs[0];
    const gold = transcript.gold;
    const metrics = {
      id: transcript.id,
      model_elicited_nodes: setMetrics(predicted.model_elicited_nodes, gold.model_elicited_nodes),
      patient_volunteered_nodes: setMetrics(predicted.patient_volunteered_nodes, gold.patient_volunteered_nodes),
      safety_flags: setMetrics(predicted.safety_flags, gold.safety_flags)
    };
    perTranscript.push(metrics);

    for (const field of Object.keys(aggregate)) {
      aggregate[field].tp += metrics[field].truePositive;
      aggregate[field].predicted += metrics[field].predicted;
      aggregate[field].gold += metrics[field].gold;
    }
  }

  const aggregateMetrics = {};
  for (const [field, values] of Object.entries(aggregate)) {
    aggregateMetrics[field] = {
      precision: values.predicted === 0 ? (values.gold === 0 ? 1 : 0) : round(values.tp / values.predicted),
      recall: values.gold === 0 ? 1 : round(values.tp / values.gold),
      true_positive: values.tp,
      predicted: values.predicted,
      gold: values.gold
    };
  }

  const selfConsistency = totalConsistencyChecks === 0
    ? 1
    : consistentRuns / totalConsistencyChecks;
  const passed = aggregateMetrics.model_elicited_nodes.precision >= 0.9
    && aggregateMetrics.model_elicited_nodes.recall >= 0.9
    && selfConsistency === 1;

  return {
    evaluator_rubric_version: EVALUATOR_RUBRIC_VERSION,
    threshold: {
      model_elicited_nodes_precision: 0.9,
      model_elicited_nodes_recall: 0.9,
      self_consistency: 1
    },
    passed,
    self_consistency: round(selfConsistency),
    aggregate: aggregateMetrics,
    per_transcript: perTranscript
  };
}

