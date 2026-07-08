// Live per-version turn progress for the version-comparison sweep.
//
// Because runs execute concurrently, a single-line bar can't show what each
// version is doing. Instead this renders ONE line per version, updated in
// place, showing how many runs that version has finished and — for each of its
// currently-running personas — which turn it is on:
//
//   GPT-5.5 · prompt v0  │ 2/13 done │ persona_4→t7  persona_5→t3
//   GPT-5.5 · prompt v1  │ 1/13 done │ persona_4→t12
//
// On a TTY the block is redrawn in place. When piped (no TTY) it falls back to
// one plain line per turn and per completion so logs stay readable.

function versionLabel(modelConfig) {
  return modelConfig.label || modelConfig.model || modelConfig.id;
}

export function createTurnProgress({ modelConfigs, personasPerVersion, stream = process.stdout } = {}) {
  const isTty = Boolean(stream.isTTY);
  const startedAt = Date.now();
  const order = modelConfigs.map((cfg) => cfg.id);
  const state = new Map(
    modelConfigs.map((cfg) => [cfg.id, {
      label: versionLabel(cfg),
      total: personasPerVersion,
      done: 0,
      active: new Map() // persona.id -> { turn, turnLimit }
    }])
  );
  let drawn = false;

  function fmtElapsed() {
    const s = Math.round((Date.now() - startedAt) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  }

  function lineFor(id) {
    const entry = state.get(id);
    const active = [...entry.active.entries()]
      .map(([persona, { turn, turnLimit }]) => `${persona}→t${turn}/${turnLimit}`)
      .join("  ");
    const status = entry.done >= entry.total
      ? "✓ complete"
      : (active || "waiting…");
    return `${entry.label.padEnd(24)} │ ${entry.done}/${entry.total} done │ ${status}`;
  }

  function render() {
    if (!isTty) return;
    const lines = order.map((id) => `\x1b[K${lineFor(id)}`);
    if (drawn) stream.write(`\x1b[${order.length}A`); // cursor up to top of block
    stream.write(lines.join("\n") + "\n");
    drawn = true;
  }

  return {
    onTurn({ modelConfig, persona, turn, turnLimit }) {
      state.get(modelConfig.id).active.set(persona.id, { turn, turnLimit });
      if (isTty) {
        render();
      } else {
        stream.write(`  [${versionLabel(modelConfig)} × ${persona.id}] turn ${turn}/${turnLimit}\n`);
      }
    },
    onComplete({ modelConfig, persona, result }) {
      const entry = state.get(modelConfig.id);
      entry.active.delete(persona.id);
      entry.done += 1;
      if (isTty) {
        render();
      } else {
        const score = result?.score?.bottom_to_roof_score;
        stream.write(`  [${entry.label} × ${persona.id}] done (${entry.done}/${entry.total})`
          + (result?.run_id ? ` · run ${result.run_id}` : "")
          + (score != null ? ` · score ${score}` : "") + `\n`);
      }
    },
    finish() {
      if (isTty && drawn) stream.write(`\nDone in ${fmtElapsed()}.\n`);
      else stream.write(`Done in ${fmtElapsed()}.\n`);
    }
  };
}
