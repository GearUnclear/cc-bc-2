#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const DEFAULT_URLS = path.join(ROOT_DIR, "public", "urls.json");
const DEFAULT_FAVORITES = path.join(ROOT_DIR, "config", "favorites.bc_ids.json");

function usage() {
  console.log(`Validate urls.json integrity against the favorites overlay.

Usage:
  node scripts/check-urls-integrity.js [options]

Options:
  --urls PATH        urls.json path.
                     Default: ${DEFAULT_URLS}
  --favorites PATH   Favorites config path.
                     Default: ${DEFAULT_FAVORITES}
  -h, --help         Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    urls: DEFAULT_URLS,
    favorites: DEFAULT_FAVORITES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--urls") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --urls");
      options.urls = value;
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

    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolvePath(value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const urlsPath = resolvePath(options.urls);
  const favoritesPath = resolvePath(options.favorites);

  const urlsText = fs.readFileSync(urlsPath, "utf8");
  const urls = parseJson(urlsText, urlsPath);
  if (!Array.isArray(urls)) {
    throw new Error(`${urlsPath} must contain a JSON array`);
  }

  const favoriteIds = parseFavoriteIds(favoritesPath);
  const favoriteSet = new Set(favoriteIds);
  const presentBcIds = new Set();

  const duplicateUrlIds = [];
  const invalidUrlIds = [];
  const unexpectedFavorites = [];

  const seenUrlIds = new Set();

  for (const row of urls) {
    const urlId = Number(row.url_id);
    if (!Number.isInteger(urlId) || urlId <= 0) {
      invalidUrlIds.push(row.url_id);
    } else if (seenUrlIds.has(urlId)) {
      duplicateUrlIds.push(urlId);
    } else {
      seenUrlIds.add(urlId);
    }

    const bcId = Number(row.bc_id);
    if (Number.isInteger(bcId) && bcId > 0) {
      presentBcIds.add(bcId);

      if (Boolean(row.favorite) && !favoriteSet.has(bcId)) {
        unexpectedFavorites.push({
          bc_id: bcId,
          url_id: row.url_id,
          url: row.url,
          title: row.title,
        });
      }
    } else if (Boolean(row.favorite)) {
      unexpectedFavorites.push({
        bc_id: row.bc_id,
        url_id: row.url_id,
        url: row.url,
        title: row.title,
      });
    }
  }

  const missingFavoriteIds = favoriteIds.filter((bcId) => !presentBcIds.has(bcId));

  const missingAppliedFavorites = favoriteIds.filter((bcId) => {
    return !urls.some(
      (row) => Number(row.bc_id) === bcId && Boolean(row.favorite) === true
    );
  });

  const favoriteRows = urls.filter((row) => Boolean(row.favorite));

  console.log(`rows=${urls.length}`);
  console.log(`favorite_rows=${favoriteRows.length}`);
  console.log(`overlay_bc_ids=${favoriteIds.length}`);

  const hasFailures =
    invalidUrlIds.length > 0 ||
    duplicateUrlIds.length > 0 ||
    missingFavoriteIds.length > 0 ||
    missingAppliedFavorites.length > 0 ||
    unexpectedFavorites.length > 0;

  if (!hasFailures) {
    console.log("Integrity check passed.");
    return;
  }

  if (invalidUrlIds.length > 0) {
    console.error(
      `Invalid url_id values: ${invalidUrlIds
        .slice(0, 10)
        .map((value) => JSON.stringify(value))
        .join(", ")}`
    );
  }

  if (duplicateUrlIds.length > 0) {
    console.error(
      `Duplicate url_id values: ${duplicateUrlIds.slice(0, 10).join(", ")}`
    );
  }

  if (missingFavoriteIds.length > 0) {
    console.error(
      `Overlay bc_id values missing from urls.json: ${missingFavoriteIds.join(", ")}`
    );
  }

  if (missingAppliedFavorites.length > 0) {
    console.error(
      `Overlay bc_id values not marked favorite in urls.json: ${missingAppliedFavorites.join(
        ", "
      )}`
    );
  }

  if (unexpectedFavorites.length > 0) {
    console.error(
      `Unexpected favorite rows not in overlay: ${unexpectedFavorites.length}`
    );
    for (const row of unexpectedFavorites.slice(0, 5)) {
      console.error(
        `  bc_id=${row.bc_id} url_id=${row.url_id} url=${row.url} title=${row.title}`
      );
    }
  }

  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
