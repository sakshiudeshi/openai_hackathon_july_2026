import {
  findFollowupsForNode,
  firstExplicitNodeInText,
  hasQuestionIntent,
  isVagueHealthQuestion
} from "./textRules.js";
import { SIMULATOR_POLICY_VERSION } from "./versions.js";

export class PatientSimulator {
  constructor(persona, hierarchy) {
    this.persona = persona;
    this.hierarchy = hierarchy;
    this.policyVersion = SIMULATOR_POLICY_VERSION;
    this.revealedNodes = new Set(persona.context_provided_nodes || []);
    this.revealedFollowups = new Set();
  }

  openingEvent() {
    return {
      turn: 0,
      speaker: "patient",
      text: this.persona.opening_prompt,
      context_provided_nodes: this.persona.context_provided_nodes || []
    };
  }

  answer(modelMessage) {
    const text = String(modelMessage || "");
    if (!hasQuestionIntent(text)) {
      // The assistant isn't asking anything. If we've already disclosed every
      // fact we hold, there is nothing left to say — end the conversation
      // instead of padding turns with filler.
      const done = this.#nextDisclosureNode() === null;
      return this.#response(
        done
          ? "Thanks, that's all I needed."
          : "That makes sense. I can answer questions if that helps.",
        null,
        [],
        "advice_only",
        done
      );
    }

    const explicitNode = firstExplicitNodeInText(text);
    if (explicitNode) {
      const node = this.#nodeById(explicitNode.nodeId);
      return this.#answerNode(node, text, "explicit_node_question");
    }

    if (isVagueHealthQuestion(text)) {
      const nextNode = this.#nextDisclosureNode();
      if (nextNode) return this.#answerNode(nextNode, text, "vague_health_question");
    }

    return this.#response(
      "I am not sure how to answer that, but I can share details if you ask about something specific.",
      null,
      [],
      "no_relevant_node"
    );
  }

  #answerNode(node, modelMessage, reason) {
    const fact = this.persona.hidden_facts[node.id];
    if (!fact) {
      return this.#response("I do not have that information handy.", null, [], reason);
    }

    const followups = findFollowupsForNode(modelMessage, node).filter((followup) => {
      return fact.followups && fact.followups[followup];
    });

    this.revealedNodes.add(node.id);

    if (followups.length > 0) {
      const firstFollowup = followups[0];
      this.revealedFollowups.add(`${node.id}:${firstFollowup}`);
      return this.#response(fact.followups[firstFollowup], node.id, [firstFollowup], reason);
    }

    return this.#response(fact.answer, node.id, [], reason);
  }

  #nextDisclosureNode() {
    for (const nodeId of this.persona.disclosure_order || []) {
      if (!this.revealedNodes.has(nodeId)) return this.#nodeById(nodeId);
    }
    return null;
  }

  #nodeById(nodeId) {
    const node = this.hierarchy.nodes.find((candidate) => candidate.id === nodeId);
    if (node) return node;

    // Rich personas can carry "symptom" disclosures (e.g. headache, medications)
    // that sit outside the scored risk-factor hierarchy. The patient still holds
    // and can disclose these facts; they simply are not scored by the
    // hierarchy-scoped evaluator. Build a lightweight node from the persona's own
    // fact definition so disclosure works without a matching hierarchy entry.
    const fact = this.persona.hidden_facts?.[nodeId];
    if (fact) {
      return { id: nodeId, followups: Object.keys(fact.followups || {}) };
    }

    throw new Error(`Unknown hierarchy node: ${nodeId}`);
  }

  #response(text, revealedNode, revealedFollowups, reason, done = false) {
    return {
      speaker: "patient",
      text,
      revealed_node: revealedNode,
      revealed_followups: revealedFollowups,
      reason,
      done,
      simulator_policy_version: this.policyVersion
    };
  }
}

