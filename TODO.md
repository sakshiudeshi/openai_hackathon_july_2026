# TODO

## Live Prompt Scoring Backend — DONE

Implemented as `POST /api/simulate` (streaming NDJSON), driven by the
host-agnostic engine in `src/liveSimulation.js` and surfaced in the **Try It**
tab. It runs a fresh LLM-patient ↔ tested-model conversation for the chosen
persona and turn limit, scores it with the existing coverage/priority/depth
evaluator, and streams each turn plus the final score to the frontend.

- Served locally by `src/server.js` and in production by the Cloudflare Pages
  Function `functions/api/simulate.js` (same shared code).
- Data ships to the Worker via the generated bundle `src/generated/dataBundle.js`
  (`npm run build:data`, also run by `npm run build:pages`).

### Follow-ups

- Persist ad hoc Try It runs separately from benchmark runs so user experiments
  do not overwrite `runs/latest-comparison.json` (currently live runs are not
  saved to disk at all).
- Raise the turn cap from 20 to 30 once deploying on Cloudflare Workers Paid
  (`MAX_TURN_LIMIT` in `src/liveSimulation.js`, `HF_MAX_TURNS` in `public/app.js`).
- Add Anthropic / Gemini(OpenRouter) as selectable tested models (adapters exist;
  add entries to `LIVE_MODELS` + `HF_MODELS` and the corresponding API keys).
- Optionally fold the escalation/safety judge into the live score.
