# KP Budget Planner

A simple weekly budget for someone paid weekly who sets aside their own tax and tithe. One screen to check each week, a savings tracker and settings.

**Private by design:** the app starts empty. Everything you type is saved only on your own device (in the browser's local storage). It has no accounts, no server, no analytics and makes no outside calls. Nothing you enter ever ends up in this repository.

## Install it on your phone

Open the app's link in your phone's browser and keep it open until it has fully loaded. Then:

**iPhone (Safari)**
1. Tap the **Share** button (the square with an arrow pointing up).
2. Scroll down and tap **Add to Home Screen**, then **Add**.
3. Open it from the new **Budget** icon. It works offline from then on.

> On iPhone, use Safari for this. The app's data belongs to the home-screen icon, so always open it from the icon, not from a Safari tab.

**Android (Chrome)**
1. Tap the **⋮** menu (top right).
2. Tap **Install app** (or **Add to Home screen**), then confirm.
3. Open it from the new **Budget** icon.

## First-time setup

1. Go to **Settings** and enter your tax set-aside %, tithe % (and whether it's on gross or after-tax pay) and whether the offering is on.
2. Add your fixed costs (weekly, fortnightly, monthly or yearly — they're converted to a weekly figure), your debts (with an optional "paid off by" date, after which they drop out of the budget) and your savings goals in priority order.

## Each week

- Type what **came in** for this week and next week.
- Each line shows its **Expected** amount, with an **Actual** box next to it: tax, tithe, offering, each fixed expense due that week, and living expenses. Fill in what actually went out. Blank boxes use the expected amount.
- **Available for savings** is the plan. **SAVED** is pay minus what actually went out.
- When the week is over, tap **Start new week**. It logs the week to history, pours its SAVED amount into your goals and moves next week into this week.
- Move tax and tithe out the day pay lands.

### Bills, debts and living expenses

Each fixed cost is either a **Bill** (fixed expense) or **Living** (part of your day-to-day allowance). Weekly bills and debt repayments are listed every week. A fortnightly, monthly or yearly bill with a **Comes out on** date is only listed in the week it's due, at the full amount. Without a date, its weekly share is set aside every week instead.

### How savings are allocated

Each logged week's SAVED amount fills the goals from the top down. A goal has to reach its target (or its floor, if it has a stretch amount) before the next goal gets anything. Once every goal has reached its target, extra money tops up stretch amounts in the same order. If a week's SAVED is negative, it's taken back from the lowest goal first. A trip goal can be marked **spent**: its balance drops to zero on that date and any shortfall is shown. Editing or deleting a history row recalculates everything.

Monthly amounts are converted as amount × 12 ÷ 52 per week, yearly as ÷ 52 and fortnightly as ÷ 2.

## Back up and restore your data

Your data lives only on the phone, so if you delete the app, clear your browser data or change phones, it's gone unless you've backed it up.

**Back up:** Settings → **Export**. On iPhone, the share sheet opens: choose **Save to Files** (iCloud Drive is a good place). On Android, the file saves to Downloads. Settings shows when you last exported.

**Restore or move to a new phone:** install the app on the new phone, then go to Settings → **Import** and pick the backup `.json` file. This replaces everything on that device with the backup.

**Start again:** Settings → **Clear all data** (you'll be asked to type CLEAR to confirm).

## Tech

Plain HTML, CSS and JavaScript (`index.html`, `style.css`, `app.js`). There's no build step. A service worker (`sw.js`) caches the files so the app works offline. After changing any file, bump `VERSION` in `sw.js` so installed copies pick up the update. Hosted on GitHub Pages straight from the `main` branch.

## Amy's copy

`amy/` is the same app at its own link (`/amy/`) with its own title, a maroon look (the `amy` skin in `style.css`), its own icons and its own storage, so a second person can use it with completely separate data. It reuses `app.js` and `style.css`. After changing `index.html`, `manifest.json` or `sw.js`, run `node build-planner.js` to rebuild it.
