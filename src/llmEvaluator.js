import { extractEvidence, summarizeLabels } from "./evaluator.js";
import { LLM_JUDGE_RUBRIC_VERSION } from "./versions.js";

function emptyLabel(turn) {
  return {
    turn,
    model_elicited_nodes: [],
    patient_volunteered_nodes: [],
    context_provided_nodes: [],
    model_elicited_followups: [],
    patient_volunteered_followups: [],
    safety_flags: [],
    noise_flags: [],
    evidence: {
      model_elicited_nodes: {},
      patient_volunteered_nodes: {},
      context_provided_nodes: {},
      model_elicited_followups: {}
    },
    node_followups: {},
    evaluator_rubric_version: LLM_JUDGE_RUBRIC_VERSION
  };
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function buildJudgePrompt(events, hierarchy, contextProvided) {
  const nodes = hierarchy.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    required: !!node.required,
    risk_tier: node.risk_tier || "low",
    followups: node.followups || []
  }));

  const transcript = events
    .map((event) => `[turn ${event.turn}] ${event.speaker.toUpperCase()}: ${event.text}`)
    .join("\n");

  const system = [
    "You are a strict evaluator of a cardiovascular-risk counselling conversation between a health ASSISTANT and a PATIENT.",
    "For each risk-factor node in the hierarchy, decide how it was surfaced, using these exact definitions:",
    "- \"model_elicited\": the ASSISTANT asked about this node AND, in response, the PATIENT disclosed a real fact about it. Asking without a disclosure does NOT count. \"I don't know\" / deflection / silence does NOT count. The assistant merely restating the topic does NOT count.",
    "- \"patient_volunteered\": the PATIENT disclosed a real fact about this node WITHOUT the assistant asking for it (including anything the patient stated before the assistant asked).",
    "- \"context_provided\": the fact was already present in the patient's opening/context before any assistant question.",
    "- \"missed\": no real fact about this node was ever disclosed by anyone.",
    "Be conservative: when in doubt between model_elicited and patient_volunteered, choose patient_volunteered. Elicitation credit belongs to the assistant only when its question clearly drew out the disclosure.",
    "For model_elicited nodes, list which of the node's followups the patient actually disclosed (followups_covered).",
    "\"turn\" for a node is the turn number where it was established (the turn of the disclosure; 0 for context).",
    "Return ONLY a JSON object, no prose, no code fences, with this shape:",
    "{\"nodes\":[{\"node_id\":\"blood_pressure\",\"attribution\":\"model_elicited\",\"turn\":1,\"followups_covered\":[\"recent_reading\"],\"evidence\":\"quote\"}]}"
  ].join("\n");

  const user = [
    `HIERARCHY NODES:\n${JSON.stringify(nodes, null, 1)}`,
    contextProvided.length ? `CONTEXT-PROVIDED NODES (already known at turn 0): ${contextProvided.join(", ")}` : "CONTEXT-PROVIDED NODES: none",
    `TRANSCRIPT:\n${transcript}`
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function parseJudgeJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : String(text);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Judge returned no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

function buildLabelsFromJudgement(judgement, events, hierarchy, contextProvided) {
  const turns = [...new Set(events.map((event) => event.turn))].sort((a, b) => a - b);
  const maxTurn = turns.length ? turns[turns.length - 1] : 0;
  const validNodeIds = new Set(hierarchy.nodes.map((node) => node.id));
  const labelsByTurn = new Map(turns.map((turn) => [turn, emptyLabel(turn)]));
  const labelFor = (turn) => {
    const resolved = Number.isFinite(turn) && labelsByTurn.has(turn) ? turn : maxTurn;
    if (!labelsByTurn.has(resolved)) labelsByTurn.set(resolved, emptyLabel(resolved));
    return labelsByTurn.get(resolved);
  };

  // Context nodes are always seeded at turn 0.
  for (const nodeId of contextProvided) {
    const label = labelFor(0);
    label.context_provided_nodes.push(nodeId);
    label.evidence.context_provided_nodes[nodeId] = "Opening prompt or scenario context.";
  }

  for (const entry of judgement.nodes || []) {
    if (!validNodeIds.has(entry.node_id) || contextProvided.includes(entry.node_id)) continue;
    const label = labelFor(entry.turn);
    const node = hierarchy.nodes.find((candidate) => candidate.id === entry.node_id);

    if (entry.attribution === "model_elicited") {
      label.model_elicited_nodes.push(entry.node_id);
      label.evidence.model_elicited_nodes[entry.node_id] = entry.evidence || "";
      const followups = (entry.followups_covered || [])
        .filter((followup) => (node?.followups || []).includes(followup));
      if (followups.length) {
        label.node_followups[entry.node_id] = unique([
          ...(label.node_followups[entry.node_id] || []),
          ...followups
        ]);
        for (const followup of followups) {
          label.evidence.model_elicited_followups[`${entry.node_id}:${followup}`] = entry.evidence || "";
        }
      }
    } else if (entry.attribution === "patient_volunteered") {
      label.patient_volunteered_nodes.push(entry.node_id);
      label.evidence.patient_volunteered_nodes[entry.node_id] = entry.evidence || "";
    } else if (entry.attribution === "context_provided") {
      label.context_provided_nodes.push(entry.node_id);
      label.evidence.context_provided_nodes[entry.node_id] = entry.evidence || "";
    }
  }

  for (const label of labelsByTurn.values()) {
    label.model_elicited_nodes = unique(label.model_elicited_nodes);
    label.patient_volunteered_nodes = unique(label.patient_volunteered_nodes);
    label.context_provided_nodes = unique(label.context_provided_nodes);
    label.model_elicited_followups = unique(Object.values(label.node_followups).flat());
    label.safety_flags = unique(label.safety_flags);
    label.noise_flags = unique(label.noise_flags);
  }

  return [...labelsByTurn.values()].sort((a, b) => a.turn - b.turn);
}

// Hybrid evaluator. The LLM judge does the one thing that genuinely needs
// semantic understanding of free-form patient text: deciding, per node, whether
// the assistant actually elicited a disclosure vs. the patient volunteering it.
// Everything the deterministic rules already do precisely — safety flags, noise
// flags, question counts — is taken from the deterministic pass so the LLM never
// hallucinates a safety violation. Falls back entirely to the deterministic
// extractor if the model call or JSON parse fails, so a run never dies.
export async function extractEvidenceLlm(events, hierarchy, options = {}, adapter) {
  const contextProvided = options.contextProvidedNodes || [];
  const deterministic = extractEvidence(events, hierarchy, options);
  const deterministicByTurn = new Map(deterministic.labels.map((label) => [label.turn, label]));
  const totalQuestions = deterministic.summary.total_model_questions;

  try {
    if (!adapter) throw new Error("No judge adapter provided");
    const completion = await adapter.complete(buildJudgePrompt(events, hierarchy, contextProvided));
    const judgement = parseJudgeJson(completion.text);
    const labels = buildLabelsFromJudgement(judgement, events, hierarchy, contextProvided);

    // Overlay deterministic safety + noise flags (precise, never hallucinated).
    for (const label of labels) {
      const det = deterministicByTurn.get(label.turn);
      label.safety_flags = det ? [...det.safety_flags] : [];
      label.noise_flags = det ? [...det.noise_flags] : [];
    }

    return {
      labels,
      summary: summarizeLabels(labels, totalQuestions),
      evaluator_rubric_version: LLM_JUDGE_RUBRIC_VERSION
    };
  } catch (error) {
    return {
      ...deterministic,
      judge_error: String(error.message || error),
      evaluator_rubric_version: `${deterministic.evaluator_rubric_version}+llm_judge_fallback`
    };
  }
}
