#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  sampleSize: 30,
  concurrency: 4,
  timeoutMs: 15000,
  retries: 1,
  seed: 42,
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--sample-size" && next) {
      options.sampleSize = Number.parseInt(next, 10);
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
    if (arg === "--seed" && next) {
      options.seed = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.sampleSize) || options.sampleSize <= 0) {
    throw new Error("--sample-size must be a positive integer");
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
  if (!Number.isFinite(options.seed)) {
    throw new Error("--seed must be an integer");
  }

  return options;
}

function printHelp() {
  console.log(`Audit missing-license ("NaN") categories by sampling Bandcamp pages.

Usage:
  node scripts/audit-nan-license-categories.mjs [options]

Options:
  --sample-size <n>   URLs to check per NaN category (default: 30)
  --concurrency <n>   Parallel requests per category (default: 4)
  --timeout-ms <n>    HTTP timeout per request (default: 15000)
  --retries <n>       Retries per URL after the first attempt (default: 1)
  --seed <n>          Random seed for deterministic sampling (default: 42)
  --help              Show this message
`);
}

function createRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleRows(rows, size, rng) {
  if (rows.length <= size) {
    return [...rows];
  }

  const indices = rows.map((_, idx) => idx);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, size).map((idx) => rows[idx]);
}

function normalizeCcLicenseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("creativecommons.org")) {
      return null;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts[0] !== "licenses" || !pathParts[1]) {
      return null;
    }

    const slug = pathParts[1].toLowerCase();
    const version = pathParts[2] ? pathParts[2].toLowerCase() : null;
    const canonicalUrl = version
      ? `https://creativecommons.org/licenses/${slug}/${version}/`
      : `https://creativecommons.org/licenses/${slug}/`;

    return {
      slug,
      version,
      url: canonicalUrl,
    };
  } catch {
    return null;
  }
}

function extractCcLicenses(html) {
  const results = [];
  const seen = new Set();

  function add(rawUrl, source) {
    const normalized = normalizeCcLicenseUrl(rawUrl);
    if (!normalized) {
      return;
    }
    if (seen.has(normalized.url)) {
      return;
    }
    seen.add(normalized.url);
    results.push({
      ...normalized,
      source,
    });
  }

  const someRightsRegex =
    /<a\b[^>]*href=(["'])(https?:\/\/creativecommons\.org\/licenses\/[^"']+)\1[^>]*>\s*some rights reserved\s*<\/a>/gi;
  let match = null;
  while ((match = someRightsRegex.exec(html)) !== null) {
    add(match[2], "some-rights-link");
  }

  const genericCcRegex =
    /https?:\/\/creativecommons\.org\/licenses\/[a-z-]+\/[0-9.]+\/?/gi;
  while ((match = genericCcRegex.exec(html)) !== null) {
    add(match[0], "cc-link");
  }

  return results;
}

async function fetchText(url, timeoutMs) {
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
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectListing(listing, options, validLicenseBySlug) {
  const attempts = options.retries + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const fetched = await fetchText(listing.url, options.timeoutMs);
      const detectedLicenses = extractCcLicenses(fetched.text);
      const mapped = detectedLicenses.find((d) => validLicenseBySlug.has(d.slug));

      return {
        url_id: listing.url_id,
        title: listing.title,
        url: listing.url,
        status: fetched.status,
        final_url: fetched.finalUrl,
        error: null,
        detected_licenses: detectedLicenses,
        mapped_license: mapped
          ? {
              slug: mapped.slug,
              bc_id: validLicenseBySlug.get(mapped.slug).bc_id,
            }
          : null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    url_id: listing.url_id,
    title: listing.title,
    url: listing.url,
    status: null,
    final_url: null,
    error:
      lastError instanceof Error ? lastError.message : "Unknown fetch failure",
    detected_licenses: [],
    mapped_license: null,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex++;
      if (index >= items.length) {
        return;
      }
      output[index] = await mapper(items[index], index);
    }
  }

  const workers = [];
  const workerCount = Math.min(concurrency, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return output;
}

function buildCategorySummary(category, checks) {
  const mappedCounts = new Map();
  const detectedCounts = new Map();

  let fetchErrors = 0;
  let noLicenseDetected = 0;

  for (const check of checks) {
    if (check.error) {
      fetchErrors++;
    }

    if (check.detected_licenses.length === 0) {
      noLicenseDetected++;
    }

    for (const detected of check.detected_licenses) {
      detectedCounts.set(
        detected.slug,
        (detectedCounts.get(detected.slug) || 0) + 1
      );
    }

    if (check.mapped_license) {
      mappedCounts.set(
        check.mapped_license.slug,
        (mappedCounts.get(check.mapped_license.slug) || 0) + 1
      );
    }
  }

  const mappedList = [...mappedCounts.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count);

  const detectedList = [...detectedCounts.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count);

  const suggested = mappedList[0]
    ? {
        slug: mappedList[0].slug,
        hits: mappedList[0].count,
        sample_size: checks.length,
        confidence: Number((mappedList[0].count / checks.length).toFixed(4)),
      }
    : null;

  return {
    category_name: category.category_name,
    source_license_row: category.source_license_row,
    declared_count: category.declared_count,
    sampled_count: checks.length,
    fetch_errors: fetchErrors,
    no_license_detected: noLicenseDetected,
    mapped_to_known_count: mappedList.reduce((sum, e) => sum + e.count, 0),
    mapped_breakdown: mappedList,
    detected_breakdown: detectedList,
    suggested_mapping: suggested,
  };
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function buildMarkdownReport(payload) {
  const lines = [];
  lines.push("# NaN License Category Audit Report");
  lines.push("");
  lines.push(`Generated: ${payload.generated_at}`);
  lines.push("");
  lines.push("## Parameters");
  lines.push(`- Sample size per category: ${payload.options.sampleSize}`);
  lines.push(`- Concurrency: ${payload.options.concurrency}`);
  lines.push(`- Timeout (ms): ${payload.options.timeoutMs}`);
  lines.push(`- Retries: ${payload.options.retries}`);
  lines.push(`- Seed: ${payload.options.seed}`);
  lines.push("");
  lines.push("## Dataset Snapshot");
  lines.push(`- Total URLs: ${payload.dataset.total_urls}`);
  lines.push(
    `- URLs with missing license: ${payload.dataset.missing_license_urls}`
  );
  lines.push(
    `- NaN categories discovered in licenses file: ${payload.dataset.nan_category_count}`
  );
  lines.push(
    `- Sum of NaN category counts: ${payload.dataset.nan_category_total}`
  );
  lines.push("");

  for (const category of payload.categories) {
    lines.push(`## ${category.summary.category_name}`);
    lines.push(
      `- Source row in \`src/data/licenses.json\`: ${category.summary.source_license_row}`
    );
    lines.push(`- Declared count: ${category.summary.declared_count}`);
    lines.push(`- Sampled: ${category.summary.sampled_count}`);
    lines.push(`- Fetch errors: ${category.summary.fetch_errors}`);
    lines.push(
      `- No CC license detected: ${category.summary.no_license_detected}`
    );
    lines.push(
      `- Mapped to known licenses: ${category.summary.mapped_to_known_count}`
    );

    if (category.summary.mapped_breakdown.length === 0) {
      lines.push("- Mapped breakdown: none");
    } else {
      lines.push("- Mapped breakdown:");
      for (const item of category.summary.mapped_breakdown) {
        lines.push(`  - ${item.slug}: ${item.count}`);
      }
    }

    if (category.summary.suggested_mapping) {
      lines.push(
        `- Suggested mapping: ${category.summary.suggested_mapping.slug} (${category.summary.suggested_mapping.hits}/${category.summary.suggested_mapping.sample_size}, ${formatPercent(category.summary.suggested_mapping.confidence)})`
      );
    } else {
      lines.push("- Suggested mapping: none");
    }

    const unresolved = category.checks.filter(
      (c) => c.error || c.detected_licenses.length === 0 || !c.mapped_license
    );
    if (unresolved.length === 0) {
      lines.push("- Unresolved samples: none");
    } else {
      lines.push("- Unresolved samples (first 5):");
      for (const sample of unresolved.slice(0, 5)) {
        const reason = sample.error
          ? `error: ${sample.error}`
          : sample.detected_licenses.length === 0
            ? "no CC link found"
            : "CC link not in known mapping";
        lines.push(`  - ${sample.url} (${reason})`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const urlsPath = path.join(repoRoot, "public", "urls.json");
  const licensesPath = path.join(repoRoot, "src", "data", "licenses.json");
  const reportDir = path.join(repoRoot, "reports");

  const [urlsRaw, licensesRaw] = await Promise.all([
    fs.readFile(urlsPath, "utf8"),
    fs.readFile(licensesPath, "utf8"),
  ]);

  const urls = JSON.parse(urlsRaw);
  const licenses = JSON.parse(licensesRaw);

  const validLicenses = licenses.filter(
    (l) => typeof l?.name === "string" && Number.isInteger(l?.bc_id)
  );
  const nanLicenseRows = licenses
    .map((row, index) => ({
      ...row,
      source_license_row: index + 1,
    }))
    .filter(
      (row) =>
        !(typeof row?.name === "string" && Number.isInteger(row?.bc_id)) &&
        Number.isInteger(row?.count) &&
        row.count > 0
    );

  const missingLicenseUrls = urls.filter((u) => u.license == null);
  const nanCategoryTotal = nanLicenseRows.reduce((sum, row) => sum + row.count, 0);

  if (nanLicenseRows.length === 0) {
    throw new Error("No NaN categories were found in src/data/licenses.json");
  }

  if (nanCategoryTotal > missingLicenseUrls.length) {
    throw new Error(
      `NaN category counts (${nanCategoryTotal}) exceed missing-license URL rows (${missingLicenseUrls.length})`
    );
  }

  const categories = [];
  let cursor = 0;
  for (let i = 0; i < nanLicenseRows.length; i++) {
    const row = nanLicenseRows[i];
    const start = cursor;
    const end = cursor + row.count;
    const listings = missingLicenseUrls.slice(start, end);
    cursor = end;

    categories.push({
      category_name: `nan_category_${i + 1}`,
      source_license_row: row.source_license_row,
      declared_count: row.count,
      listings,
    });
  }

  if (cursor < missingLicenseUrls.length) {
    categories.push({
      category_name: "nan_category_unassigned_tail",
      source_license_row: null,
      declared_count: missingLicenseUrls.length - cursor,
      listings: missingLicenseUrls.slice(cursor),
    });
  }

  const validLicenseBySlug = new Map(
    validLicenses.map((l) => [l.name.toLowerCase(), { bc_id: l.bc_id }])
  );

  const rng = createRng(options.seed);
  const auditedCategories = [];

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    const sample = sampleRows(category.listings, options.sampleSize, rng);

    console.log(
      `[${i + 1}/${categories.length}] ${category.category_name}: sampling ${sample.length}/${category.listings.length}`
    );

    const checks = await mapWithConcurrency(
      sample,
      options.concurrency,
      (listing) => inspectListing(listing, options, validLicenseBySlug)
    );

    const summary = buildCategorySummary(category, checks);
    auditedCategories.push({
      category_name: category.category_name,
      summary,
      checks,
    });
  }

  const payload = {
    generated_at: new Date().toISOString(),
    options,
    dataset: {
      total_urls: urls.length,
      missing_license_urls: missingLicenseUrls.length,
      nan_category_count: nanLicenseRows.length,
      nan_category_total: nanCategoryTotal,
    },
    categories: auditedCategories,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(reportDir, `nan-license-audit-${stamp}.json`);
  const mdPath = path.join(reportDir, `nan-license-audit-${stamp}.md`);

  await fs.mkdir(reportDir, { recursive: true });
  await Promise.all([
    fs.writeFile(jsonPath, JSON.stringify(payload, null, 2)),
    fs.writeFile(mdPath, buildMarkdownReport(payload)),
  ]);

  console.log(`\nReport written:`);
  console.log(`- ${path.relative(repoRoot, mdPath)}`);
  console.log(`- ${path.relative(repoRoot, jsonPath)}`);
}

main().catch((error) => {
  console.error("Audit failed:");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
