function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) return [];
    return body.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return trimmed;
}

export function parseHierarchyYaml(text) {
  const result = { nodes: [] };
  let inNodes = false;
  let currentNode = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (line === "nodes:") {
      inNodes = true;
      continue;
    }

    if (!inNodes) {
      const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (match) result[match[1]] = parseScalar(match[2]);
      continue;
    }

    const nodeStart = line.match(/^  - ([A-Za-z0-9_]+):\s*(.*)$/);
    if (nodeStart) {
      currentNode = { [nodeStart[1]]: parseScalar(nodeStart[2]) };
      result.nodes.push(currentNode);
      continue;
    }

    const nodeField = line.match(/^    ([A-Za-z0-9_]+):\s*(.*)$/);
    if (nodeField && currentNode) {
      currentNode[nodeField[1]] = parseScalar(nodeField[2]);
    }
  }

  return result;
}

