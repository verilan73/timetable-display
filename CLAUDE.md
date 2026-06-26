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

**`Code.js`** — Apps Script backend. Exposes two client-callable functions:
- `getTimetableData(schedule)` — parses the MSSS or JS XML from Drive and returns a structured object containing `periods`, `travellingGroups`, `grids`, `schemaType`, `weeksMode`, and `dayLabels`.
- `getTeacherData(forceRefresh)` — builds a unified teacher schedule across both schools. Results are cached in `CacheService` for 6 hours (the Apps Script maximum). The `clearTeacherCache()` helper busts it.

**`Index.html`** — A single-page frontend app with no framework dependencies. At startup, `init()` fires three `google.script.run` calls in parallel (`getTimetableData('MSSS')`, `getTimetableData('JS')`, `getTeacherData()`), storing results in the module-level `allData` object. All subsequent view switches (school, grade, week, semester) are instant client-side re-renders with no further server calls.

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

## Key data-flow invariants

- `TIMETABLE_FOLDER_ID` in `Code.js` is the only place that identifies the Shared Drive folder. XML files are never committed to this repo — update them in Drive directly.
- The favicon is set via `setFaviconUrl()` in `doGet()` pointing to a public Drive file (`uc?export=download`). The `<link rel="icon">` approach does not work — Apps Script strips it from the HTML output.
- `appsscript.json` sets `executeAs: USER_DEPLOYING` and `access: DOMAIN` — the app runs as the deploying account and is restricted to the domain.
