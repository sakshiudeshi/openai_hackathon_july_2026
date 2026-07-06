// Tiny dependency-free progress bar for CLI scripts.
//
// Returns a function suitable to pass as runComparison's `onProgress` callback.
// On a TTY it renders a single line that updates in place; when output is piped
// or redirected (no TTY) it falls back to one plain line per completed run so
// logs stay readable.

function fmtDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function runLabel(modelConfig, persona) {
  const model = modelConfig.label || modelConfig.model || modelConfig.id;
  const scenario = persona.label || persona.id;
  return `${model} × ${scenario}`;
}

export function createProgressBar({ total, now = () => Date.now(), stream = process.stdout, width = 24 } = {}) {
  const isTty = Boolean(stream.isTTY);
  const startedAt = now();
  let lastLineLength = 0;

  function draw(completed, suffix) {
    const ratio = total > 0 ? completed / total : 1;
    const filled = Math.round(ratio * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    const pct = String(Math.round(ratio * 100)).padStart(3, " ");
    const elapsed = fmtDuration(now() - startedAt);
    // ETA from the mean time per completed run; omitted until we have a sample.
    const eta = completed > 0 && completed < total
      ? ` · ETA ${fmtDuration(((now() - startedAt) / completed) * (total - completed))}`
      : "";
    const line = `Evaluating ▕${bar}▏ ${completed}/${total} (${pct}%) · ${elapsed}${eta} · ${suffix}`;
    // Pad over the previous, possibly-longer line so stale characters are cleared.
    const padded = line.padEnd(lastLineLength, " ");
    lastLineLength = line.length;
    stream.write(`\r${padded}`);
  }

  return ({ phase, completed, modelConfig, persona }) => {
    const label = runLabel(modelConfig, persona);
    if (!isTty) {
      if (phase === "complete") {
        stream.write(`  [${completed}/${total}] ${label} (${fmtDuration(now() - startedAt)})\n`);
      }
      return;
    }
    if (phase === "start") {
      draw(completed, `running ${label}…`);
    } else {
      draw(completed, `done ${label}`);
      if (completed >= total) stream.write("\n");
    }
  };
}
