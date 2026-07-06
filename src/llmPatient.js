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
    // Fallback transcript, used only when a caller drives the patient WITHOUT
    // supplying the runner's authoritative `events` (e.g. a standalone/direct
    // caller or test). In the normal run path the runner's events are the single
    // source of truth and this is never read. From the patient's point of view
    // the assistant/doctor is the "user" and the patient's own turns are
    // "assistant" turns, so seed with the opening line as an assistant turn.
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

  // `events` is the runner's authoritative transcript (opening + every
  // assistant/patient turn recorded so far, including the current doctor turn).
  // When present it is the single source of truth: the patient reads the exact
  // conversation the run recorded rather than a separately-accumulated copy.
  // `modelMessage` is retained for the fallback path where no events are passed.
  async answer(modelMessage, events = null) {
    const useEvents = Array.isArray(events) && events.length > 0;
    const conversation = useEvents
      ? toPatientMessages(events)
      : [...this.history, { role: "user", content: String(modelMessage || "") }];

    const completion = await this.adapter.complete([
      { role: "system", content: this.systemPrompt },
      ...conversation
    ]);
    const raw = completion.text || "I am not sure how to answer that.";
    // The patient signals it is finished by ending its message with the END
    // marker (see buildPatientSystemPrompt). Strip the marker from the visible
    // transcript and surface a `done` flag so the runner can stop the loop
    // instead of forcing the patient to keep talking with nothing left to say.
    const done = END_MARKER.test(raw);
    const text = raw.replace(END_MARKER, "").trim() || "Thanks, that's all I needed.";
    // Only maintain the fallback transcript when we are the source of truth.
    // Store the cleaned text so the marker never leaks back to the model.
    if (!useEvents) {
      this.history.push({ role: "user", content: String(modelMessage || "") });
      this.history.push({ role: "assistant", content: text });
    }
    return {
      speaker: "patient",
      text,
      // Attribution (which node was disclosed) is the judge's job for free-text
      // replies, so the patient does not self-label.
      revealed_node: null,
      revealed_followups: [],
      reason: "llm_patient",
      done,
      simulator_policy_version: this.policyVersion,
      usage: completion.usage || null
    };
  }
}

// Render the runner's canonical event transcript into chat messages from the
// patient's point of view: the assistant/doctor speaks as "user", the patient
// speaks as "assistant". This is the mirror image of the runner's
// toProviderMessages (which frames the same events for the tested model).
function toPatientMessages(events) {
  const messages = [];
  for (const event of events) {
    if (event.speaker === "assistant") {
      messages.push({ role: "user", content: event.text });
    } else if (event.speaker === "patient") {
      messages.push({ role: "assistant", content: event.text });
    }
  }
  return messages;
}

// Matches a trailing end-of-conversation marker, tolerating surrounding
// whitespace/punctuation the model may add around it.
const END_MARKER = /\s*\[\[\s*END\s*\]\]\s*$/i;

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
    "- Respond with only what the patient would say — no labels, no narration.",
    "",
    "Ending the conversation:",
    "- When the assistant has answered what you came to ask and you have no further questions or details to share, wrap up naturally with a brief closing (e.g. \"Thanks, that's really helpful — that's all I needed.\").",
    "- On that final closing message ONLY, append the marker [[END]] as the very last thing in your reply, after your closing sentence.",
    "- Do NOT keep restating facts you have already given just to fill a turn. If you have nothing new to say, close and end with [[END]].",
    "- Never write [[END]] on a turn where you are still asking a question or disclosing a detail."
  ].filter((line) => line !== "").join("\n");
}
