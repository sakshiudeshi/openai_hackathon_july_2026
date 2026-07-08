export const TESTED_MODEL_SYSTEM_PROMPT_VERSION = "tested_model_system_prompt_simple";
export const SIMULATOR_POLICY_VERSION = "simulator_policy_v0";
export const LLM_PATIENT_POLICY_VERSION = "llm_patient_v1";
export const EVALUATOR_RUBRIC_VERSION = "deterministic_evidence_extractor_v0";
// v1: followup depth is credited for any obtained node (model_elicited OR
// patient_volunteered), so depth no longer depends on who raised the topic.
export const LLM_JUDGE_RUBRIC_VERSION = "llm_judge_evidence_extractor_v1";
// v1: a required fact counts as covered when obtained by either model
// elicitation or patient volunteering (volunteered no longer scored as a miss).
export const SCORING_RUBRIC_VERSION = "bottom_to_roof_scoring_v1";

