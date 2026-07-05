export class SupabaseStore {
  constructor({
    url = process.env.SUPABASE_URL,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  } = {}) {
    this.url = url?.replace(/\/$/, "");
    this.serviceRoleKey = serviceRoleKey;
    this.enabled = Boolean(this.url && this.serviceRoleKey);
  }

  async insert(table, row) {
    if (!this.enabled) return;
    const response = await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": this.serviceRoleKey,
        "authorization": `Bearer ${this.serviceRoleKey}`,
        "prefer": "return=minimal"
      },
      body: JSON.stringify(row)
    });
    if (!response.ok) {
      throw new Error(`Supabase insert failed for ${table}: ${response.status} ${await response.text()}`);
    }
  }

  async recordEvent(event) {
    await this.insert("conversation_events", {
      run_id: event.run_id,
      turn: event.turn,
      speaker: event.speaker,
      text: event.text,
      metadata: event.metadata || {}
    });
  }

  async recordRunResult(result) {
    await this.insert("scores", {
      run_id: result.run_id,
      bottom_to_roof_score: result.score.bottom_to_roof_score,
      coverage_score: result.score.coverage_score,
      priority_score: result.score.priority_score,
      depth_score: result.score.depth_score,
      safety_score: result.score.safety_score,
      noise_penalty: result.score.noise_penalty,
      details: result.score.details
    });

    for (const label of result.evidence.labels) {
      await this.insert("evaluator_labels", {
        run_id: result.run_id,
        turn: label.turn,
        model_elicited_nodes: label.model_elicited_nodes,
        patient_volunteered_nodes: label.patient_volunteered_nodes,
        context_provided_nodes: label.context_provided_nodes,
        model_elicited_followups: label.model_elicited_followups,
        patient_volunteered_followups: label.patient_volunteered_followups,
        safety_flags: label.safety_flags,
        noise_flags: label.noise_flags,
        evidence: label.evidence
      });
    }

    for (const attribution of result.attributions) {
      await this.insert("node_attributions", {
        run_id: result.run_id,
        node_id: attribution.node_id,
        attribution: attribution.attribution,
        first_turn: attribution.first_turn,
        evidence: attribution.followups.join(", ")
      });
    }
  }
}

