#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  write: false,
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Reconcile URL health/status from accelerated reports.

Usage:
  node scripts/reconcile-url-health-from-reports.mjs [options]

Options:
  --write   Persist updates to public/urls.json
  --help    Show this message
`);
}

function normalizedStatus(rawStatus) {
  if (rawStatus === "active" || rawStatus === "dead" || rawStatus === "unverified") {
    return rawStatus;
  }
  return "active";
}

function summarizeStatuses(rows) {
  const summary = {
    active: 0,
    dead: 0,
    unverified: 0,
  };
  for (const row of rows) {
    summary[normalizedStatus(row.status)]++;
  }
  return summary;
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Reconcile URL Health From Reports");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Write mode: ${report.options.write ? "yes" : "no (dry-run)"}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push(`- Reports scanned: ${report.inputs.report_count}`);
  lines.push(`- URL rows: ${report.inputs.url_rows}`);
  lines.push("");
  lines.push("## Changes");
  lines.push(`- Rows touched: ${report.changes.rows_touched}`);
  lines.push(`- Status updates: ${report.changes.status_updates}`);
  lines.push(`- Alias URL rewrites: ${report.changes.alias_url_rewrites}`);
  lines.push(`- License updates: ${report.changes.license_updates}`);
  lines.push("");
  lines.push("## Final Status Counts");
  lines.push(`- active: ${report.final_status_counts.active}`);
  lines.push(`- dead: ${report.final_status_counts.dead}`);
  lines.push(`- unverified: ${report.final_status_counts.unverified}`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const urlsPath = path.join(root, "public", "urls.json");
  const reportsDir = path.join(root, "reports");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const generatedAt = new Date().toISOString();

  const [urlsRaw, reportFiles] = await Promise.all([
    fs.readFile(urlsPath, "utf8"),
    fs.readdir(reportsDir),
  ]);
  const urls = JSON.parse(urlsRaw);

  const acceleratedReportFiles = reportFiles
    .filter((file) => file.startsWith("fix-missing-licenses-accelerated-") && file.endsWith(".json"))
    .map((file) => path.join(reportsDir, file));

  if (acceleratedReportFiles.length === 0) {
    console.log("No accelerated reports found in reports/. Nothing to reconcile.");
    return;
  }

  const reports = [];
  for (const file of acceleratedReportFiles) {
    try {
      const payload = JSON.parse(await fs.readFile(file, "utf8"));
      reports.push({
        file,
        generated_at: payload?.generated_at || "1970-01-01T00:00:00.000Z",
        results: Array.isArray(payload?.results) ? payload.results : [],
      });
    } catch {
      // Ignore malformed report files.
    }
  }
  reports.sort((a, b) => a.generated_at.localeCompare(b.generated_at));

  const rowsById = new Map(urls.map((row) => [row.url_id, row]));
  const touchedIds = new Set();
  let statusUpdates = 0;
  let aliasUrlRewrites = 0;
  let licenseUpdates = 0;

  for (const report of reports) {
    for (const result of report.results) {
      const row = rowsById.get(result.url_id);
      if (!row) {
        continue;
      }

      touchedIds.add(row.url_id);
      row.health_checked_at = report.generated_at;

      if (result?.mapped?.bc_id != null && row.license !== result.mapped.bc_id) {
        row.license = result.mapped.bc_id;
        licenseUpdates++;
      }

      const beforeStatus = normalizedStatus(row.status);
      if (result?.mapped) {
        const source = result?.mapped?.source || "mapped_unknown";
        const mappedViaAlias = source.startsWith("search_alias_");
        const confirmedDead = result?.status === 404 && !mappedViaAlias;

        if (mappedViaAlias && typeof result.alias_url === "string" && row.url !== result.alias_url) {
          row.url = result.alias_url;
          aliasUrlRewrites++;
        }

        if (confirmedDead || source.startsWith("wayback_")) {
          row.status = "dead";
          row.health_reason = "http_404";
        } else {
          row.status = "active";
          row.health_reason = source;
        }
      } else {
        if (result?.reason === "unresolved_status_404") {
          row.status = "dead";
          row.health_reason = "http_404";
        } else {
          row.status = "unverified";
          row.health_reason = result?.reason || "unresolved";
        }
      }

      if (beforeStatus !== normalizedStatus(row.status)) {
        statusUpdates++;
      }
    }
  }

  const report = {
    generated_at: generatedAt,
    options,
    inputs: {
      report_count: reports.length,
      url_rows: urls.length,
    },
    changes: {
      rows_touched: touchedIds.size,
      status_updates: statusUpdates,
      alias_url_rewrites: aliasUrlRewrites,
      license_updates: licenseUpdates,
    },
    final_status_counts: summarizeStatuses(urls),
  };

  const jsonPath = path.join(reportsDir, `reconcile-url-health-${stamp}.json`);
  const mdPath = path.join(reportsDir, `reconcile-url-health-${stamp}.md`);
  await Promise.all([
    fs.writeFile(jsonPath, JSON.stringify(report, null, 2)),
    fs.writeFile(mdPath, toMarkdown(report)),
  ]);

  if (options.write) {
    await fs.writeFile(urlsPath, JSON.stringify(urls, null, 2));
  }

  console.log(`Reports scanned: ${reports.length}`);
  console.log(`Rows touched: ${touchedIds.size}`);
  console.log(`Status updates: ${statusUpdates}`);
  console.log(`Alias URL rewrites: ${aliasUrlRewrites}`);
  console.log(`License updates: ${licenseUpdates}`);
  console.log(`Report: ${path.relative(root, mdPath)} and ${path.relative(root, jsonPath)}`);
  if (!options.write) {
    console.log("Dry-run mode: repository files were not modified.");
  }
}

main().catch((error) => {
  console.error("Reconcile URL health from reports failed:");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
