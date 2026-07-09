# TODO

## Live Prompt Scoring Backend

- Add an API endpoint for the Try It page, for example `POST /api/try-prompt`.
- Request payload should include:
  - `prompt`
  - `persona_id`
  - `turn_limit`
  - `model_config` or `model_id`
- Backend should run a fresh simulated patient conversation using the selected persona and turn limit.
- Score the resulting transcript with the existing coverage, priority, depth, ground-truth, and safety evaluators where applicable.
- Return the transcript, score breakdown, missed required nodes, safety flags, and run metadata to the frontend.
- Persist ad hoc runs separately from benchmark runs so user experiments do not overwrite `runs/latest-comparison.json`.
