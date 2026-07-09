# CardioNAVIX

CardioNAVIX is the cardiovascular context engine that helps health AI detect risk, ask the right questions, and route patients safely.

It evaluates health AI conversations against simulated cardiovascular patient personas. Each run checks whether the AI surfaced important risk context, matched the patient's true clinical picture, and handled safety-sensitive routing correctly.

## What Is Included

- Cardiovascular risk hierarchy: `data/hierarchy/cardiovascular_risk_v0.yaml`
- Patient personas: `data/personas/`
- Ground-truth rubrics: `data/Truths/`
- Tested AI prompts: `data/prompts/`
- Model/version config: `config/model_configs.json`
- Local dashboard: `public/` served by `src/server.js`
- Run artifacts: `runs/`

## Demo

To try a demo of how it works, run the app (as outlined in setup), click **Navix Demo** and watch a simulated cardiovascular-risk conversation and evaluation flow.
You can find details of existing runs of various models and how they perform against our patients in the Coverage, Ground Truth and Safety Evaluation Tabs, along with details transcripts.
The Patient Profiles Tab will show the list of personas and how they respond to the AI

## Setup

Requires Node.js 20 or newer.

```bash
npm install
```

For real model runs, add API keys to `.env` or export them in your shell. Start from:

```bash
cp .env.example .env
```

## Run The Dashboard

```bash
npm run dev
```

Open `http://localhost:5173`.

The dashboard reads the latest comparison from `runs/latest-comparison.json`.

## Try It — Live Prompt Simulation

The **Try It** tab runs a fresh simulation on demand: enter a coaching prompt,
pick a tested model and a patient persona, choose a turn limit, and watch a real
LLM-patient ↔ tested-model conversation stream in turn by turn, then get scored on
Coverage, Priority, and Depth.

It is powered by `POST /api/simulate`, a streaming endpoint that emits
newline-delimited JSON (`run_started`, one `event` per turn, a final `score`, or
`error`). The simulation logic is host-agnostic (`src/liveSimulation.js`) and is
served two ways from the same code:

- **Locally** by the Node dev server (`src/server.js`) — needs `OPENAI_API_KEY`
  in your `.env`.
- **In production** by a Cloudflare Pages Function (`functions/api/simulate.js`).

The tested model is the one under evaluation (OpenAI `gpt-5.5` or `gpt-5.4-mini`);
the simulated patient and the judge always run on the fast model to keep the
stream responsive. The turn slider is capped at **20** so a run stays under the
Cloudflare **free-tier** limit of 50 subrequests per request (≈2 model calls per
turn + 1 judge call). On Cloudflare Workers **Paid** (1000 subrequests) you can
raise the cap to 30 by bumping `MAX_TURN_LIMIT` in `src/liveSimulation.js` and
`HF_MAX_TURNS` in `public/app.js`.

## Deploy

The dashboard deploys as a static site (built into `./dist`) plus the one live
Pages Function above.

### Cloudflare Pages

```bash
# 1. Build ./dist (also refreshes the fs-free data bundle the Function ships)
npm run build:pages

# 2. Store the API key as a Pages secret (never committed; not in the bundle)
npx wrangler pages secret put OPENAI_API_KEY

# 3. Deploy the static assets + compile ./functions
npx wrangler pages deploy dist
# or: npm run deploy:cloudflare
```

Requires `nodejs_compat` (already set in `wrangler.toml`). The static
benchmark tabs (Results, Ground Truth, Safety, Patients) read snapshotted JSON;
only the Try It tab calls the live Function.

### Alternative: any Node host (no subrequest cap)

Because the app is a plain Node server, hosts like **Render**, **Railway**, or
**Fly.io** can run it as-is with no subrequest limit and no free-tier turn cap —
just set `OPENAI_API_KEY` in the host's environment and run `npm run dev`
(`node src/server.js`). This is the lowest-friction way to run the full 30-turn
experience.

## Run Evaluations

### Coverage Evaluation

```bash
node --env-file=.env scripts/run-evaluation.js
```

Runs the configured AI versions against the personas and scores cardiovascular risk-factor coverage, priority, depth, and efficiency.

Useful variants:

```bash
node --env-file=.env scripts/run-evaluation.js --personas 3,4,5
node --env-file=.env scripts/run-evaluation.js --config config/model_configs.json --turn-limit 10
```

### Ground Truth Evaluation

```bash
node --env-file=.env scripts/judge-truth-match.js
```

Re-judges saved dashboard runs against the ground-truth rubrics in `data/Truths/` and writes `truth_match` results back into `runs/latest-comparison.json`.

Useful variants:

```bash
node --env-file=.env scripts/judge-truth-match.js --concurrency 8
node --env-file=.env scripts/judge-truth-match.js <run_id_1> <run_id_2>
```

### Safety Evaluation

```bash
node --env-file=.env scripts/check-escalation.js --dashboard
```

Runs the escalation personas and checks whether the tested AI routed urgent cardiovascular cases to the correct level of care. With `--dashboard`, results are added to the dashboard data.

Useful variants:

```bash
node --env-file=.env scripts/check-escalation.js --tested-model gpt_5_4_mini_prompt_simple --dashboard
node --env-file=.env scripts/check-escalation.js --tested-provider openai --tested-model-name gpt-5.5 --dashboard
```

## Add A New AI Version To Evaluate

1. Add the new system prompt in `data/prompts/`, for example:

```text
data/prompts/tested_model_system_prompt_v3.txt
```

2. Add a new entry to `config/model_configs.json`:

```json
{
  "id": "gpt_5_5_prompt_v3",
  "label": "GPT-5.5 · prompt v3",
  "provider": "openai",
  "model": "gpt-5.5",
  "temperature": 1,
  "max_tokens": 1000,
  "systemPromptPath": "data/prompts/tested_model_system_prompt_v3.txt",
  "systemPromptVersion": "tested_model_system_prompt_v3"
}
```

3. Run coverage, ground truth, and safety again:

```bash
node --env-file=.env scripts/run-evaluation.js
node --env-file=.env scripts/judge-truth-match.js
node --env-file=.env scripts/check-escalation.js --tested-model gpt_5_5_prompt_v3 --dashboard
```

## Validation And Tests

```bash
npm test
npm run test:unit
npm run test:integration
npm run validate:evaluator
npm run validate:all
```

`validate:all` runs unit tests, integration tests, evaluator validation, and demo generation.

## Outputs

Each evaluation run is saved under:

```text
runs/<run_id>/
```

The dashboard comparison file is:

```text
runs/latest-comparison.json
```

That file is updated by coverage runs, then enriched by ground-truth and safety scripts.
