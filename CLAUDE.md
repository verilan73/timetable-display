# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment workflow

```bash
clasp push --force   # push local files to Apps Script
clasp pull           # pull remote changes back (e.g. after editing in the script editor)
```

**Never run `clasp deploy`** — it resets the deployment configuration. New deployment versions must be created through the Apps Script UI: **Deploy → Manage deployments → Edit → New version → Deploy**.

After any `clasp pull`, check whether `Code.js` and `Code.gs` both exist. If so, remove `Code.gs` — clasp pulls as `.js` but an old `.gs` file causes a conflict on the next push.

There are no build steps, linting tools, or tests — this is a pure Apps Script / browser project.

## Architecture

The project is two files:

**`Code.js`** — Apps Script backend. Exposes three client-callable functions:
- `getTimetableData(schedule)` — parses the MSSS or JS XML from Drive and returns a structured object containing `periods`, `travellingGroups`, `grids`, `schemaType`, `weeksMode`, and `dayLabels`.
- `getTeacherData(forceRefresh)` — builds a unified teacher schedule across both schools. Results are cached in `CacheService` for 6 hours (the Apps Script maximum). The `clearTeacherCache()` helper busts it.
- `getClientConfig()` — returns client-safe config values from Script Properties (`logoUrl`, `logoAlt`). Only exposes values safe to send to the browser — no folder IDs or internal paths.

**`Index.html`** — A single-page frontend app with no framework dependencies. At startup, `init()` fires four `google.script.run` calls in parallel (`getTimetableData('MSSS')`, `getTimetableData('JS')`, `getTeacherData()`, `getClientConfig()`), storing results in the module-level `allData` object. All subsequent view switches (school, grade, week, semester) are instant client-side re-renders with no further server calls.

## Two schools, two XML schemas

The XML files have different structures and are parsed separately:

| School | File | Constant | Schema |
|---|---|---|---|
| Middle / Senior School | `MSSS Schedule.xml` | `XML_FILENAME` | `detectSchema()` returns `'MSSS'` |
| Junior School | `JS Schedule.xml` | `JS_XML_FILENAME` | `detectSchema()` returns `'JS'` |

`schemaType` flows through from the backend into every grid-rendering decision on the frontend. JS is single-week; MSSS is A/B week rotation. JS uses `Mon–Fri` day labels; MSSS uses `D1–D5`.

## Class view vs teacher view

The frontend has two modes toggled by the tab bar:

- **Class view** (`renderGrid()`) — shows a week grid for a selected grade/group. MSSS grades 6–9 use the travelling-group system; grades 10–12 show whole-class views with elective splits as horizontal sub-slots.
- **Teacher view** (`renderTeacherTimeline()`) — shows a timeline for all staff across both schools. Teachers who appear in both XMLs get a split day column (left = MSSS, right = JS) so scheduling conflicts are immediately visible. Period reference strips are positioned by real clock time via pixel offsets.

## Travelling group logic — critical invariant

`buildGrids()` determines whether a lesson appears in a given TG view using two flags:
- `matchesTg` — at least one of the lesson's group IDs is in this TG's group set
- `isShared` — none of the lesson's group IDs appear in `allTgGroupIds` (treated as whole-class)

`allTgGroupIds` must **only** contain group IDs from digit-clustered TGs (e.g. TG-1, TG-2, TG-3) — **not** from BY TGs. BY TGs include all groups in their class, including cross-class elective groups like Mus, The, Dan, Vis, MusVis. If BY groups were included in `allTgGroupIds`, those elective lessons would fail both checks (`matchesTg` false because they're not in a digit TG's set; `isShared` false because they're in `allTgGroupIds` via BY) and silently disappear from all digit TG views. The fix is the `.filter(tg => !tg.id.endsWith('-BY'))` guard in `buildGrids`.

When the grid-building code changes, always run `clearTimetableCache()` from the Apps Script editor — the grids are cached by XML file fingerprint and won't reflect code changes until the cache expires or is cleared.

## Key data-flow invariants

- All deployment-specific values (`TIMETABLE_FOLDER_ID`, `MSSS_FILENAME`, `JS_FILENAME`, `FAVICON_URL`, `LOGO_URL`, `LOGO_ALT`) live in Script Properties, not in code. Run `setupConfig()` once from the editor to seed placeholders, then set real values under Project Settings → Script Properties. `getConfig()` reads them at runtime and throws a descriptive error if any required property is missing. Optional properties (`FAVICON_URL`, `LOGO_URL`, `LOGO_ALT`) default to blank/empty gracefully.
- XML files are never committed to this repo — update them in Drive directly.
- The favicon is set via `setFaviconUrl()` in `doGet()` using the `FAVICON_URL` script property. It must be a direct image URL (e.g. `drive.google.com/uc?export=download`). The `<link rel="icon">` approach does not work — Apps Script strips it from the HTML output. If `FAVICON_URL` is blank, no favicon is set.
- The school logo (`LOGO_URL`) is fetched at startup via `getClientConfig()` and applied dynamically — it is hidden until the URL is available. Both favicon and logo must use direct image URLs, not Drive viewer/thumbnail redirects.
- `appsscript.json` sets `executeAs: USER_DEPLOYING` and `access: DOMAIN` — the app runs as the deploying account and is restricted to the domain.
