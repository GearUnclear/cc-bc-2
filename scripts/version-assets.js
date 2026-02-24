const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const indexPath = path.join(rootDir, "index.html");

function hashFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
}

function updateAssetVersion(html, assetName, version) {
  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}(?:\\?v=[^"]*)?`, "g");
  return html.replace(pattern, `${assetName}?v=${version}`);
}

function main() {
  const assetFiles = {
    "styles.css": hashFile(path.join(rootDir, "styles.css")),
    "app.js": hashFile(path.join(rootDir, "app.js")),
  };

  const current = fs.readFileSync(indexPath, "utf8");
  let next = current;

  next = updateAssetVersion(next, "styles.css", assetFiles["styles.css"]);
  next = updateAssetVersion(next, "app.js", assetFiles["app.js"]);

  if (next !== current) {
    fs.writeFileSync(indexPath, next, "utf8");
    console.log("Updated index.html asset versions:");
  } else {
    console.log("index.html asset versions already up to date:");
  }

  console.log(`styles.css?v=${assetFiles["styles.css"]}`);
  console.log(`app.js?v=${assetFiles["app.js"]}`);
}

main();
