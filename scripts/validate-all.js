import { spawnSync } from "node:child_process";

const checks = [
  ["npm", ["run", "test:unit"]],
  ["npm", ["run", "test:integration"]],
  ["npm", ["run", "validate:evaluator"]],
  ["npm", ["run", "run:demo"]]
];

for (const [command, args] of checks) {
  const label = [command, ...args].join(" ");
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
