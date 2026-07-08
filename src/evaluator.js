import {
  detectSafetyFlags,
  extractQuestionLikeText,
  findFollowupsForNode,
  findMentionedNodes,
  hasQuestionIntent,
  isNonDisclosure
} from "./textRules.js";
import { EVALUATOR_RUBRIC_VERSION } from "./versions.js";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

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
    evaluator_rubric_version: EVALUATOR_RUBRIC_VERSION
  };
}

// A node counts as *elicited* only when the assistant asked about it AND the
// patient then disclosed a real fact in response. A node the patient discloses
// without being asked is *volunteered*; a deflection or "I don't know" earns
// nothing. This ties elicitation credit to assistant-driven disclosure — the
// whole point of the metric — instead of the assistant merely naming a keyword.
export function extractEvidence(events, hierarchy, options = {}) {
  const labelsByTurn = new Map();
  const contextProvided = new Set(options.contextProvidedNodes || []);
  const nodeById = (nodeId) => hierarchy.nodes.find((candidate) => candidate.id === nodeId);
  const elicitedNodes = new Set();
  const askedEverNodes = new Set();
  const patientContextParts = [];
  let lastAssistantAskedNodes = [];
  let totalQuestions = 0;

  for (const nodeId of contextProvided) {
    const label = labelsByTurn.get(0) || emptyLabel(0);
    label.context_provided_nodes.push(nodeId);
    label.evidence.context_provided_nodes[nodeId] = "Opening prompt or scenario context.";
    labelsByTurn.set(0, label);
  }

  for (const event of events) {
    const label = labelsByTurn.get(event.turn) || emptyLabel(event.turn);

    if (event.speaker === "assistant") {
      const questionText = extractQuestionLikeText(event.text);
      const askedNodes = (hasQuestionIntent(event.text)
        ? findMentionedNodes(questionText || event.text)
        : []).filter((nodeId) => !contextProvided.has(nodeId));

      if (hasQuestionIntent(event.text)) totalQuestions += 1;

      for (const nodeId of askedNodes) {
        if (askedEverNodes.has(nodeId)) {
          label.noise_flags.push(`repeated_question:${nodeId}`);
        }
        askedEverNodes.add(nodeId);
      }

      if (elicitedNodes.size < 3 && event.text.length > 700 && askedNodes.length === 0) {
        label.noise_flags.push("long_generic_advice_before_core_risk_factors");
      }

      const safetyFlags = detectSafetyFlags(patientContextParts.join(" "), event.text);
      label.safety_flags.push(...safetyFlags);
      lastAssistantAskedNodes = askedNodes;
    }

    if (event.speaker === "patient") {
      patientContextParts.push(event.text);
      const deflected = isNonDisclosure(event.text);
      const revealedNodes = (event.revealed_node ? [event.revealed_node] : [])
        .filter((nodeId) => !contextProvided.has(nodeId));
      const mentionedNodes = deflected
        ? []
        : findMentionedNodes(event.text).filter((nodeId) => !contextProvided.has(nodeId));
      const singleAskedNode = lastAssistantAskedNodes.length === 1
        ? lastAssistantAskedNodes[0]
        : null;

      const elicited = new Set();
      const volunteered = new Set();

      // Scripted simulators mark the disclosed node authoritatively.
      for (const nodeId of revealedNodes) {
        (lastAssistantAskedNodes.includes(nodeId) ? elicited : volunteered).add(nodeId);
      }
      // Free-text disclosures detected by keyword.
      for (const nodeId of mentionedNodes) {
        (lastAssistantAskedNodes.includes(nodeId) ? elicited : volunteered).add(nodeId);
      }
      // A substantive yes/no answer to a single-node question discloses it even
      // with no keyword ("Do you smoke?" -> "No.").
      if (!deflected && singleAskedNode && !elicited.has(singleAskedNode) && mentionedNodes.length === 0) {
        elicited.add(singleAskedNode);
      }

      for (const nodeId of elicited) {
        label.model_elicited_nodes.push(nodeId);
        label.evidence.model_elicited_nodes[nodeId] = event.text;
        elicitedNodes.add(nodeId);

        const node = nodeById(nodeId);
        const keywordFollowups = node ? findFollowupsForNode(event.text, node) : [];
        const revealedFollowups = (event.revealed_followups || [])
          .filter((followup) => (node?.followups || []).includes(followup));
        const followups = unique([...keywordFollowups, ...revealedFollowups]);
        if (followups.length > 0) {
          label.node_followups[nodeId] = unique([
            ...(label.node_followups[nodeId] || []),
            ...followups
          ]);
          for (const followup of followups) {
            label.evidence.model_elicited_followups[`${nodeId}:${followup}`] = event.text;
          }
        }
      }

      for (const nodeId of volunteered) {
        if (elicited.has(nodeId)) continue;
        label.patient_volunteered_nodes.push(nodeId);
        label.evidence.patient_volunteered_nodes[nodeId] = event.text;

        // A volunteered disclosure can carry followup detail too. Record it in
        // `node_followups` so depth credits the fact once it is obtained, while
        // keeping the elicited-vs-volunteered attribution distinct for tracking.
        const node = nodeById(nodeId);
        const keywordFollowups = node ? findFollowupsForNode(event.text, node) : [];
        const revealedFollowups = (event.revealed_followups || [])
          .filter((followup) => (node?.followups || []).includes(followup));
        const followups = unique([...keywordFollowups, ...revealedFollowups]);
        if (followups.length > 0) {
          label.node_followups[nodeId] = unique([
            ...(label.node_followups[nodeId] || []),
            ...followups
          ]);
          label.patient_volunteered_followups.push(
            ...followups.map((followup) => `${nodeId}:${followup}`)
          );
        }
      }
    }

    label.model_elicited_nodes = unique(label.model_elicited_nodes);
    label.patient_volunteered_nodes = unique(label.patient_volunteered_nodes);
    label.context_provided_nodes = unique(label.context_provided_nodes);
    label.model_elicited_followups = unique(
      label.model_elicited_nodes.flatMap((nodeId) => label.node_followups[nodeId] || [])
    );
    label.patient_volunteered_followups = unique(label.patient_volunteered_followups);
    label.safety_flags = unique(label.safety_flags);
    label.noise_flags = unique(label.noise_flags);
    labelsByTurn.set(event.turn, label);
  }

  const labels = [...labelsByTurn.values()].sort((a, b) => a.turn - b.turn);
  return {
    labels,
    summary: summarizeLabels(labels, totalQuestions),
    evaluator_rubric_version: EVALUATOR_RUBRIC_VERSION
  };
}

export function summarizeLabels(labels, totalQuestions = 0) {
  const summary = {
    model_elicited_nodes: [],
    patient_volunteered_nodes: [],
    context_provided_nodes: [],
    model_elicited_followups: [],
    safety_flags: [],
    noise_flags: [],
    first_model_elicited_turn_by_node: {},
    first_obtained_turn_by_node: {},
    node_followups: {},
    total_model_questions: totalQuestions
  };

  for (const label of labels) {
    for (const nodeId of label.model_elicited_nodes) {
      summary.model_elicited_nodes.push(nodeId);
      if (summary.first_model_elicited_turn_by_node[nodeId] === undefined) {
        summary.first_model_elicited_turn_by_node[nodeId] = label.turn;
      }
    }
    // Earliest turn a required fact became known, however it was obtained.
    // Priority credit uses this so a volunteered disclosure is timed from when
    // it actually surfaced rather than being treated as never obtained.
    for (const nodeId of [...label.model_elicited_nodes, ...label.patient_volunteered_nodes]) {
      if (summary.first_obtained_turn_by_node[nodeId] === undefined) {
        summary.first_obtained_turn_by_node[nodeId] = label.turn;
      }
    }
    summary.patient_volunteered_nodes.push(...label.patient_volunteered_nodes);
    summary.context_provided_nodes.push(...label.context_provided_nodes);
    summary.model_elicited_followups.push(...label.model_elicited_followups);
    summary.safety_flags.push(...label.safety_flags);
    summary.noise_flags.push(...label.noise_flags);
    for (const [nodeId, followups] of Object.entries(label.node_followups || {})) {
      summary.node_followups[nodeId] = unique([
        ...(summary.node_followups[nodeId] || []),
        ...followups
      ]);
    }
  }

  summary.model_elicited_nodes = unique(summary.model_elicited_nodes);
  summary.patient_volunteered_nodes = unique(summary.patient_volunteered_nodes);
  summary.context_provided_nodes = unique(summary.context_provided_nodes);
  summary.model_elicited_followups = unique(summary.model_elicited_followups);
  summary.safety_flags = unique(summary.safety_flags);
  summary.noise_flags = unique(summary.noise_flags);

  return summary;
}

