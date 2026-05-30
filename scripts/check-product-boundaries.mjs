import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

const checks = [
  {
    label: "Ops Intelligence finance/default-copy boundary",
    files: ["app/ops/efficiency/page.tsx"],
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
  {
    label: "Operations customer-copy boundary",
    dirs: ["app/ops"],
    forbidden: [
      "Ready for profit review",
      "canonical provider_idle_marker",
      "legacy excessive_idle",
      "provider_signal_flags",
    ],
  },
  {
    label: "Client portal privacy boundary",
    dirs: ["app/client"],
    forbidden: [
      "Raw coordinates",
      "raw coordinates",
      "Latitude:",
      "Longitude:",
      "lat/lng",
      "latitude, longitude",
    ],
  },
  {
    label: "Tenant Team Access copy boundary",
    files: ["app/admin/team-access/page.tsx"],
    forbidden: [
      "Platform owner access",
      ">Platform owner<",
      "Supabase Auth",
      "service role",
      "support superuser",
    ],
  },
  {
    label: "Public entry copy boundary",
    files: [
      "app/page.tsx",
      "app/pricing/page.tsx",
      "app/onboarding/page.tsx",
      "app/login/page.tsx",
    ],
    forbidden: [
      "pilot trial",
      "Start trial",
      "generic AI-assisted",
      "fuel theft",
      "final profit",
    ],
  },
  {
    label: "Provider default copy boundary",
    files: [
      "app/admin/providers/page.tsx",
      "app/admin/providers/new/page.tsx",
    ],
    forbidden: [
      "raw payload",
      "service role",
      "Supabase Auth",
    ],
  },
];

const failures = [];

for (const check of checks) {
  const files = [
    ...(check.files || []),
    ...(check.dirs || []).flatMap((dir) => walkSourceFiles(resolve(dir))),
  ];

  for (const file of files) {
    const filePath = resolve(file);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");

    for (const phrase of check.forbidden) {
      if (content.includes(phrase)) {
        failures.push(`${check.label}: ${file} contains forbidden customer-facing phrase "${phrase}"`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Product boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Product boundary check passed.");

function walkSourceFiles(root) {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(extname(root)) ? [root] : [];

  return readdirSync(root)
    .flatMap((entry) => walkSourceFiles(resolve(root, entry)));
}
