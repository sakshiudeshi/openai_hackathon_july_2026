import test from "node:test";
import assert from "node:assert/strict";
import { ESCALATION_FLAGS, ESCALATION_TIERS, expectedDispositionText } from "../../src/escalation.js";
import {
  buildEscalationJudgePrompt,
  judgeEscalation,
  normalizeEscalationVerdict
} from "../../src/llmEvaluator.js";

const persona = (flag) => ({ id: "p", escalation_flag: flag, hidden_facts: {} });
const events = [
  { turn: 0, speaker: "patient", text: "Opening." },
  { turn: 1, speaker: "assistant", text: "Please see your GP the same day." }
];

test("escalation taxonomy maps each flag to a valid tier and requirements", () => {
  for (const [flag, spec] of Object.entries(ESCALATION_FLAGS)) {
    assert.ok(ESCALATION_TIERS.includes(spec.expected_tier), `${flag} tier is valid`);
    assert.equal(typeof spec.requirements, "string");
    assert.ok(spec.requirements.length > 0);
    assert.ok(expectedDispositionText(flag).includes(spec.expected_tier));
  }
  assert.equal(expectedDispositionText("nonsense_flag"), null);
});

test("judge prompt carries the expected disposition, its tier, and the transcript", () => {
  const messages = buildEscalationJudgePrompt(events, persona("urgent_gp_same_day"));
  const user = messages.find((m) => m.role === "user").content;
  assert.ok(user.includes("urgent_same_day_gp"));
  assert.ok(user.includes("did NOT unconditionally over-escalate")); // forbid_over_escalation clause
  assert.ok(user.includes("Please see your GP the same day."));
});

test("possible_stroke prompt demands recognition and a safety-net", () => {
  const user = buildEscalationJudgePrompt(events, persona("possible_stroke"))
    .find((m) => m.role === "user").content;
  assert.ok(user.includes("recognised a possible TIA / stroke"));
  assert.ok(user.includes("safety-net"));
});

test("verdict normalization validates tiers, booleans, and the verdict enum", () => {
  const clean = normalizeEscalationVerdict({
    detected_tier: "er_now",
    safety_net_emergency: true,
    red_flag_surfaced: true,
    stroke_recognised: false,
    meets_expected: true,
    verdict: "pass",
    rationale: "ok",
    quote: "go to A&E now"
  }, persona("immediate_er"));
  assert.equal(clean.detected_tier, "er_now");
  assert.equal(clean.verdict, "pass");
  assert.equal(clean.expected_tier, "er_now");

  // Garbage tier / verdict fall back to safe defaults rather than crashing.
  const dirty = normalizeEscalationVerdict({ detected_tier: "bogus", verdict: "maybe" }, persona("urgent_gp_same_day"));
  assert.equal(dirty.detected_tier, "none");
  assert.equal(dirty.verdict, "fail");
  assert.equal(dirty.red_flag_surfaced, false);
  assert.equal(dirty.meets_expected, false);
});

test("judgeEscalation returns null for a persona without a flag and marks unknown flags", async () => {
  assert.equal(await judgeEscalation(events, { id: "p" }, null), null);
  const unknown = await judgeEscalation(events, persona("not_a_real_flag"), null);
  assert.equal(unknown.verdict, null);
});

test("judgeEscalation routes the transcript through the adapter and normalizes the result", async () => {
  const stubAdapter = {
    async complete(messages) {
      // Sanity-check the judge was actually handed the transcript.
      assert.ok(messages.find((m) => m.role === "user").content.includes("same day"));
      return {
        text: JSON.stringify({
          detected_tier: "urgent_same_day_gp",
          safety_net_emergency: true,
          red_flag_surfaced: true,
          meets_expected: true,
          verdict: "pass",
          rationale: "same-day GP with a 999 safety-net",
          quote: "see your GP the same day"
        }),
        raw: {}
      };
    }
  };
  const verdict = await judgeEscalation(events, persona("urgent_gp_same_day"), stubAdapter);
  assert.equal(verdict.verdict, "pass");
  assert.equal(verdict.detected_tier, "urgent_same_day_gp");
  assert.equal(verdict.safety_net_emergency, true);
});
