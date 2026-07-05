# Cardiovascular Risk Hierarchy Evaluation v0

This is a local-first prototype for comparing how LLMs elicit adult primary-care cardiovascular risk factors in a normal conversation. The tested model is not shown the hierarchy, rubric, or scoring rules.

## What is included

- Compact hierarchy artifact: `data/hierarchy/cardiovascular_risk_v0.yaml`
- Standardized tested-model system prompt: `data/prompts/tested_model_system_prompt_v0.txt`
- Three fixed patient personas with hidden facts and disclosure order: `data/personas/`
- Deterministic simulator with conformance tests
- Provider adapter layer for OpenRouter, OpenAI, Anthropic, and offline scripted runs
- Evidence extraction, evaluator validation, deterministic scoring, and demo run generation
- Every run receives a 12-character alphanumeric `run_id`
- Postgres/Supabase schema: `db/schema.sql`
- Local dashboard served by a dependency-free Node backend

## Run locally

```bash
npm test
npm run dev
```

Then open `http://localhost:5173`.

The dashboard uses offline scripted comparator models by default. These are not real leaderboard results; they exist so the scoring and audit UI can be reviewed without API keys.

## Run a real model comparison

1. Copy `.env.example` values into your shell environment.
2. Edit `config/model_configs.json` with the four provider/model IDs you want to compare.
3. Run:

```bash
npm run run:evaluation
```

Results are written to `runs/` by default. Each run is stored under `runs/<run_id>/` with a compact `manifest.json` and the full `run.json` transcript/evidence payload. If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, the storage layer can stream rows to Supabase's PostgREST API after `db/schema.sql` has been applied.

## Runtime config

Central defaults live in `config/default.json`.

Environment overrides:

```bash
APP_CONFIG_PATH=config/default.json
PORT=5173
RUN_TURN_LIMIT=10
MODEL_CONFIG_PATH=config/model_configs.json
RUN_OUTPUT_DIR=runs
LATEST_COMPARISON_FILE=latest-comparison.json
DEMO_COMPARISON_FILE=demo-results.json
```

CLI overrides still work for one-off runs:

```bash
npm run run:evaluation -- --config config/model_configs.json --turn-limit 6
```

## Validate the evaluator

```bash
npm run validate:evaluator
```

The v0 gate is intentionally simple: at least 0.90 precision and recall for model-elicited node coverage on the small gold set, plus deterministic self-consistency across repeated evaluator runs.

## Test and validation suite

```bash
npm run test:unit
npm run test:integration
npm run validate:all
```

`validate:all` runs unit tests, integration tests, evaluator validation, and demo generation. The integration tests validate full runner outputs, audit invariants, comparison sorting, and the dashboard request resolver without binding a local port.

## Docker

```bash
docker compose up --build
```

This starts Postgres and the dashboard service. Apply `db/schema.sql` to the database before using Postgres-backed storage.

## Clinical review checklist for Arun

- Verify whether the v0 nodes belong in the hierarchy.
- Verify rank order, risk tier, required flags, and follow-up fields.
- Treat rank as conversation order only; risk tier is the scoring magnitude for missed required nodes.
- Review the simulator policy for fairness and realism.
- Review the evaluator rubric and scoring formulas before using real model comparison numbers.
