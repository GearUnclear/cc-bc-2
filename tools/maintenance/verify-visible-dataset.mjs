#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function normalizedStatus(rawStatus) {
  if (rawStatus === "active" || rawStatus === "dead" || rawStatus === "unverified") {
    return rawStatus;
  }
  return "active";
}

function isVisibleActiveRow(row, validLicenseIds) {
  return normalizedStatus(row.status) === "active" && validLicenseIds.has(row.license);
}

async function main() {
  const root = process.cwd();
  const urlsPath = path.join(root, "public", "urls.json");
  const tagsPath = path.join(root, "public", "tags.json");
  const licensesPath = path.join(root, "src", "data", "licenses.json");

  const [urlsRaw, tagsRaw, licensesRaw] = await Promise.all([
    fs.readFile(urlsPath, "utf8"),
    fs.readFile(tagsPath, "utf8"),
    fs.readFile(licensesPath, "utf8"),
  ]);

  const urls = JSON.parse(urlsRaw);
  const tags = JSON.parse(tagsRaw);
  const licenses = JSON.parse(licensesRaw);

  const validLicenseIds = new Set(
    licenses
      .map((license) => license?.bc_id)
      .filter((value) => Number.isInteger(value))
  );

  const invalidActiveRows = urls.filter((row) => {
    if (normalizedStatus(row.status) !== "active") {
      return false;
    }
    return !validLicenseIds.has(row.license);
  });

  const visibleRows = urls.filter((row) => isVisibleActiveRow(row, validLicenseIds));

  const licenseCounts = new Map();
  for (const row of visibleRows) {
    licenseCounts.set(row.license, (licenseCounts.get(row.license) || 0) + 1);
  }
  const licenseCountMismatches = [];
  for (const license of licenses) {
    const expected = licenseCounts.get(license.bc_id) || 0;
    if (license.count !== expected) {
      licenseCountMismatches.push({
        bc_id: license.bc_id,
        name: license.name,
        expected,
        actual: license.count,
      });
    }
  }

  const tagCounts = new Map();
  for (const row of visibleRows) {
    if (!Array.isArray(row.tags)) {
      continue;
    }
    for (const tagId of row.tags) {
      if (!Number.isInteger(tagId)) {
        continue;
      }
      tagCounts.set(tagId, (tagCounts.get(tagId) || 0) + 1);
    }
  }
  const tagCountMismatches = [];
  const tagIdSet = new Set();
  for (const tag of tags) {
    tagIdSet.add(tag.tag_id);
    const expected = tagCounts.get(tag.tag_id) || 0;
    if (tag.count !== expected) {
      tagCountMismatches.push({
        tag_id: tag.tag_id,
        name: tag.name,
        expected,
        actual: tag.count,
      });
    }
  }
  const unknownTagIds = [...tagCounts.keys()].filter((tagId) => !tagIdSet.has(tagId));

  const urlIdSet = new Set();
  const duplicateUrlIds = [];
  for (const row of urls) {
    if (urlIdSet.has(row.url_id)) {
      duplicateUrlIds.push(row.url_id);
      continue;
    }
    urlIdSet.add(row.url_id);
  }

  const failures = [];
  if (invalidActiveRows.length > 0) {
    failures.push(`Active rows with invalid/missing license: ${invalidActiveRows.length}`);
  }
  if (licenseCountMismatches.length > 0) {
    failures.push(`License count mismatches: ${licenseCountMismatches.length}`);
  }
  if (tagCountMismatches.length > 0) {
    failures.push(`Tag count mismatches: ${tagCountMismatches.length}`);
  }
  if (unknownTagIds.length > 0) {
    failures.push(`Unknown tag IDs found in visible URLs: ${unknownTagIds.length}`);
  }
  if (duplicateUrlIds.length > 0) {
    failures.push(`Duplicate url_id values: ${duplicateUrlIds.length}`);
  }

  console.log(`Total URL rows: ${urls.length}`);
  console.log(`Visible active rows: ${visibleRows.length}`);
  console.log(`Dead rows: ${urls.filter((row) => normalizedStatus(row.status) === "dead").length}`);
  console.log(
    `Unverified rows: ${urls.filter((row) => normalizedStatus(row.status) === "unverified").length}`
  );

  if (failures.length === 0) {
    console.log("Verification passed.");
    return;
  }

  console.error("Verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  if (invalidActiveRows.length > 0) {
    for (const row of invalidActiveRows.slice(0, 10)) {
      console.error(`  active-invalid: ${row.url_id} ${row.url}`);
    }
  }
  if (licenseCountMismatches.length > 0) {
    for (const mismatch of licenseCountMismatches.slice(0, 10)) {
      console.error(
        `  license-mismatch: ${mismatch.name} (${mismatch.bc_id}) expected=${mismatch.expected} actual=${mismatch.actual}`
      );
    }
  }
  if (tagCountMismatches.length > 0) {
    for (const mismatch of tagCountMismatches.slice(0, 10)) {
      console.error(
        `  tag-mismatch: ${mismatch.name} (${mismatch.tag_id}) expected=${mismatch.expected} actual=${mismatch.actual}`
      );
    }
  }
  if (unknownTagIds.length > 0) {
    console.error(`  unknown-tag-ids: ${unknownTagIds.slice(0, 20).join(", ")}`);
  }
  if (duplicateUrlIds.length > 0) {
    console.error(`  duplicate-url-ids: ${duplicateUrlIds.slice(0, 20).join(", ")}`);
  }

  process.exit(1);
}

main().catch((error) => {
  console.error("Verify visible dataset failed:");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
