create table if not exists hierarchy_versions (
  id text primary key,
  scope text not null,
  reviewer text,
  version text not null,
  artifact jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists risk_nodes (
  hierarchy_id text not null references hierarchy_versions(id),
  node_id text not null,
  label text not null,
  rank integer not null,
  risk_tier text not null default 'low' check (risk_tier in ('high', 'moderate', 'low')),
  required boolean not null,
  followups jsonb not null default '[]'::jsonb,
  primary key (hierarchy_id, node_id)
);

create table if not exists patient_scenarios (
  id text primary key,
  label text not null,
  opening_prompt text not null,
  fixture jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists model_configs (
  id text primary key,
  provider text not null,
  model text not null,
  system_prompt_version text not null,
  sampling jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists eval_runs (
  id text primary key,
  model_config_id text not null references model_configs(id),
  scenario_id text not null references patient_scenarios(id),
  hierarchy_id text not null references hierarchy_versions(id),
  simulator_policy_version text not null,
  evaluator_rubric_version text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists conversation_events (
  id bigserial primary key,
  run_id text not null references eval_runs(id),
  turn integer not null,
  speaker text not null check (speaker in ('patient', 'assistant', 'system')),
  text text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists evaluator_labels (
  id bigserial primary key,
  run_id text not null references eval_runs(id),
  turn integer not null,
  model_elicited_nodes jsonb not null default '[]'::jsonb,
  patient_volunteered_nodes jsonb not null default '[]'::jsonb,
  context_provided_nodes jsonb not null default '[]'::jsonb,
  model_elicited_followups jsonb not null default '[]'::jsonb,
  patient_volunteered_followups jsonb not null default '[]'::jsonb,
  safety_flags jsonb not null default '[]'::jsonb,
  noise_flags jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists node_attributions (
  id bigserial primary key,
  run_id text not null references eval_runs(id),
  node_id text not null,
  attribution text not null check (attribution in ('model_elicited', 'patient_volunteered', 'context_provided', 'missed', 'partially_covered')),
  first_turn integer,
  evidence text,
  created_at timestamptz not null default now()
);

create table if not exists gold_labels (
  id text primary key,
  transcript jsonb not null,
  labels jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists evaluator_validation_runs (
  id text primary key,
  evaluator_rubric_version text not null,
  precision numeric not null,
  recall numeric not null,
  self_consistency numeric not null,
  passed boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists scores (
  id bigserial primary key,
  run_id text not null references eval_runs(id),
  bottom_to_roof_score numeric not null,
  coverage_score numeric not null,
  priority_score numeric not null,
  depth_score numeric not null,
  coverage_efficiency_score numeric not null default 0,
  safety_score numeric not null,
  noise_penalty numeric not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
