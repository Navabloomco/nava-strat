import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const checks = [
  {
    file: "app/ops/efficiency/page.tsx",
    forbidden: [
      "Revenue:",
      "Linked cost:",
      "Contribution:",
      "Margin:",
      "Provisional per-km",
      "Ready for profit review",
      "canonical provider_idle_marker",
      "legacy excessive_idle",
    ],
  },
];

const failures = [];

for (const check of checks) {
  const filePath = resolve(check.file);
  const content = readFileSync(filePath, "utf8");

  for (const phrase of check.forbidden) {
    if (content.includes(phrase)) {
      failures.push(`${check.file}: forbidden customer-facing phrase "${phrase}"`);
    }
  }
}

if (failures.length > 0) {
  console.error("Product boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Product boundary check passed.");
