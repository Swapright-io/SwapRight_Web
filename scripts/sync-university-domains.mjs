import { mkdir, readFile, writeFile } from "node:fs/promises";

const SOURCE_URL = "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json";
const sourcePath = process.argv[2] || ".tmp/world_universities_and_domains.json";

const raw = await readFile(sourcePath, "utf8");
const universities = JSON.parse(raw);
const rows = new Map();

for (const university of universities) {
  if (university.country !== "United States" || university.alpha_two_code !== "US") continue;
  for (const domain of university.domains || []) {
    const normalized = String(domain).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!normalized.endsWith(".edu")) continue;
    rows.set(normalized, {
      domain: normalized,
      institution_name: university.name,
      state: university["state-province"] || null,
      country_code: "US",
      source: SOURCE_URL,
    });
  }
}

const sorted = [...rows.values()].sort((a, b) => a.domain.localeCompare(b.domain));
await mkdir("data", { recursive: true });
await mkdir("supabase/seed", { recursive: true });
await writeFile("data/us-university-domains.json", JSON.stringify({ source: SOURCE_URL, domains: sorted }, null, 2) + "\n");

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [
  "domain,institution_name,state,country_code,source",
  ...sorted.map((row) => [row.domain, row.institution_name, row.state, row.country_code, row.source].map(csvEscape).join(",")),
].join("\n") + "\n";
await writeFile("supabase/seed/us_university_domains.csv", csv);
console.log(`Synced ${sorted.length} U.S. .edu domains from ${SOURCE_URL}`);
