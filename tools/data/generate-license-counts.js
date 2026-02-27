const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const URLS_PATH = path.join(ROOT_DIR, "public", "urls.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "public", "license-counts.json");
const KNOWN_LICENSE_IDS = [2, 3, 4, 5, 8, 6];

function readUrls() {
  const raw = fs.readFileSync(URLS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${URLS_PATH} must contain a JSON array`);
  }
  return parsed;
}

function computeCounts(rows) {
  const counts = new Map();

  for (const row of rows) {
    const licenseId = Number(row?.license);
    if (!Number.isFinite(licenseId)) continue;
    counts.set(licenseId, (counts.get(licenseId) || 0) + 1);
  }

  return counts;
}

function buildOutput(counts) {
  const sortIndexById = new Map(
    KNOWN_LICENSE_IDS.map((licenseId, index) => [licenseId, index])
  );
  const allIds = Array.from(new Set([...KNOWN_LICENSE_IDS, ...counts.keys()]));
  allIds.sort((a, b) => {
    const aIndex = sortIndexById.has(a)
      ? sortIndexById.get(a)
      : Number.MAX_SAFE_INTEGER;
    const bIndex = sortIndexById.has(b)
      ? sortIndexById.get(b)
      : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a - b;
  });

  const byBcId = {};
  for (const id of allIds) {
    byBcId[String(id)] = counts.get(id) || 0;
  }

  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

  return {
    source: "public/urls.json",
    total,
    by_bc_id: byBcId,
  };
}

function writeOrCheck(content, checkMode) {
  const next = `${JSON.stringify(content, null, 2)}\n`;
  const current = fs.existsSync(OUTPUT_PATH)
    ? fs.readFileSync(OUTPUT_PATH, "utf8")
    : null;

  if (current === next) {
    console.log("public/license-counts.json is already up to date.");
    return;
  }

  if (checkMode) {
    console.error("public/license-counts.json is out of date.");
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, next, "utf8");
  console.log("Wrote public/license-counts.json.");
}

function main() {
  const checkMode = process.argv.includes("--check");
  const rows = readUrls();
  const counts = computeCounts(rows);
  const output = buildOutput(counts);

  writeOrCheck(output, checkMode);
  console.log(`licenses=${Object.keys(output.by_bc_id).length} total=${output.total}`);
}

main();
