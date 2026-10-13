// Builds planner/, a second copy of the app at its own link with its own
// title and its own storage key, sharing app.js, style.css and icons.
// Run after changing index.html or sw.js:  node build-planner.js
const fs = require('fs');
const path = require('path');

const TITLE = 'Budget Planner';
const SHORT = 'Budget';
const STORE_KEY = 'budgetPlanner.v1';
const dir = path.join(__dirname, 'planner');
fs.mkdirSync(dir, { recursive: true });

let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
html = html
  .replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
  .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, `$1${SHORT}"`)
  .replace(/<h1>[^<]*<\/h1>/, `<h1>${TITLE}</h1>`)
  .replace(/href="(style\.css|icons\/)/g, 'href="../$1')
  .replace('<script src="app.js"></script>',
    `<script>window.APP_CONFIG = { storeKey: '${STORE_KEY}' };</script>\n  <script src="../app.js"></script>`);
fs.writeFileSync(path.join(dir, 'index.html'), html);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
manifest.name = TITLE;
manifest.short_name = SHORT;
manifest.icons = manifest.icons.map(i => ({ ...i, src: '../' + i.src }));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

let sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
sw = sw
  .replace(/'weekly-budget-'/g, "'budget-planner-'")
  .replace(/'\.\/(style\.css|app\.js|icons\/[^']*)'/g, "'../$1'");
fs.writeFileSync(path.join(dir, 'sw.js'), sw);

console.log('planner/ built');
