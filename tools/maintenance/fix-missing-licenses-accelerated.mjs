#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  write: false,
  concurrency: 12,
  timeoutMs: 15000,
  retries: 2,
  archiveRetries: 2,
  progressEvery: 25,
  useArchive: true,
  useSearchAlias: true,
  useDomainConsensus: true,
  domainMinKnown: 20,
  domainMinPurity: 1,
};

const LICENSE_NAME_TO_SLUG = {
  attribution_non_commercial_no_derivatives: "by-nc-nd",
  attribution_non_commercial_share_alike: "by-nc-sa",
  attribution_non_commercial: "by-nc",
  attribution_no_derivatives: "by-nd",
  attribution_share_alike: "by-sa",
  attribution: "by",
};

const RETRYABLE_HTTP_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

function printHelp() {
  console.log(`Accelerated missing-license fixer:
- Uses direct license_type/license_name extraction on live pages
- Falls back to Wayback for 404 pages
- Optionally applies strict domain-consensus fallback

Usage:
  node scripts/fix-missing-licenses-accelerated.mjs [options]

Options:
  --write                     Persist updates to public/urls.json and src/data/licenses.json
  --concurrency <n>           Parallel workers (default: 12)
  --timeout-ms <n>            Request timeout in milliseconds (default: 15000)
  --retries <n>               Retries for live page fetches (default: 2)
  --archive-retries <n>       Retries for archive API/snapshot fetches (default: 2)
  --progress-every <n>        Print progress every N rows (default: 25)
  --no-archive                Disable Wayback fallback
  --no-search-alias           Disable Bandcamp search alias fallback
  --no-domain-consensus       Disable domain-consensus fallback
  --domain-min-known <n>      Min known rows on domain for consensus (default: 20)
  --domain-min-purity <f>     Min top-license ratio for consensus (default: 1)
  --help                      Show this message
`);
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
    if (arg === "--archive-retries" && next) {
      options.archiveRetries = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--progress-every" && next) {
      options.progressEvery = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--no-archive") {
      options.useArchive = false;
      continue;
    }
    if (arg === "--no-search-alias") {
      options.useSearchAlias = false;
      continue;
    }
    if (arg === "--no-domain-consensus") {
      options.useDomainConsensus = false;
      continue;
    }
    if (arg === "--domain-min-known" && next) {
      options.domainMinKnown = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--domain-min-purity" && next) {
      options.domainMinPurity = Number.parseFloat(next);
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
  if (!Number.isFinite(options.archiveRetries) || options.archiveRetries < 0) {
    throw new Error("--archive-retries must be a non-negative integer");
  }
  if (!Number.isFinite(options.progressEvery) || options.progressEvery <= 0) {
    throw new Error("--progress-every must be a positive integer");
  }
  if (!Number.isFinite(options.domainMinKnown) || options.domainMinKnown < 1) {
    throw new Error("--domain-min-known must be >= 1");
  }
  if (
    !Number.isFinite(options.domainMinPurity) ||
    options.domainMinPurity <= 0 ||
    options.domainMinPurity > 1
  ) {
    throw new Error("--domain-min-purity must be in (0, 1]");
  }

  return options;
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function backoffMs(attempt, base = 600, cap = 8000) {
  return Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
}

function normalizeCcLicenseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase() !== "creativecommons.org") {
      return null;
    }
    const parts = parsed.pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);
    if (parts.length < 3 || parts[0] !== "licenses") {
      return null;
    }
    const slug = parts[1];
    const version = parts[2];
    return {
      slug,
      version,
      canonical: `https://creativecommons.org/licenses/${slug}/${version}/`,
    };
  } catch {
    return null;
  }
}

function extractLicenseTypeIds(html, validBcIds) {
  const out = new Set();
  const patterns = [/license_type&quot;:(\d+)/g, /"license_type":(\d+)/g];
  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(html)) !== null) {
      const value = Number.parseInt(match[1], 10);
      if (validBcIds.has(value)) {
        out.add(value);
      }
    }
  }
  return out;
}

function extractLicenseNameIds(html, slugToBcId) {
  const out = new Set();
  const patterns = [/license_name&quot;:&quot;([a-z_]+)&quot;/g, /"license_name":"([a-z_]+)"/g];

  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(html)) !== null) {
      const slug = LICENSE_NAME_TO_SLUG[match[1]];
      if (!slug) {
        continue;
      }
      const bcId = slugToBcId.get(slug);
      if (Number.isInteger(bcId)) {
        out.add(bcId);
      }
    }
  }

  return out;
}

function extractLicenseSectionIds(html, slugToBcId) {
  const out = new Set();
  const sectionRegex = /<div id="license"[^>]*>([\s\S]*?)<\/div>/gi;
  const urlRegex = /https?:\/\/creativecommons\.org\/licenses\/[a-z-]+\/[0-9.]+\/?/gi;

  let sectionMatch = null;
  while ((sectionMatch = sectionRegex.exec(html)) !== null) {
    const section = sectionMatch[1];
    let urlMatch = null;
    while ((urlMatch = urlRegex.exec(section)) !== null) {
      const normalized = normalizeCcLicenseUrl(urlMatch[0]);
      if (!normalized) {
        continue;
      }
      const bcId = slugToBcId.get(normalized.slug);
      if (Number.isInteger(bcId)) {
        out.add(bcId);
      }
    }
  }

  return out;
}

function decideMappedId({ typeIds, sectionIds, nameIds }) {
  if (typeIds.size === 1) {
    return {
      bcId: [...typeIds][0],
      source: "license_type",
    };
  }

  const all = new Set([...typeIds, ...sectionIds, ...nameIds]);
  if (all.size === 1) {
    return {
      bcId: [...all][0],
      source: "combined_single",
    };
  }

  if (sectionIds.size === 1) {
    return {
      bcId: [...sectionIds][0],
      source: "license_section",
    };
  }

  if (nameIds.size === 1) {
    return {
      bcId: [...nameIds][0],
      source: "license_name",
    };
  }

  return null;
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
      ok: true,
      status: response.status,
      finalUrl: response.url,
      text,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      text: null,
      error: error instanceof Error ? error.message : "Unknown fetch error",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetries(
  url,
  timeoutMs,
  retries,
  retryStatuses = RETRYABLE_HTTP_STATUSES
) {
  let last = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const fetched = await fetchText(url, timeoutMs);
    last = fetched;
    if (fetched.ok) {
      if (
        retryStatuses.has(fetched.status) &&
        attempt <= retries
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return fetched;
    }
    if (attempt <= retries) {
      await sleep(backoffMs(attempt));
    }
  }
  return last;
}

function parseWaybackAvailable(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const closest = payload?.archived_snapshots?.closest;
  if (!closest || closest.available !== true || typeof closest.url !== "string") {
    return null;
  }
  return closest.url;
}

async function findWaybackSnapshotUrl(url, options) {
  const availableUrl =
    "https://archive.org/wayback/available?url=" + encodeURIComponent(url);
  const fromAvailable = await fetchWithRetries(
    availableUrl,
    options.timeoutMs,
    options.archiveRetries
  );
  if (fromAvailable.ok && fromAvailable.status === 200 && fromAvailable.text) {
    try {
      const parsed = JSON.parse(fromAvailable.text);
      const snapshotUrl = parseWaybackAvailable(parsed);
      if (snapshotUrl) {
        return snapshotUrl;
      }
    } catch {
      // Ignore parse failures; fall through to CDX query.
    }
  }

  const cdxUrl =
    "https://web.archive.org/cdx/search/cdx?output=json&fl=timestamp,original,statuscode&mimetype=text/html&filter=statuscode:200&limit=1&url=" +
    encodeURIComponent(url);
  const cdx = await fetchWithRetries(cdxUrl, options.timeoutMs, options.archiveRetries);
  if (!cdx.ok || cdx.status !== 200 || !cdx.text) {
    return null;
  }

  try {
    const parsed = JSON.parse(cdx.text);
    if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[1])) {
      return null;
    }
    const [timestamp, original] = parsed[1];
    if (!timestamp || !original) {
      return null;
    }
    return `https://web.archive.org/web/${timestamp}/${original}`;
  } catch {
    return null;
  }
}

function hostnameOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizedStatus(rawStatus) {
  if (rawStatus === "active" || rawStatus === "dead" || rawStatus === "unverified") {
    return rawStatus;
  }
  return "active";
}

function isVisibleActiveRow(row, validBcIds) {
  return normalizedStatus(row.status) === "active" && validBcIds.has(row.license);
}

function slugOfAlbumUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || parts[0] !== "album") {
      return null;
    }
    return parts[1].toLowerCase();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractBandcampAlbumLinks(html) {
  const out = [];
  const seen = new Set();
  const regex = /href="(https:\/\/[^"]+bandcamp\.com\/album\/[^"?]+)[^"]*"/gi;

  let match = null;
  while ((match = regex.exec(html)) !== null) {
    const link = decodeHtmlEntities(match[1]);
    if (seen.has(link)) {
      continue;
    }
    seen.add(link);
    out.push(link);
  }

  return out;
}

async function findBandcampAliasAlbumUrl(originalUrl, options) {
  const host = hostnameOf(originalUrl);
  const slug = slugOfAlbumUrl(originalUrl);
  if (!host || !slug) {
    return null;
  }

  const hostStem = host.replace(/\.bandcamp\.com$/i, "");
  const queries = [`${hostStem} ${slug}`, `${hostStem} ${slug.replaceAll("-", " ")}`];
  if (/-\d+$/.test(slug)) {
    queries.push(
      `${hostStem} ${slug.replace(/-\d+$/, "").replaceAll("-", " ")}`
    );
  }

  const candidates = new Set();
  for (const query of queries) {
    const searchUrl = `https://bandcamp.com/search?q=${encodeURIComponent(query)}`;
    const searched = await fetchWithRetries(searchUrl, options.timeoutMs, options.retries);
    if (!searched.ok || !searched.text) {
      continue;
    }

    const links = extractBandcampAlbumLinks(searched.text);
    for (const link of links) {
      if (slugOfAlbumUrl(link) === slug) {
        candidates.add(link);
      }
    }

    if (candidates.size > 1) {
      return null;
    }
    if (candidates.size === 1) {
      break;
    }
  }

  if (candidates.size !== 1) {
    return null;
  }

  const aliasUrl = [...candidates][0];
  return aliasUrl === originalUrl ? null : aliasUrl;
}

function buildDomainConsensus(urls) {
  const bucket = new Map();

  for (const row of urls) {
    if (!Number.isInteger(row.license)) {
      continue;
    }
    const host = hostnameOf(row.url);
    if (!host) {
      continue;
    }
    let counts = bucket.get(host);
    if (!counts) {
      counts = new Map();
      bucket.set(host, counts);
    }
    counts.set(row.license, (counts.get(row.license) || 0) + 1);
  }

  const summary = new Map();
  for (const [host, counts] of bucket.entries()) {
    let total = 0;
    let topBcId = null;
    let topCount = 0;
    for (const [bcId, count] of counts.entries()) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topBcId = bcId;
      }
    }
    summary.set(host, {
      total,
      topBcId,
      topCount,
      purity: total > 0 ? topCount / total : 0,
    });
  }
  return summary;
}

async function mapWithConcurrency(items, concurrency, mapper, onProgress) {
  const output = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex++;
      if (index >= items.length) {
        return;
      }
      output[index] = await mapper(items[index], index);
      completed++;
      if (typeof onProgress === "function") {
        onProgress({
          completed,
          total: items.length,
          result: output[index],
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
  return output;
}

function summarize(results) {
  const out = {
    processed: results.length,
    mapped: 0,
    unresolved: 0,
    mappedBySource: {},
    unresolvedReasons: {},
  };

  for (const row of results) {
    if (row.mapped) {
      out.mapped++;
      out.mappedBySource[row.mapped.source] =
        (out.mappedBySource[row.mapped.source] || 0) + 1;
    } else {
      out.unresolved++;
      out.unresolvedReasons[row.reason] = (out.unresolvedReasons[row.reason] || 0) + 1;
    }
  }
  return out;
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Missing License Accelerated Fix Report");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Write mode: ${report.options.write ? "yes" : "no (dry-run)"}`);
  lines.push("");
  lines.push("## Totals");
  lines.push(`- Missing before: ${report.dataset.missing_before}`);
  lines.push(`- Processed: ${report.summary.processed}`);
  lines.push(`- Mapped: ${report.summary.mapped}`);
  lines.push(`- Unresolved: ${report.summary.unresolved}`);
  lines.push(`- Missing after: ${report.dataset.missing_after}`);
  lines.push(`- Visible active rows: ${report.dataset.visible_active}`);
  lines.push(`- Dead rows: ${report.dataset.dead}`);
  lines.push(`- Unverified rows: ${report.dataset.unverified}`);
  lines.push("");
  lines.push("## Mapped by Source");
  const sourceEntries = Object.entries(report.summary.mappedBySource).sort(
    (a, b) => b[1] - a[1]
  );
  if (sourceEntries.length === 0) {
    lines.push("- none");
  } else {
    for (const [source, count] of sourceEntries) {
      lines.push(`- ${source}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Unresolved Reasons");
  const reasonEntries = Object.entries(report.summary.unresolvedReasons).sort(
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
  return lines.join("\n");
}

async function inspectRow(row, context) {
  const {
    options,
    validBcIds,
    slugToBcId,
    domainConsensus,
    licenseById,
  } = context;

  const live = await fetchWithRetries(row.url, options.timeoutMs, options.retries);
  if (live.ok && live.text) {
    const typeIds = extractLicenseTypeIds(live.text, validBcIds);
    const sectionIds = extractLicenseSectionIds(live.text, slugToBcId);
    const nameIds = extractLicenseNameIds(live.text, slugToBcId);
    const mapped = decideMappedId({ typeIds, sectionIds, nameIds });

    if (mapped) {
      return {
        url_id: row.url_id,
        url: row.url,
        title: row.title,
        status: live.status,
        final_url: live.finalUrl,
        archive_status: null,
        archive_url: null,
        alias_url: null,
        mapped: {
          bc_id: mapped.bcId,
          name: licenseById.get(mapped.bcId) ?? null,
          source: mapped.source,
        },
        reason: null,
      };
    }
  }

  if (options.useArchive && live.status === 404) {
    const snapshotUrl = await findWaybackSnapshotUrl(row.url, options);
    if (snapshotUrl) {
      const archived = await fetchWithRetries(
        snapshotUrl,
        options.timeoutMs,
        options.archiveRetries
      );
      if (archived.ok && archived.text) {
        const typeIds = extractLicenseTypeIds(archived.text, validBcIds);
        const sectionIds = extractLicenseSectionIds(archived.text, slugToBcId);
        const nameIds = extractLicenseNameIds(archived.text, slugToBcId);
        const mapped = decideMappedId({ typeIds, sectionIds, nameIds });
        if (mapped) {
          return {
            url_id: row.url_id,
            url: row.url,
            title: row.title,
            status: live.status,
            final_url: live.finalUrl,
            archive_status: archived.status,
            archive_url: snapshotUrl,
            alias_url: null,
            mapped: {
              bc_id: mapped.bcId,
              name: licenseById.get(mapped.bcId) ?? null,
              source: `wayback_${mapped.source}`,
            },
            reason: null,
          };
        }
      }
    }
  }

  if (options.useSearchAlias && live.status === 404) {
    const aliasUrl = await findBandcampAliasAlbumUrl(row.url, options);
    if (aliasUrl) {
      const alias = await fetchWithRetries(aliasUrl, options.timeoutMs, options.retries);
      if (alias.ok && alias.text) {
        const typeIds = extractLicenseTypeIds(alias.text, validBcIds);
        const sectionIds = extractLicenseSectionIds(alias.text, slugToBcId);
        const nameIds = extractLicenseNameIds(alias.text, slugToBcId);
        const mapped = decideMappedId({ typeIds, sectionIds, nameIds });
        if (mapped) {
          return {
            url_id: row.url_id,
            url: row.url,
            title: row.title,
            status: live.status,
            final_url: live.finalUrl,
            archive_status: null,
            archive_url: null,
            alias_url: aliasUrl,
            mapped: {
              bc_id: mapped.bcId,
              name: licenseById.get(mapped.bcId) ?? null,
              source: `search_alias_${mapped.source}`,
            },
            reason: null,
          };
        }
      }
    }
  }

  if (options.useDomainConsensus) {
    const host = hostnameOf(row.url);
    const consensus = host ? domainConsensus.get(host) : null;
    if (
      consensus &&
      consensus.total >= options.domainMinKnown &&
      consensus.purity >= options.domainMinPurity &&
      Number.isInteger(consensus.topBcId)
    ) {
      return {
        url_id: row.url_id,
        url: row.url,
        title: row.title,
        status: live.status,
        final_url: live.finalUrl,
        archive_status: null,
        archive_url: null,
        alias_url: null,
        mapped: {
          bc_id: consensus.topBcId,
          name: licenseById.get(consensus.topBcId) ?? null,
          source: "domain_consensus",
        },
        reason: null,
      };
    }
  }

  return {
    url_id: row.url_id,
    url: row.url,
    title: row.title,
    status: live.status,
    final_url: live.finalUrl,
    archive_status: null,
    archive_url: null,
    alias_url: null,
    mapped: null,
    reason:
      live.ok && live.status != null
        ? `unresolved_status_${live.status}`
        : `fetch_error:${live.error ?? "unknown"}`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const runTimestamp = new Date().toISOString();
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
    (l) => Number.isInteger(l?.bc_id) && typeof l?.name === "string"
  );
  const validBcIds = new Set(validLicenses.map((l) => l.bc_id));
  const slugToBcId = new Map(validLicenses.map((l) => [l.name, l.bc_id]));
  const licenseById = new Map(validLicenses.map((l) => [l.bc_id, l.name]));
  const domainConsensus = buildDomainConsensus(urls);

  const missingRows = urls.filter((u) => u.license == null);
  console.log(`Processing ${missingRows.length} missing-license rows (accelerated)`);
  console.log(
    `Config: concurrency=${options.concurrency}, timeoutMs=${options.timeoutMs}, retries=${options.retries}, archive=${options.useArchive}, searchAlias=${options.useSearchAlias}, domainConsensus=${options.useDomainConsensus}`
  );

  const progress = {
    mapped: 0,
    unresolved: 0,
    startedAt: Date.now(),
  };

  const results = await mapWithConcurrency(
    missingRows,
    options.concurrency,
    (row) =>
      inspectRow(row, {
        options,
        validBcIds,
        slugToBcId,
        domainConsensus,
        licenseById,
      }),
    ({ completed, total, result }) => {
      if (result.mapped) {
        progress.mapped++;
      } else {
        progress.unresolved++;
      }

      if (completed % options.progressEvery === 0 || completed === total) {
        const elapsedSec = Math.floor((Date.now() - progress.startedAt) / 1000);
        const pct = ((completed / total) * 100).toFixed(1);
        console.log(
          `[progress] ${completed}/${total} (${pct}%) mapped=${progress.mapped} unresolved=${progress.unresolved} elapsed=${elapsedSec}s`
        );
      }
    }
  );

  const resultById = new Map(results.map((r) => [r.url_id, r]));
  for (const row of urls) {
    const match = resultById.get(row.url_id);
    if (!match) {
      continue;
    }

    row.health_checked_at = runTimestamp;
    if (match?.mapped?.bc_id != null) {
      row.license = match.mapped.bc_id;
    }

    if (match.mapped) {
      const source = match.mapped.source || "mapped_unknown";
      const mappedViaAlias = source.startsWith("search_alias_");
      const confirmedDead = match.status === 404 && !mappedViaAlias;

      if (mappedViaAlias && typeof match.alias_url === "string") {
        row.url = match.alias_url;
      }

      if (confirmedDead || source.startsWith("wayback_")) {
        row.status = "dead";
        row.health_reason = "http_404";
      } else {
        row.status = "active";
        row.health_reason = source;
      }
      continue;
    }

    if (match.reason === "unresolved_status_404") {
      row.status = "dead";
      row.health_reason = "http_404";
    } else {
      row.status = "unverified";
      row.health_reason = match.reason || "unresolved";
    }
  }

  const countsByBcId = new Map();
  for (const row of urls) {
    if (isVisibleActiveRow(row, validBcIds)) {
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
  const visibleActiveCount = urls.filter((row) =>
    isVisibleActiveRow(row, validBcIds)
  ).length;
  const deadCount = urls.filter((row) => normalizedStatus(row.status) === "dead").length;
  const unverifiedCount = urls.filter(
    (row) => normalizedStatus(row.status) === "unverified"
  ).length;
  const payload = {
    generated_at: runTimestamp,
    options,
    dataset: {
      total_urls: urls.length,
      missing_before: missingRows.length,
      missing_after: missingAfter,
      visible_active: visibleActiveCount,
      dead: deadCount,
      unverified: unverifiedCount,
    },
    summary,
    results,
  };

  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(reportsDir, `fix-missing-licenses-accelerated-${stamp}.json`);
  const mdPath = path.join(reportsDir, `fix-missing-licenses-accelerated-${stamp}.md`);
  await Promise.all([
    fs.writeFile(jsonPath, JSON.stringify(payload, null, 2)),
    fs.writeFile(mdPath, toMarkdown(payload)),
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
  console.log(`Report: ${path.relative(root, mdPath)} and ${path.relative(root, jsonPath)}`);
  if (!options.write) {
    console.log("Dry-run mode: repository files were not modified.");
  }
}

main().catch((error) => {
  console.error("Accelerated fixer failed:");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
