# Free Music Finder

`wagenhoffer.dev`'s Free Music Finder for Creative Commons music discovery on Bandcamp.

Based on the original [handeyeco/cc-bc](https://github.com/handeyeco/cc-bc) dataset project.

## Run locally

1. Install Node.js 18+.
2. Start the app:

```bash
npm start
```

3. Open `http://localhost:4173`.

No Vite, no React build step. It is a plain static app (`index.html`, `app.js`, `styles.css`) served by `server.js`.

## Asset versioning

`npm start` and `npm run dev` automatically run:

```bash
npm run version-assets
```

This stamps hash-based `?v=` query params into `index.html` for `styles.css` and `app.js` so CDN/browser caches refresh immediately when assets change.

If you deploy by copying files directly (for example with `rsync` to `/var/www/...`), run `npm run version-assets` before syncing.

## Deploy to live

To sync this repo to `/var/www/music.wagenhoffer.dev`:

```bash
npm run deploy:live
```

Dry run (prints commands only):

```bash
npm run deploy:live:dry
```

Custom target path:

```bash
bash scripts/deploy-live.sh --target /var/www/your-site
```

The deploy script:
- runs `npm run version-assets` (unless `--skip-version-assets` is passed)
- syncs `index.html`, `app.js`, `styles.css`, and `public/`
- prints `urls.json` row/favorite counts after deploy
