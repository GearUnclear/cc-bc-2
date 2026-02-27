#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  concurrency: 6,
  timeoutMs: 15000,
  retries: 1,
  limit: null,
  write: false,
  targetVersions: ["3.0", "4.0"],
  progressEvery: 250,
  retryStatuses: [403, 408, 425, 429, 500, 502, 503, 504],
  statusBackoffMs: 750,
  statusBackoffMaxMs: 10000,
};

function printHelp() {
  console.log(`Map missing licenses when the detected CC URL is an exact match
to a legitimate target URL.

Usage:
  node scripts/fix-missing-licenses-exact.mjs [options]

Options:
  --write                 Persist changes to public/urls.json and src/data/licenses.json
  --limit <n>             Process only first N missing-license rows (dry-run helper, no --write)
  --concurrency <n>       Parallel HTTP requests (default: 6)
  --timeout-ms <n>        Timeout per request in milliseconds (default: 15000)
  --retries <n>           Retries after first attempt (default: 1)
  --target-versions <v>   Comma-separated versions for exact target URL generation (default: 3.0,4.0)
  --progress-every <n>    Print progress after every N processed rows (default: 250)
  --retry-statuses <csv>  HTTP statuses retried with backoff (default: 403,408,425,429,500,502,503,504)
  --status-backoff-ms <n> Initial retry backoff in milliseconds (default: 750)
  --status-backoff-max-ms <n> Max retry backoff in milliseconds (default: 10000)
  --help                  Show this message

Examples:
  node scripts/fix-missing-licenses-exact.mjs
  node scripts/fix-missing-licenses-exact.mjs --limit 100
  node scripts/fix-missing-licenses-exact.mjs --write
`);
}

function parseStatusList(raw) {
  return [...new Set(
    raw
      .split(",")
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((v) => Number.isInteger(v) && v >= 100 && v <= 599)
  )];
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--concurrency" && next) {
      options.concurrency = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--retries" && next) {
      options.retries = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--target-versions" && next) {
      options.targetVersions = next
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      i++;
      continue;
    }
    if (arg === "--progress-every" && next) {
      options.progressEvery = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--retry-statuses" && next) {
      options.retryStatuses = parseStatusList(next);
      i++;
      continue;
    }
    if (arg === "--status-backoff-ms" && next) {
      options.statusBackoffMs = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--status-backoff-max-ms" && next) {
      options.statusBackoffMaxMs = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency <= 0) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  if (!Number.isFinite(options.retries) || options.retries < 0) {
    throw new Error("--retries must be a non-negative integer");
  }
  if (
    options.limit != null &&
    (!Number.isFinite(options.limit) || options.limit <= 0)
  ) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Array.isArray(options.targetVersions) || !options.targetVersions.length) {
    throw new Error("--target-versions must include at least one version");
  }
  if (!Number.isFinite(options.progressEvery) || options.progressEvery <= 0) {
    throw new Error("--progress-every must be a positive integer");
  }
  if (!Array.isArray(options.retryStatuses) || options.retryStatuses.length === 0) {
    throw new Error("--retry-statuses must include at least one valid HTTP status");
  }
  if (!Number.isFinite(options.statusBackoffMs) || options.statusBackoffMs < 0) {
    throw new Error("--status-backoff-ms must be a non-negative integer");
  }
  if (
    !Number.isFinite(options.statusBackoffMaxMs) ||
    options.statusBackoffMaxMs < options.statusBackoffMs
  ) {
    throw new Error("--status-backoff-max-ms must be >= --status-backoff-ms");
  }
  if (options.write && options.limit != null) {
    throw new Error("--write cannot be combined with --limit");
  }

  return options;
}

function normalizeCcLicenseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase() !== "creativecommons.org") {
      return null;
    }

    const pathMatch = parsed.pathname
      .toLowerCase()
      .match(/^\/licenses\/([a-z-]+)\/([0-9.]+)\/?$/);
    if (!pathMatch) {
      return null;
    }

    const slug = pathMatch[1];
    const version = pathMatch[2];
    const canonical = `https://creativecommons.org/licenses/${slug}/${version}/`;
    return { canonical, slug, version };
  } catch {
    return null;
  }
}

function extractCcLicenseUrls(html) {
  const urls = [];
  const seen = new Set();
  const anchorRegex =
    /<a\b[^>]*href=(["'])(https?:\/\/creativecommons\.org\/licenses\/[^"']+)\1[^>]*>/gi;

  let match = null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const normalized = normalizeCcLicenseUrl(match[2]);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized.canonical)) {
      continue;
    }
    seen.add(normalized.canonical);
    urls.push(normalized);
  }

  return urls;
}

function buildLegitimateTargetMap(validLicenses, targetVersions) {
  const targetMap = new Map();

  for (const license of validLicenses) {
    const normalizedBase = normalizeCcLicenseUrl(license.url);
    if (normalizedBase) {
      targetMap.set(normalizedBase.canonical, {
        bc_id: license.bc_id,
        name: license.name,
      });
    }

    for (const version of targetVersions) {
      const exact = `https://creativecommons.org/licenses/${license.name}/${version}/`;
      targetMap.set(exact, {
        bc_id: license.bc_id,
        name: license.name,
      });
    }
  }

  return targetMap;
}

async function fetchPage(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });

    const text = await response.text();
    return {
      status: response.status,
      finalUrl: response.url,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function backoffDelayMs(attempt, baseMs, maxMs) {
  if (baseMs <= 0) {
    return 0;
  }

  const expDelay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(expDelay);
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function inspectListing(
  listing,
  options,
  legitimateTargetMap,
  retryStatusSet
) {
  let lastError = null;
  const attempts = options.retries + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const page = await fetchPage(listing.url, options.timeoutMs);
      if (retryStatusSet.has(page.status) && attempt < attempts) {
        await sleep(
          backoffDelayMs(
            attempt,
            options.statusBackoffMs,
            options.statusBackoffMaxMs
          )
        );
        continue;
      }

      const detected = extractCcLicenseUrls(page.text);
      const matched = detected
        .filter((d) => legitimateTargetMap.has(d.canonical))
        .map((d) => ({
          ...d,
          ...legitimateTargetMap.get(d.canonical),
        }));

      const uniqueBcIds = [...new Set(matched.map((m) => m.bc_id))];

      if (uniqueBcIds.length === 1) {
        return {
          url_id: listing.url_id,
          url: listing.url,
          title: listing.title,
          status: page.status,
          final_url: page.finalUrl,
          mapped: {
            bc_id: uniqueBcIds[0],
            name: matched[0].name,
            matched_url: matched[0].canonical,
          },
          reason: null,
          detected_urls: detected.map((d) => d.canonical),
          error: null,
        };
      }

      return {
        url_id: listing.url_id,
        url: listing.url,
        title: listing.title,
        status: page.status,
        final_url: page.finalUrl,
        mapped: null,
        reason: (() => {
          if (detected.length === 0 && page.status >= 400) {
            return `http_status_${page.status}`;
          }
          if (matched.length === 0) {
            return "no_exact_legitimate_match";
          }
          return "ambiguous_exact_matches";
        })(),
        detected_urls: detected.map((d) => d.canonical),
        error: null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(
          backoffDelayMs(
            attempt,
            options.statusBackoffMs,
            options.statusBackoffMaxMs
          )
        );
      }
    }
  }

  return {
    url_id: listing.url_id,
    url: listing.url,
    title: listing.title,
    status: null,
    final_url: null,
    mapped: null,
    reason: "fetch_error",
    detected_urls: [],
    error: lastError instanceof Error ? lastError.message : "Unknown error",
  };
}

async function mapWithConcurrency(items, concurrency, mapper, onProgress) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex++;
      if (current >= items.length) {
        return;
      }
      results[current] = await mapper(items[current], current);
      completed++;
      if (typeof onProgress === "function") {
        onProgress({
          completed,
          total: items.length,
          result: results[current],
          index: current,
        });
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(concurrency, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function summarize(results) {
  const summary = {
    processed: results.length,
    mapped: 0,
    unresolved: 0,
    reasons: {},
    mapped_breakdown: {},
    fetch_errors: 0,
  };

  for (const row of results) {
    if (row.mapped) {
      summary.mapped++;
      const key = `${row.mapped.name} (${row.mapped.bc_id})`;
      summary.mapped_breakdown[key] = (summary.mapped_breakdown[key] || 0) + 1;
    } else {
      summary.unresolved++;
      summary.reasons[row.reason] = (summary.reasons[row.reason] || 0) + 1;
      if (row.reason === "fetch_error") {
        summary.fetch_errors++;
      }
    }
  }

  return summary;
}

function toMarkdown(payload) {
  const lines = [];
  lines.push("# Missing License Exact-Match Fix Report");
  lines.push("");
  lines.push(`Generated: ${payload.generated_at}`);
  lines.push(`Write mode: ${payload.options.write ? "yes" : "no (dry-run)"}`);
  lines.push("");
  lines.push("## Parameters");
  lines.push(`- Concurrency: ${payload.options.concurrency}`);
  lines.push(`- Timeout (ms): ${payload.options.timeoutMs}`);
  lines.push(`- Retries: ${payload.options.retries}`);
  lines.push(`- Limit: ${payload.options.limit ?? "none"}`);
  lines.push(
    `- Target versions: ${payload.options.targetVersions.join(", ")}`
  );
  lines.push(`- Progress every: ${payload.options.progressEvery}`);
  lines.push(
    `- Retry statuses: ${payload.options.retryStatuses.join(", ")}`
  );
  lines.push(`- Status backoff (ms): ${payload.options.statusBackoffMs}`);
  lines.push(
    `- Status backoff max (ms): ${payload.options.statusBackoffMaxMs}`
  );
  lines.push("");
  lines.push("## Totals");
  lines.push(
    `- Missing licenses before run: ${payload.dataset.missing_before}`
  );
  lines.push(`- Processed: ${payload.summary.processed}`);
  lines.push(`- Mapped: ${payload.summary.mapped}`);
  lines.push(`- Unresolved: ${payload.summary.unresolved}`);
  lines.push(`- Missing licenses after run: ${payload.dataset.missing_after}`);
  lines.push("");

  lines.push("## Mapped Breakdown");
  const mappedEntries = Object.entries(payload.summary.mapped_breakdown).sort(
    (a, b) => b[1] - a[1]
  );
  if (mappedEntries.length === 0) {
    lines.push("- none");
  } else {
    for (const [name, count] of mappedEntries) {
      lines.push(`- ${name}: ${count}`);
    }
  }
  lines.push("");

  lines.push("## Unresolved Reasons");
  const reasonEntries = Object.entries(payload.summary.reasons).sort(
    (a, b) => b[1] - a[1]
  );
  if (reasonEntries.length === 0) {
    lines.push("- none");
  } else {
    for (const [reason, count] of reasonEntries) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push("");

  lines.push("## Example Unresolved URLs (first 20)");
  const unresolved = payload.results.filter((r) => !r.mapped).slice(0, 20);
  if (unresolved.length === 0) {
    lines.push("- none");
  } else {
    for (const row of unresolved) {
      lines.push(`- ${row.url} (${row.reason})`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const urlsPath = path.join(root, "public", "urls.json");
  const licensesPath = path.join(root, "src", "data", "licenses.json");
  const reportsDir = path.join(root, "reports");

  const [urlsRaw, licensesRaw] = await Promise.all([
    fs.readFile(urlsPath, "utf8"),
    fs.readFile(licensesPath, "utf8"),
  ]);

  const urls = JSON.parse(urlsRaw);
  const licenses = JSON.parse(licensesRaw);

  const validLicenses = licenses.filter(
    (l) => typeof l?.name === "string" && Number.isInteger(l?.bc_id)
  );

  const legitimateTargetMap = buildLegitimateTargetMap(
    validLicenses,
    options.targetVersions
  );
  const retryStatusSet = new Set(options.retryStatuses);

  const missingRows = urls.filter((u) => u.license == null);
  const toProcess =
    options.limit == null ? missingRows : missingRows.slice(0, options.limit);

  console.log(
    `Processing ${toProcess.length} missing-license rows (from ${missingRows.length} total)`
  );
  const progressState = {
    mapped: 0,
    unresolved: 0,
    startedAt: Date.now(),
  };

  const results = await mapWithConcurrency(
    toProcess,
    options.concurrency,
    (row) => inspectListing(row, options, legitimateTargetMap, retryStatusSet),
    ({ completed, total, result }) => {
      if (result?.mapped) {
        progressState.mapped++;
      } else {
        progressState.unresolved++;
      }

      if (completed % options.progressEvery === 0 || completed === total) {
        const elapsedSec = Math.floor((Date.now() - progressState.startedAt) / 1000);
        const percent = ((completed / total) * 100).toFixed(1);
        console.log(
          `[progress] ${completed}/${total} (${percent}%) mapped=${progressState.mapped} unresolved=${progressState.unresolved} elapsed=${elapsedSec}s`
        );
      }
    }
  );

  const resultsById = new Map(results.map((r) => [r.url_id, r]));
  for (const row of urls) {
    const match = resultsById.get(row.url_id);
    if (match?.mapped?.bc_id != null) {
      row.license = match.mapped.bc_id;
    }
  }

  const countsByBcId = new Map();
  for (const row of urls) {
    if (Number.isInteger(row.license)) {
      countsByBcId.set(row.license, (countsByBcId.get(row.license) || 0) + 1);
    }
  }

  const cleanedLicenses = validLicenses.map((l) => ({
    name: l.name,
    url: l.url,
    bc_id: l.bc_id,
    count: countsByBcId.get(l.bc_id) || 0,
  }));

  const summary = summarize(results);
  const missingAfter = urls.filter((u) => u.license == null).length;

  const payload = {
    generated_at: new Date().toISOString(),
    options,
    dataset: {
      total_urls: urls.length,
      missing_before: missingRows.length,
      missing_after: missingAfter,
      valid_license_categories: validLicenses.length,
      legitimate_target_url_count: legitimateTargetMap.size,
    },
    summary,
    results,
  };

  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonReportPath = path.join(
    reportsDir,
    `fix-missing-licenses-exact-${stamp}.json`
  );
  const mdReportPath = path.join(
    reportsDir,
    `fix-missing-licenses-exact-${stamp}.md`
  );

  await Promise.all([
    fs.writeFile(jsonReportPath, JSON.stringify(payload, null, 2)),
    fs.writeFile(mdReportPath, toMarkdown(payload)),
  ]);

  if (options.write) {
    await Promise.all([
      fs.writeFile(urlsPath, JSON.stringify(urls, null, 2)),
      fs.writeFile(licensesPath, JSON.stringify(cleanedLicenses, null, 2)),
    ]);
  }

  console.log("");
  console.log(`Mapped: ${summary.mapped}/${summary.processed}`);
  console.log(`Unresolved: ${summary.unresolved}/${summary.processed}`);
  console.log(`Missing after run: ${missingAfter}`);
  console.log(
    `Report: ${path.relative(root, mdReportPath)} and ${path.relative(root, jsonReportPath)}`
  );
  if (!options.write) {
    console.log("Dry-run mode: no repository data files were modified.");
  }
}

main().catch((error) => {
  console.error("Fix script failed:");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
