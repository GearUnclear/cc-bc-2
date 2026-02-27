#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULTS = {
  maxPasses: 0,
  stopAfterNoProgressPasses: 3,
  concurrency: 2,
  timeoutMs: 20000,
  retries: 6,
  targetVersions: ["3.0", "4.0"],
  progressEvery: 250,
  sleepMs: 45000,
  retryStatuses: [403, 408, 425, 429, 500, 502, 503, 504],
  statusBackoffMs: 1000,
  statusBackoffMaxMs: 20000,
};

function parseStatusList(raw) {
  return [
    ...new Set(
      raw
        .split(",")
        .map((v) => Number.parseInt(v.trim(), 10))
        .filter((v) => Number.isInteger(v) && v >= 100 && v <= 599)
    ),
  ];
}

function printHelp() {
  console.log(`Run the exact-match fixer repeatedly until completion or stall.

Usage:
  node scripts/fix-missing-licenses-exhaustive.mjs [options]

Options:
  --max-passes <n>                 Maximum passes (0 = unlimited, default: 0)
  --stop-after-no-progress-passes <n> Stop when mapped=0 for N consecutive passes (default: 3)
  --concurrency <n>                Requests per pass (default: 2)
  --timeout-ms <n>                 Request timeout per listing (default: 20000)
  --retries <n>                    Retries per listing (default: 6)
  --target-versions <csv>          Target CC versions (default: 3.0,4.0)
  --progress-every <n>             Progress print interval within each pass (default: 250)
  --sleep-ms <n>                   Pause between passes in milliseconds (default: 45000)
  --retry-statuses <csv>           Retryable HTTP statuses (default: 403,408,425,429,500,502,503,504)
  --status-backoff-ms <n>          Initial retry backoff in milliseconds (default: 1000)
  --status-backoff-max-ms <n>      Max retry backoff in milliseconds (default: 20000)
  --help                           Show this message

Examples:
  node scripts/fix-missing-licenses-exhaustive.mjs
  node scripts/fix-missing-licenses-exhaustive.mjs --max-passes 10 --sleep-ms 60000
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--max-passes" && next) {
      options.maxPasses = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (arg === "--stop-after-no-progress-passes" && next) {
      options.stopAfterNoProgressPasses = Number.parseInt(next, 10);
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
    if (arg === "--sleep-ms" && next) {
      options.sleepMs = Number.parseInt(next, 10);
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

  if (!Number.isFinite(options.maxPasses) || options.maxPasses < 0) {
    throw new Error("--max-passes must be a non-negative integer");
  }
  if (
    !Number.isFinite(options.stopAfterNoProgressPasses) ||
    options.stopAfterNoProgressPasses < 0
  ) {
    throw new Error("--stop-after-no-progress-passes must be a non-negative integer");
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
  if (!Array.isArray(options.targetVersions) || options.targetVersions.length === 0) {
    throw new Error("--target-versions must include at least one version");
  }
  if (!Number.isFinite(options.progressEvery) || options.progressEvery <= 0) {
    throw new Error("--progress-every must be a positive integer");
  }
  if (!Number.isFinite(options.sleepMs) || options.sleepMs < 0) {
    throw new Error("--sleep-ms must be a non-negative integer");
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

async function runFixPass(root, options) {
  const args = [
    path.join(root, "scripts", "fix-missing-licenses-exact.mjs"),
    "--write",
    "--concurrency",
    String(options.concurrency),
    "--timeout-ms",
    String(options.timeoutMs),
    "--retries",
    String(options.retries),
    "--target-versions",
    options.targetVersions.join(","),
    "--progress-every",
    String(options.progressEvery),
    "--retry-statuses",
    options.retryStatuses.join(","),
    "--status-backoff-ms",
    String(options.statusBackoffMs),
    "--status-backoff-max-ms",
    String(options.statusBackoffMaxMs),
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`fix-missing-licenses-exact failed with exit code ${code}`));
    });
  });
}

async function latestFixReportPath(root) {
  const reportsDir = path.join(root, "reports");
  const files = await fs.readdir(reportsDir);
  const candidates = files
    .filter((f) => f.startsWith("fix-missing-licenses-exact-") && f.endsWith(".json"))
    .map((f) => path.join(reportsDir, f));

  if (candidates.length === 0) {
    throw new Error("No fix-missing-licenses-exact report found in reports/");
  }

  const withStats = await Promise.all(
    candidates.map(async (file) => ({
      file,
      stat: await fs.stat(file),
    }))
  );

  withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return withStats[0].file;
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function reasonCount(reasons, reason) {
  if (!reasons || typeof reasons !== "object") {
    return 0;
  }
  const value = reasons[reason];
  return Number.isInteger(value) ? value : 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();

  console.log("Starting exhaustive license fix loop");
  console.log(
    `Config: maxPasses=${options.maxPasses === 0 ? "unlimited" : options.maxPasses}, stopAfterNoProgressPasses=${options.stopAfterNoProgressPasses}, concurrency=${options.concurrency}, retries=${options.retries}, sleepMs=${options.sleepMs}`
  );

  let pass = 0;
  let consecutiveNoProgress = 0;

  while (true) {
    pass++;
    const startedAt = new Date();

    console.log("");
    console.log(`=== Pass ${pass} @ ${startedAt.toISOString()} ===`);

    await runFixPass(root, options);

    const reportPath = await latestFixReportPath(root);
    const report = await loadJson(reportPath);

    const missingBefore = report?.dataset?.missing_before ?? null;
    const missingAfter = report?.dataset?.missing_after ?? null;
    const mapped = report?.summary?.mapped ?? 0;
    const unresolved = report?.summary?.unresolved ?? 0;
    const reasons = report?.summary?.reasons ?? {};
    const rateLimited429 = reasonCount(reasons, "http_status_429");
    const noExact = reasonCount(reasons, "no_exact_legitimate_match");

    console.log(
      `[pass ${pass}] mapped=${mapped}, unresolved=${unresolved}, missing ${missingBefore} -> ${missingAfter}`
    );
    console.log(
      `[pass ${pass}] reasons: http_status_429=${rateLimited429}, no_exact_legitimate_match=${noExact}`
    );
    console.log(`[pass ${pass}] report: ${path.relative(root, reportPath)}`);

    if (mapped === 0) {
      consecutiveNoProgress++;
    } else {
      consecutiveNoProgress = 0;
    }

    if (missingAfter === 0) {
      console.log("All missing licenses were resolved.");
      break;
    }

    if (
      options.stopAfterNoProgressPasses > 0 &&
      consecutiveNoProgress >= options.stopAfterNoProgressPasses
    ) {
      console.log(
        `Stopping after ${consecutiveNoProgress} consecutive no-progress passes. Remaining rows likely need non-exact/manual logic.`
      );
      break;
    }

    if (options.maxPasses > 0 && pass >= options.maxPasses) {
      console.log(`Reached --max-passes=${options.maxPasses}. Stopping.`);
      break;
    }

    console.log(`Sleeping ${options.sleepMs}ms before next pass...`);
    await sleep(options.sleepMs);
  }
}

main().catch((error) => {
  console.error("Exhaustive fixer failed:");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
