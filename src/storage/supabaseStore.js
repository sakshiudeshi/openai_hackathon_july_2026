function normalizeRestUrl(url) {
  if (!url) return null;
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/rest/v1") ? trimmed : `${trimmed}/rest/v1`;
}

function jsonHeaders(apiKey) {
  const headers = {
    "content-type": "application/json",
    "apikey": apiKey,
    "prefer": "return=minimal"
  };
  if (apiKey.startsWith("eyJ")) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export class SupabaseStore {
  constructor({
    url = process.env.SUPABASE_URL,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  } = {}) {
    this.restUrl = normalizeRestUrl(url);
    this.serviceRoleKey = serviceRoleKey;
    this.enabled = Boolean(this.restUrl && this.serviceRoleKey);
  }

  async request(table, { method = "POST", row, query = "", headers = {} }) {
    if (!this.enabled) return;
    const response = await fetch(`${this.restUrl}/${table}${query}`, {
      method,
      headers: {
        ...jsonHeaders(this.serviceRoleKey),
        ...headers
      },
      body: row === undefined ? undefined : JSON.stringify(row)
    });
    if (!response.ok) {
      throw new Error(`Supabase ${method} failed for ${table}: ${response.status} ${await response.text()}`);
    }
  }

  async insert(table, row) {
    await this.request(table, { row });
  }

  async upsert(table, row, onConflict) {
    const params = new URLSearchParams({ on_conflict: onConflict });
    await this.request(table, {
      row,
      query: `?${params.toString()}`,
      headers: { prefer: "resolution=merge-duplicates,return=minimal" }
    });
  }

  async update(table, filters, row) {
    const params = new URLSearchParams(filters);
    await this.request(table, {
      method: "PATCH",
      row,
      query: `?${params.toString()}`
    });
  }

  async recordRunStarted({ run_id: runId, hierarchy, persona, modelConfig, versions }) {
    await this.upsert("hierarchy_versions", {
      id: hierarchy.id,
      scope: hierarchy.scope,
      reviewer: hierarchy.reviewer || null,
      version: String(hierarchy.version),
      artifact: hierarchy
    }, "id");

    for (const node of hierarchy.nodes) {
      await this.upsert("risk_nodes", {
        hierarchy_id: hierarchy.id,
        node_id: node.id,
        label: node.label || node.id,
        rank: node.rank,
        risk_tier: node.risk_tier || "low",
        required: Boolean(node.required),
        followups: node.followups || []
      }, "hierarchy_id,node_id");
    }

    await this.upsert("model_configs", {
      id: modelConfig.id,
      provider: modelConfig.provider,
      model: modelConfig.model,
      system_prompt_version: versions.tested_model_system_prompt_version,
      sampling: {
        temperature: modelConfig.temperature ?? 0.2,
        max_tokens: modelConfig.max_tokens ?? null,
        max_completion_tokens: modelConfig.max_completion_tokens ?? null
      }
    }, "id");

    await this.upsert("patient_scenarios", {
      id: persona.id,
      label: persona.label,
      opening_prompt: persona.opening_prompt,
      fixture: persona
    }, "id");

    await this.upsert("eval_runs", {
      id: runId,
      model_config_id: modelConfig.id,
      scenario_id: persona.id,
      hierarchy_id: hierarchy.id,
      simulator_policy_version: versions.simulator_policy_version,
      evaluator_rubric_version: versions.evaluator_rubric_version,
      status: "running"
    }, "id");
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

    await this.update("eval_runs", { id: `eq.${result.run_id}` }, {
      status: "completed",
      completed_at: new Date().toISOString()
    });
  }
}
