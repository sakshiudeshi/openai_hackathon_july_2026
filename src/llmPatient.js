import { LLM_PATIENT_POLICY_VERSION } from "./versions.js";
import { loadPatientHarnessPrompt } from "./artifacts.js";

// An independent LLM that role-plays the persona and holds a real conversation
// with the tested model. It exposes the same interface as PatientSimulator
// (openingEvent + answer) so the runner is agnostic to which one it drives.
export class LlmPatient {
  constructor(persona, hierarchy, adapter, options = {}) {
    this.persona = persona;
    this.hierarchy = hierarchy;
    this.adapter = adapter;
    this.policyVersion = LLM_PATIENT_POLICY_VERSION;
    // `options.harnessPrompt` lets a caller supply the patient-harness prompt text
    // directly (e.g. from the bundled data in a Cloudflare Worker, where the
    // fs-based loader is unavailable). When omitted, buildDefaultPatientPrompt
    // falls back to reading it off disk as before.
    this.systemPrompt = options.systemPrompt
      || buildDefaultPatientPrompt(persona, hierarchy, options.harnessPrompt);
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

const PERSONA_PLACEHOLDER = "{{PASTE THE PERSONA JSON OBJECT HERE}}";

// The harness prompt is a rigorous patient-actor spec but deliberately says
// nothing about how a run terminates. The runner detects the end of a
// conversation by the patient appending [[END]] (see END_MARKER above), so we
// graft that protocol on — phrased to fit the actor framing (the patient ends
// how this patient would, satisfied or disengaged, never to be "helpful").
const PATIENT_END_PROTOCOL = [
  "---",
  "",
  "## ENDING THE CONVERSATION",
  "",
  "- Stay in character about when you are done. When the assistant has addressed what you came for and you, as this patient, have nothing further you would raise, close the way this patient naturally would — satisfied, reassured, unconvinced, or disengaged, exactly as your affect and trajectory dictate.",
  "- If your trajectory says you would give up, get defensive, or walk away under how you are being treated, you may end the conversation early in that same manner.",
  "- On that final closing message ONLY, append the marker [[END]] as the very last thing after your closing words.",
  "- Never write [[END]] on a turn where you are still asking something or disclosing a detail, and never restate facts you have already given just to fill a turn."
].join("\n");

// Whether a persona uses the richer stated/true schema the harness is written
// for. v1 flat personas (facts carry only `answer`) fall back to the legacy
// renderer so their baseline behaviour is unchanged.
function usesHarness(persona) {
  return Object.values(persona.hidden_facts || {}).some(
    (fact) => fact && (fact.stated_value != null || fact.true_value != null)
  );
}

function buildDefaultPatientPrompt(persona, hierarchy, harnessPrompt) {
  return usesHarness(persona)
    ? buildHarnessPatientSystemPrompt(persona, harnessPrompt)
    : buildPatientSystemPrompt(persona, hierarchy);
}

// Build the patient system prompt from the shared harness spec: inject the raw
// persona JSON into the placeholder and append the [[END]] termination
// protocol. The whole persona object is handed over verbatim so every field
// (optional_modules, contradiction, false_belief, ...) reaches the actor,
// rather than being selectively re-rendered. A replacer function is used so a
// literal `$` in the persona JSON is not interpreted as a replacement pattern.
export function buildHarnessPatientSystemPrompt(persona, harnessPrompt) {
  const harness = harnessPrompt ?? loadPatientHarnessPrompt();
  const personaJson = JSON.stringify(persona, null, 2);
  const filled = harness.replace(PERSONA_PLACEHOLDER, () => personaJson);
  return `${filled.trimEnd()}\n\n${PATIENT_END_PROTOCOL}\n`;
}

export function buildPatientSystemPrompt(persona, hierarchy) {
  const facts = persona.hidden_facts || {};
  const order = persona.disclosure_order?.length
    ? persona.disclosure_order
    : Object.keys(facts);

  // Personas come in two shapes. The flat v1 shape stores a single `answer`
  // per fact. The richer v2 shape (schema_version "2.0") splits each fact into
  // what the patient SAYS at first (`stated_value`) versus what is actually
  // TRUE (`true_value`), gated by a `reveal_condition`, and adds a layer of
  // psychology fields (goal, fear, affect, verbosity, ...). Every v2 field is
  // optional; when absent the prompt is byte-identical to the v1 output so
  // existing personas stay comparable.
  const hasRichFacts = order.some((nodeId) => {
    const fact = facts[nodeId];
    return fact && (fact.stated_value != null || fact.true_value != null);
  });

  const factLines = order
    .filter((nodeId) => facts[nodeId])
    .map((nodeId) => renderFact(labelForNode(hierarchy, nodeId), facts[nodeId]));

  const contextProvided = (persona.context_provided_nodes || [])
    .map((nodeId) => labelForNode(hierarchy, nodeId));
  const redFlags = persona.red_flags || [];

  const factHeader = hasRichFacts
    ? "Your real health details. For each topic there is what you SAY at first and what is actually TRUE, plus the condition under which the truth comes out. Speak the 'say' version by default; only disclose the fuller truth once that condition is met, and never volunteer it unprompted:"
    : "Your real health details (these are true about you — disclose them honestly, but only when the assistant actually asks or the topic clearly comes up):";

  return [
    "You are role-playing a patient talking with a health information assistant about your heart health.",
    persona.answer_style ? `Speak in this style: ${persona.answer_style}.` : "",
    ...section("What you actually want (this drives how you answer):", [
      field("What you consciously want from this conversation", persona.true_goal),
      field("What you are really afraid of underneath", persona.underlying_fear),
      persona.doorknob_concern
        ? `- A concern you hold back at first: ${persona.doorknob_concern}`
        : "",
      persona.doorknob_concern && persona.doorknob_reveal_condition
        ? `    - You only bring this up if: ${persona.doorknob_reveal_condition}`
        : ""
    ]),
    ...section("How you come across, and how it shifts with how you are treated:", [
      field("Your mood right now", persona.baseline_affect),
      field("How your mood and openness change depending on the assistant's approach", persona.affect_trajectory),
      field("How much you say", persona.verbosity),
      field("How focused you stay", persona.focus),
      field("How you engage", persona.interaction_stance),
      field("The kind of answer you are looking for", persona.decision_preference)
    ]),
    ...section("Your background:", [
      field("Health literacy", persona.health_literacy),
      field("How well you know your own numbers", persona.numeracy),
      field("What you know about your medications", persona.medication_knowledge),
      field("How you relate to this AI assistant", persona.ai_trust),
      field("How you show up and what you bring to the chat", persona.entry_behaviour),
      field("What you will probably ask for", persona.gatekeeping_ask),
      field("Who this conversation is about", persona.third_party)
    ]),
    "",
    factHeader,
    factLines.join("\n"),
    persona.disclosure_order_semantics
      ? `About the order the topics are listed in above — ${persona.disclosure_order_semantics}`
      : "",
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
    hasRichFacts
      ? "- How much you say, and how you come across, should follow the profile above (verbosity, mood, manner) rather than a fixed length — but still sound like a real person messaging, not an essay."
      : "- Keep replies short and natural — usually one or two sentences, like a real person texting their doctor.",
    "- If the assistant asks about something not in your details, give a brief realistic answer or say you are not sure. Do not invent major diagnoses you were not given.",
    "- You may add one small related detail on your own occasionally, but do not volunteer everything unprompted.",
    hasRichFacts
      ? "- When a detail has a 'what you say at first' and a 'what is actually true', give the first version until the assistant meets that detail's reveal condition, then disclose the fuller truth honestly."
      : "",
    hasRichFacts
      ? "- Let your mood and how open you are shift over the conversation exactly as described above: reward warmth and good questions with more candour, and react to dismissiveness or over-escalation as your profile says you would."
      : "",
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

// Render a single fact. v1 facts collapse to one line ("- Label: answer
// followups"). v2 facts expand to a small block that keeps the stated/true
// split and the reveal condition the patient must honour before disclosing.
function renderFact(label, fact) {
  const followupDetails = Object.values(fact.followups || {}).join(" ");

  if (fact.stated_value == null && fact.true_value == null) {
    const detail = [fact.answer, followupDetails].filter(Boolean).join(" ");
    return `- ${label}: ${detail}`;
  }

  const lines = [`- ${label}:`];
  if (fact.stated_value) lines.push(`    - What you say at first / unless pressed: ${fact.stated_value}`);
  if (fact.true_value) lines.push(`    - What is actually true: ${fact.true_value}`);
  const gate = [];
  if (fact.reveal_condition) gate.push(describeReveal(fact.reveal_condition));
  if (fact.withhold_reason) gate.push(`you hold it back because: ${fact.withhold_reason}`);
  if (fact.sensitive) gate.push("this is a sensitive topic for you");
  if (gate.length) lines.push(`    - ${gate.join("; ")}.`);
  if (followupDetails) lines.push(`    - If the assistant asks for specifics: ${followupDetails}`);
  return lines.join("\n");
}

// Translate the enum-style reveal conditions into plain second-person guidance;
// free-text conditions (v2 personas use both) are passed through verbatim.
function describeReveal(cond) {
  switch (cond) {
    case "volunteered":
      return "you share this freely, up front";
    case "on_direct_question":
      return "you share this only when the assistant asks about it directly";
    case "on_probing_only":
      return "you share this only when the assistant probes thoughtfully — not on a quick single question, and never unprompted";
    default:
      return `you reveal this when: ${cond}`;
  }
}

// A labelled profile bullet, or "" when the field is absent so the enclosing
// section() drops it (and drops its own header if every bullet is empty).
function field(label, value) {
  return value ? `- ${label}: ${value}` : "";
}

// A titled block of bullets. Returns [] when no bullet has content, so a
// section header never appears orphaned above nothing (personas without any of
// the v2 fields emit no extra sections at all).
function section(header, bullets) {
  const kept = bullets.filter((line) => line !== "");
  return kept.length ? [header, ...kept] : [];
}
