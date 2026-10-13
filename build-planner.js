// Builds amy/, a fully separate copy of the app at its own link, with its own
// title, look (maroon "amy" skin), icons, storage key and its OWN copies of
// app.js and style.css, so changes to the main app never affect it.
// Only run this when you deliberately want to copy main-app changes into amy/:
//   node build-planner.js
const fs = require('fs');
const path = require('path');

const TITLE = "Amy's Budget";
const SHORT = "Amy's Budget";
const STORE_KEY = 'amyBudget.v1';
const SKIN = 'amy';
const MAROON = '#7a1f35';
// Paid a salary every fortnight, tax already taken out.
const DEFAULTS = { period: 'fortnight', taxWithheld: true, offering: false };
const dir = path.join(__dirname, 'amy');
fs.mkdirSync(dir, { recursive: true });

let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
html = html
  .replace('<html lang="en">', `<html lang="en" data-skin="${SKIN}">`)
  .replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
  .replace(/<meta name="theme-color"[^>]*>\s*<meta name="theme-color"[^>]*>/, `<meta name="theme-color" content="${MAROON}">`)
  .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, (_, a) => `${a}${SHORT}"`)
  .replace(/<h1>[^<]*<\/h1>/, `<h1>${TITLE} <span class="heart" aria-hidden="true">♥</span></h1>`)
  .replace('status-bar-style" content="default"', 'status-bar-style" content="black-translucent"')
  .replace('<script src="app.js"></script>',
    `<script>window.APP_CONFIG = { storeKey: '${STORE_KEY}', defaults: ${JSON.stringify(DEFAULTS)} };</script>\n  <script src="app.js"></script>`);
fs.writeFileSync(path.join(dir, 'index.html'), html);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
manifest.name = TITLE;
manifest.short_name = SHORT;
manifest.theme_color = MAROON;
manifest.background_color = '#fbf3f4';
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8').replace(/'weekly-budget-'/g, "'amy-budget-'");
fs.writeFileSync(path.join(dir, 'sw.js'), sw);

fs.copyFileSync(path.join(__dirname, 'app.js'), path.join(dir, 'app.js'));
fs.copyFileSync(path.join(__dirname, 'style.css'), path.join(dir, 'style.css'));

console.log('amy/ built');
