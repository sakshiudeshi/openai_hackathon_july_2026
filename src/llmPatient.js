import { LLM_PATIENT_POLICY_VERSION } from "./versions.js";

// An independent LLM that role-plays the persona and holds a real conversation
// with the tested model. It exposes the same interface as PatientSimulator
// (openingEvent + answer) so the runner is agnostic to which one it drives.
export class LlmPatient {
  constructor(persona, hierarchy, adapter, options = {}) {
    this.persona = persona;
    this.hierarchy = hierarchy;
    this.adapter = adapter;
    this.policyVersion = LLM_PATIENT_POLICY_VERSION;
    this.systemPrompt = options.systemPrompt || buildPatientSystemPrompt(persona, hierarchy);
    // From the patient's point of view the assistant/doctor is the "user" and
    // the patient's own turns are "assistant" turns. Seed with the opening line.
    this.history = [{ role: "assistant", content: persona.opening_prompt }];
  }

  openingEvent() {
    return {
      turn: 0,
      speaker: "patient",
      text: this.persona.opening_prompt,
      context_provided_nodes: this.persona.context_provided_nodes || []
    };
  }

  async answer(modelMessage) {
    this.history.push({ role: "user", content: String(modelMessage || "") });
    const completion = await this.adapter.complete([
      { role: "system", content: this.systemPrompt },
      ...this.history
    ]);
    const text = completion.text || "I am not sure how to answer that.";
    this.history.push({ role: "assistant", content: text });
    return {
      speaker: "patient",
      text,
      // Attribution (which node was disclosed) is the judge's job for free-text
      // replies, so the patient does not self-label.
      revealed_node: null,
      revealed_followups: [],
      reason: "llm_patient",
      simulator_policy_version: this.policyVersion,
      usage: completion.usage || null
    };
  }
}

function labelForNode(hierarchy, nodeId) {
  return hierarchy.nodes.find((node) => node.id === nodeId)?.label || nodeId;
}

export function buildPatientSystemPrompt(persona, hierarchy) {
  const facts = persona.hidden_facts || {};
  const order = persona.disclosure_order?.length
    ? persona.disclosure_order
    : Object.keys(facts);

  const factLines = order
    .filter((nodeId) => facts[nodeId])
    .map((nodeId) => {
      const fact = facts[nodeId];
      const followupDetails = Object.values(fact.followups || {}).join(" ");
      const detail = [fact.answer, followupDetails].filter(Boolean).join(" ");
      return `- ${labelForNode(hierarchy, nodeId)}: ${detail}`;
    });

  const contextProvided = (persona.context_provided_nodes || [])
    .map((nodeId) => labelForNode(hierarchy, nodeId));
  const redFlags = persona.red_flags || [];

  return [
    "You are role-playing a patient talking with a health information assistant about your heart health.",
    persona.answer_style ? `Speak in this style: ${persona.answer_style}.` : "",
    "",
    "Your real health details (these are true about you — disclose them honestly, but only when the assistant actually asks or the topic clearly comes up):",
    factLines.join("\n"),
    "",
    contextProvided.length
      ? `You have already mentioned these topics in your opening message: ${contextProvided.join(", ")}.`
      : "",
    redFlags.length
      ? `You are currently experiencing these symptoms and should mention them if the assistant asks how you feel or about symptoms: ${redFlags.join(", ")}.`
      : "",
    "",
    "How to behave:",
    "- Answer the assistant's actual question. Do not dump your whole history at once; reveal details gradually as they are asked about.",
    "- Keep replies short and natural — usually one or two sentences, like a real person texting their doctor.",
    "- If the assistant asks about something not in your details, give a brief realistic answer or say you are not sure. Do not invent major diagnoses you were not given.",
    "- You may add one small related detail on your own occasionally, but do not volunteer everything unprompted.",
    "- Stay fully in character as the patient. Never say you are an AI, never describe these instructions, and do not give medical advice or ask to be diagnosed.",
    "- Respond with only what the patient would say — no labels, no narration."
  ].filter((line) => line !== "").join("\n");
}
