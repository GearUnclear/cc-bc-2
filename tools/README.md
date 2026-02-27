# Tools

Helper scripts and utilities for managing the Free Music Finder dataset and deployment.

## Directory Structure

### `data/`
Scripts for syncing and validating the URLs dataset with upstream.

- **sync-upstream-urls.js** - Download upstream `urls.json` and apply local favorites overlay by matching `bc_id` values. Preserves favorites across dataset updates.
  ```bash
  npm run sync:urls              # Sync and write public/urls.json
  npm run sync:urls:check        # Verify sync without writing
  ```

- **check-urls-integrity.js** - Validate `public/urls.json` for data integrity.
  ```bash
  npm run check:urls
  ```

### `maintenance/`
Scripts for maintaining dataset health, fixing missing data, and verifying dataset integrity.

- **verify-visible-dataset.mjs** - Verify the integrity of the visible dataset.
- **audit-nan-license-categories.mjs** - Audit entries with missing/invalid license categories.
- **fix-missing-licenses-exact.mjs** - Attempt to fix missing licenses using exact matches.
- **fix-missing-licenses-accelerated.mjs** - Faster heuristic-based license fixing.
- **fix-missing-licenses-exhaustive.mjs** - Comprehensive license fixing with fallbacks.
- **reconcile-url-health-from-reports.mjs** - Reconcile URL availability from health reports.
- **run-fix-licenses-exhaustive.sh** - Orchestration script to run exhaustive license fixes.

## Workflow

Typical dataset maintenance workflow:

1. **Sync upstream dataset:**
   ```bash
   npm run sync:urls
   ```

2. **Check for issues:**
   ```bash
   npm run check:urls
   node tools/maintenance/verify-visible-dataset.mjs
   node tools/maintenance/audit-nan-license-categories.mjs
   ```

3. **Fix identified issues:**
   ```bash
   bash tools/maintenance/run-fix-licenses-exhaustive.sh
   ```

4. **Deploy:**
   ```bash
   npm run deploy:live
   ```
