// Pure agreement/statistics helpers for comparing two LLM judges on the same
// transcripts (see scripts/judge-agreement.js). Nothing here does I/O or calls a
// model, so it is unit-testable in isolation.

// The judge (src/llmEvaluator.js) reports each node across several turn labels,
// so a node can appear in more than one bucket. For a single per-node category
// we collapse to the highest-credit bucket: an assistant-elicited disclosure
// outranks a volunteered one, which outranks context, which outranks missed.
// This mirrors the intent of scoring, where elicitation is the credited event.
export const ATTRIBUTION_CATEGORIES = [
  "model_elicited",
  "patient_volunteered",
  "context_provided",
  "missed"
];

export function nodeCategory(summary, nodeId) {
  if ((summary.model_elicited_nodes || []).includes(nodeId)) return "model_elicited";
  if ((summary.patient_volunteered_nodes || []).includes(nodeId)) return "patient_volunteered";
  if ((summary.context_provided_nodes || []).includes(nodeId)) return "context_provided";
  return "missed";
}

// Coverage is the binary that coverage_score/priority_score actually depend on:
// was any real fact about the node surfaced at all, regardless of who raised it.
export function isCovered(category) {
  return category !== "missed";
}

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Cohen's kappa for two aligned label arrays over a fixed category set. Corrects
// raw agreement for the agreement expected by chance, so it is comparable across
// runs even when one category (usually "missed") dominates. Returns 1 for perfect
// agreement, 0 for chance-level, negative for worse-than-chance. When there is no
// disagreement possible (pe == 1, e.g. every cell is the same single category) we
// return raw agreement to avoid a 0/0.
export function cohensKappa(a, b, categories) {
  const n = a.length;
  if (n === 0) return null;
  let observed = 0;
  const countsA = new Map(categories.map((c) => [c, 0]));
  const countsB = new Map(categories.map((c) => [c, 0]));
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) observed += 1;
    countsA.set(a[i], (countsA.get(a[i]) || 0) + 1);
    countsB.set(b[i], (countsB.get(b[i]) || 0) + 1);
  }
  const po = observed / n;
  let pe = 0;
  for (const category of categories) {
    pe += (countsA.get(category) / n) * (countsB.get(category) / n);
  }
  if (pe >= 1) return po;
  return (po - pe) / (1 - pe);
}

// Raw (uncorrected) agreement: fraction of aligned cells that match.
export function rawAgreement(a, b) {
  if (!a.length) return null;
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) matches += 1;
  }
  return matches / a.length;
}

// reference -> candidate confusion counts over the category set. Rows are what
// the reference judge said, columns what the candidate said; the diagonal is
// agreement. Reveals *directional* drift (e.g. candidate turning elicited into
// volunteered, or covered into missed).
export function confusionMatrix(refLabels, candLabels, categories) {
  const matrix = new Map(
    categories.map((row) => [row, new Map(categories.map((col) => [col, 0]))])
  );
  for (let i = 0; i < refLabels.length; i += 1) {
    const row = matrix.get(refLabels[i]);
    if (!row) continue;
    row.set(candLabels[i], (row.get(candLabels[i]) || 0) + 1);
  }
  return matrix;
}

export function jaccard(aList, bList) {
  const a = new Set(aList);
  const b = new Set(bList);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

// Average of competition ranks (1-based), ties share the mean of their positions.
function averageRanks(values) {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((p, q) => p.value - q.value);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j += 1;
    const rank = (i + j) / 2 + 1; // average of positions i..j (0-based) -> 1-based
    for (let k = i; k <= j; k += 1) ranks[indexed[k].index] = rank;
    i = j + 1;
  }
  return ranks;
}

// Spearman rank correlation: Pearson on the rank transform. 1 means the two
// judges order these items identically; the sign flips on any inversion.
export function spearman(xs, ys) {
  if (xs.length < 2) return null;
  return pearson(averageRanks(xs), averageRanks(ys));
}

// Number of pairs the two rankings order in opposite directions (Kendall
// discordant-pair count). 0 => same ranking. Ignores pairs tied under either
// judge so a shared plateau is not counted as a flip.
export function rankInversions(xs, ys) {
  let inversions = 0;
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const dx = Math.sign(xs[i] - xs[j]);
      const dy = Math.sign(ys[i] - ys[j]);
      if (dx !== 0 && dy !== 0 && dx !== dy) inversions += 1;
    }
  }
  return inversions;
}
