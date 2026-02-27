#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_SOURCE =
  "https://raw.githubusercontent.com/handeyeco/cc-bc/refs/heads/main/public/urls.json";
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "public", "urls.json");
const DEFAULT_FAVORITES = path.join(ROOT_DIR, "config", "favorites.bc_ids.json");

function usage() {
  console.log(`Sync public/urls.json from upstream and apply local favorites overlay.

Usage:
  node scripts/sync-upstream-urls.js [options]

Options:
  --source VALUE     Upstream URL or local JSON path.
                     Default: ${DEFAULT_SOURCE}
  --out PATH         Output JSON path.
                     Default: ${DEFAULT_OUTPUT}
  --favorites PATH   Favorites config path.
                     Default: ${DEFAULT_FAVORITES}
  --check            Do not write files; exit non-zero if output would change.
  -h, --help         Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    out: DEFAULT_OUTPUT,
    favorites: DEFAULT_FAVORITES,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--source") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --source");
      options.source = value;
      index += 1;
      continue;
    }

    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --out");
      options.out = value;
      index += 1;
      continue;
    }

    if (arg === "--favorites") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --favorites");
      options.favorites = value;
      index += 1;
      continue;
    }

    if (arg === "--check") {
      options.check = true;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function isHttpSource(value) {
  return /^https?:\/\//i.test(value);
}

function resolvePath(value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
}

async function loadSourceText(source) {
  if (isHttpSource(source)) {
    let response;
    try {
      response = await fetch(source, { cache: "no-store" });
    } catch (error) {
      throw new Error(
        `Failed to download upstream urls.json from ${source}: ${error.message}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to download upstream urls.json from ${source} (${response.status} ${response.statusText})`
      );
    }
    return await response.text();
  }

  const sourcePath = resolvePath(source);
  return fs.readFileSync(sourcePath, "utf8");
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${label}: ${error.message}`);
  }
}

function parseFavoriteIds(configPath) {
  const text = fs.readFileSync(configPath, "utf8");
  const config = parseJson(text, configPath);

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${configPath} must contain a JSON object`);
  }

  if (!Array.isArray(config.favorites_bc_ids)) {
    throw new Error(`${configPath} must contain an array field "favorites_bc_ids"`);
  }

  const invalid = [];
  const normalized = [];

  for (const value of config.favorites_bc_ids) {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      invalid.push(value);
      continue;
    }
    normalized.push(numericValue);
  }

  if (invalid.length > 0) {
    throw new Error(
      `Invalid favorites_bc_ids values in ${configPath}: ${invalid
        .slice(0, 10)
        .map((value) => JSON.stringify(value))
        .join(", ")}`
    );
  }

  return Array.from(new Set(normalized));
}

function findDuplicateUrlIds(urls) {
  const seen = new Set();
  const duplicates = [];

  for (const row of urls) {
    const urlId = Number(row.url_id);
    if (!Number.isInteger(urlId) || urlId <= 0) {
      throw new Error(`Invalid url_id value found: ${JSON.stringify(row.url_id)}`);
    }

    if (seen.has(urlId)) {
      duplicates.push(urlId);
      continue;
    }

    seen.add(urlId);
  }

  return duplicates;
}

function applyFavorites(urls, favoriteIds) {
  const favoriteSet = new Set(favoriteIds);
  const presentBcIds = new Set();

  let favoritesCount = 0;

  for (const row of urls) {
    const bcId = Number(row.bc_id);
    if (Number.isInteger(bcId) && bcId > 0) {
      presentBcIds.add(bcId);
    }

    if (favoriteSet.has(bcId)) {
      row.favorite = true;
      favoritesCount += 1;
    } else {
      delete row.favorite;
    }
  }

  const missingFavoriteIds = favoriteIds.filter((bcId) => !presentBcIds.has(bcId));

  return {
    favoritesCount,
    missingFavoriteIds,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = resolvePath(options.out);
  const favoritesPath = resolvePath(options.favorites);

  const sourceText = await loadSourceText(options.source);
  const urls = parseJson(sourceText, options.source);
  if (!Array.isArray(urls)) {
    throw new Error("Upstream urls.json must be a JSON array");
  }

  const duplicateUrlIds = findDuplicateUrlIds(urls);
  if (duplicateUrlIds.length > 0) {
    throw new Error(
      `Duplicate url_id values found in source data (${duplicateUrlIds.length}). Examples: ${duplicateUrlIds
        .slice(0, 10)
        .join(", ")}`
    );
  }

  const favoriteIds = parseFavoriteIds(favoritesPath);
  const { favoritesCount, missingFavoriteIds } = applyFavorites(urls, favoriteIds);

  if (missingFavoriteIds.length > 0) {
    throw new Error(
      `Favorites overlay bc_id values not found in source data: ${missingFavoriteIds.join(
        ", "
      )}`
    );
  }

  const nextOutput = `${JSON.stringify(urls, null, 2)}\n`;

  if (options.check) {
    let currentOutput = null;
    try {
      currentOutput = fs.readFileSync(outputPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    if (currentOutput !== nextOutput) {
      throw new Error(
        `Output is out of sync at ${outputPath}. Run: npm run sync:urls`
      );
    }

    console.log("urls.json sync check passed.");
    console.log(
      `rows=${urls.length} favorites=${favoritesCount} overlay_bc_ids=${favoriteIds.length}`
    );
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, nextOutput, "utf8");

  console.log("Synced urls.json from upstream and applied favorites overlay.");
  console.log(`source=${options.source}`);
  console.log(`output=${outputPath}`);
  console.log(`favorites_file=${favoritesPath}`);
  console.log(
    `rows=${urls.length} favorites=${favoritesCount} overlay_bc_ids=${favoriteIds.length}`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
