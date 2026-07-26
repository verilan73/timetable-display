# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment workflow

```bash
clasp push --force   # push local files to Apps Script
clasp pull           # pull remote changes back (e.g. after editing in the script editor)
```

**Never run `clasp deploy`** — it resets the deployment configuration. New deployment versions must be created through the Apps Script UI: **Deploy → Manage deployments → Edit → New version → Deploy**.

After any `clasp pull`, check whether `Code.js` and `Code.gs` both exist. If so, remove `Code.gs` — clasp pulls as `.js` but an old `.gs` file causes a conflict on the next push.

There are no build steps or linting tools — this is a pure Apps Script / browser project. There is a Node test suite (see Testing below), but it's dev-only and never pushed to Apps Script.

## Architecture

The project is two files:

**`Code.js`** — Apps Script backend. Exposes six client-callable functions:
- `getTimetableData(schedule)` — parses the MSSS or JS XML from Drive and returns a structured object containing `periods`, `travellingGroups`, `grids`, `schemaType`, `weeksMode`, and `dayLabels`.
- `getTeacherData(forceRefresh)`, `getSubjectData(forceRefresh)`, `getRoomData(forceRefresh)` — build a merged/combined roster and per-entity schedules across both schools. All three go through the shared `getCachedTwoSchoolData()` wrapper (fingerprinted `CacheService` cache, 6-hour ceiling) and share `buildEntitySchedule()` for the actual card-scanning logic (see "Shared schedule-building helpers" below). `clearTeacherCache()`/`clearSubjectCache()`/`clearRoomCache()` are manual escape hatches — not required in normal use, since the cache already auto-invalidates on a fingerprint mismatch.
- `getClientConfig()` — returns client-safe config values from Script Properties (`logoUrl`, `logoAlt`). Only exposes values safe to send to the browser — no folder IDs or internal paths.

**`Index.html`** — A single-page frontend app with no framework dependencies. At startup, `init()` fires six `google.script.run` calls in parallel (`getTimetableData('MSSS')`, `getTimetableData('JS')`, `getTeacherData()`, `getSubjectData()`, `getRoomData()`, `getClientConfig()`), storing results in module-level state. All subsequent view switches (school, grade, week, semester, view) are instant client-side re-renders with no further server calls.

## Two schools, two XML schemas

The XML files have different structures and are parsed separately:

| School | File | Script Property | Schema |
|---|---|---|---|
| Middle / Senior School | `MSSS Schedule.xml` | `MSSS_FILENAME` | `detectSchema()` returns `'MSSS'` |
| Junior School | `JS Schedule.xml` | `JS_FILENAME` | `detectSchema()` returns `'JS'` |

`schemaType` flows through from the backend into every grid-rendering decision on the frontend. JS is single-week; MSSS is A/B week rotation. JS uses `Mon–Fri` day labels; MSSS uses `D1–D5`.

## Four views

The frontend has four modes toggled by the View tab bar:

- **Classes** (`renderGrid()`) — shows a week grid for a selected grade/group. MSSS grades 6–9 use the travelling-group system; grades 10–12 show whole-class views with elective splits as horizontal sub-slots. Rendering is table-based, entirely separate from the three timeline views below.
- **Teachers, Subjects, Rooms** (`renderTeacherTimeline()` / `renderSubjectTimeline()` / `renderRoomTimeline()`) — each shows a timeline for one selected entity across both schools. All three are thin wrappers around a shared `renderEntityTimeline(entityData, currentEntity, shapeBlock)`, which in turn calls the shared `buildTimelineSection()`/`buildPeriodStrip()` for the actual DOM building — these are completely generic and untouched by which entity type is being shown. Each wrapper supplies a `shapeBlock(block, source)` callback that maps its entity's native schedule-block shape into the `{subject, subjectShort, classNames, groupNames, roomShort, startMin, endMin, source}` shape the shared renderer expects; where a view's own identity would otherwise repeat redundantly on every block (the subject in Subject view, the room in Room view), that slot is repurposed to show the teacher's name instead — see the comments in each `render*Timeline()` function.
  - An entity present in both schools gets a split day column (left = JS, right = MSSS) so scheduling conflicts are immediately visible; a single-school entity gets a plain full-width column. Period reference strips are positioned by real clock time via pixel offsets.
  - Cross-school matching strategy differs by entity, driven by what's actually safe to match on:
    - **Teachers** (`buildTeacherData`): two-tier — email first (authoritative), normalised name as fallback for records missing an email.
    - **Subjects** (`buildSubjectData`): single-tier, case-insensitive exact name match. Safe because subject names are curated categorical labels (e.g. "Music"), not personal names — a match reliably means the same subject, unlike a coincidental name match between two different teachers.
    - **Rooms** (`buildRoomData`): no merge at all. Verified against the real exports that room names never overlap between the two schools, so every room belongs to exactly one school.
  - **Concurrent same-time lessons** (e.g. Advisory, where every homeroom meets at once under a different teacher) are grouped by `groupIntoStacks()` into a single clickable "N sessions" card rather than rendering fully overlapping, mutually-obscuring blocks. Clicking opens a modal (`showLessonStack()`/`closeLessonStack()`) listing every session in the stack. Only the timeline views need this — Classes view already splits simultaneous groups into side-by-side columns via its own density-tier system.
  - Case-insensitivity is a standing convention across all subject/name/label matching in this codebase (subject colours, teacher email matching, non-teaching period labels, the Advisory-specific layout check) — the two XML exports don't reliably agree on capitalisation, so any new lookup added here should default to case-insensitive too.

## Travelling group logic — critical invariant

`buildGrids()` determines whether a lesson appears in a given TG view using two flags:
- `matchesTg` — at least one of the lesson's group IDs is in this TG's group set
- `isShared` — none of the lesson's group IDs appear in `allTgGroupIds` (treated as whole-class)

`allTgGroupIds` must **only** contain group IDs from digit-clustered TGs (e.g. TG-1, TG-2, TG-3) — **not** from BY TGs. BY TGs include all groups in their class, including cross-class elective groups like Mus, The, Dan, Vis, MusVis. If BY groups were included in `allTgGroupIds`, those elective lessons would fail both checks (`matchesTg` false because they're not in a digit TG's set; `isShared` false because they're in `allTgGroupIds` via BY) and silently disappear from all digit TG views. The fix is the `.filter(tg => !tg.id.endsWith('-BY'))` guard in `buildGrids`.

When the grid-building code changes, always run `clearTimetableCache()` from the Apps Script editor — the grids are cached by XML file fingerprint and won't reflect code changes until the cache expires or is cleared.

## Shared schedule-building helpers

`buildTeacherSchedule`, `buildSubjectSchedule`, and `buildRoomSchedule` are all thin wrappers around one shared `buildEntitySchedule(source, matches, buildBlock)` — they previously duplicated the entire card-scanning loop and differed only in which lesson field to filter on and which fields to surface. `matches(lesson, card)` decides whether a card belongs to this entity; `buildBlock(lesson, card, period)` shapes it into the block object. Also shared: `weekEntriesFor(weeksMode)` (the Week A/B vs. single-week bit pairs), `cardMatchesWeekTerm(card, weekBit, termBit)` (the wildcard-aware bit comparison, `'11'` always matches), and `resolveRoomIds(lesson, card)` (a card's own room IDs override the lesson's default). If you need a fourth entity type, extend this trio rather than writing a new scanning loop.

## Frontend gotcha: view-independent actions must branch across all four views

Anything that reacts regardless of which view is currently showing (semester toggle, school-data-reload, etc.) must explicitly handle all four: `if (currentView === 'teachers') renderTeacherTimeline(); else if (currentView === 'subjects') renderSubjectTimeline(); else if (currentView === 'rooms') renderRoomTimeline(); else renderGrid();` — `setSemester()` originally only special-cased `'teachers'` and fell back to `renderGrid()` for everything else, so switching semester while viewing Subjects or Rooms silently showed the Classes grid instead. `setView()` already has the correct four-way branch to copy from. The `if (currentView === 'teachers') renderTeacherTimeline();` guards scattered through `on*DataLoaded()` handlers are a different, correctly-scoped case — each only decides whether *its own* entity type should re-render after a data reload, so they don't need the other three branches.

## Sticky header and legend are a coupled pair

`#controls` is `position: sticky; top: 0`. The Classes-view `#legend` sidebar is also sticky, and its `top` offset (currently `84px`) is hand-tuned to sit just below the header bar rather than underneath it — if `#controls`' height changes (more controls, wrapping to two lines, padding changes), re-check `#legend`'s `top` and `max-height` (`calc(100vh - 100px)`) still clear it.

## Testing

`npm test` (or `node --test test/*.test.js`) runs a Node test suite covering the pure-logic functions in both files — no dependencies, no build step, nothing pushed to Apps Script (`.claspignore` excludes `test/`).

Only functions with **zero dependency on an Apps Script or DOM service** are covered this way:
- `Code.js`: `buildGrids`, `detectTravellingGroups`, `detectJsClasses`, `buildTeacherSchedule`, `buildSubjectSchedule`, `buildRoomSchedule`, `weekEntriesFor`, `cardMatchesWeekTerm`, `gradeSortKey`, `inferJsGrade`
- `Index.html`: `subjectColour`, `formatTime`, `rowHeight`, `densityClass`, `isNonTeaching`

`buildTeacherData`/`buildSubjectData`/`buildRoomData` (the roster-merging layer above those schedule builders) and `getCachedTwoSchoolData`/`renderEntityTimeline`/`groupIntoStacks`/the lesson-stack modal aren't covered — the first three call `loadXmlFromDrive` (real `XmlService`/`DriveApp`), the rest are DOM-driven. Same reasoning as everything else in the "not practically unit-testable" list below.

`test/helpers/loadCode.js` and `loadFrontend.js` load `Code.js`/`Index.html`'s `<script>` block into a Node `vm` context — the exact same source, unmodified, no build step. Two things to know if you extend these tests:
- Top-level `const`/`let` in the loaded file aren't reachable as properties on the returned context (a `vm` quirk — only top-level `function`/`var` declarations attach). Functions still close over them correctly when called; you just can't reach in and read or set them from a test.
- Values returned from vm-loaded functions live in a separate realm, so `assert.deepEqual` fails on structurally-identical arrays/objects with "not reference-equal". Wrap results in `toPlain()` (from `loadCode.js`) first — a JSON round-trip into this realm's plain objects.

Everything else — `parsePeriods`/`parseSection`/`parseGroups`/`parseLessons`/`parseCards`/`detectSchema` (need real `XmlService`), `getConfig`/the cache functions/`loadXmlFromDrive` (need real Google services), and almost all of `Index.html`'s DOM-driven code (filtering, navigation, rendering) — isn't practically unit-testable this way. That's covered by manual `/dev` smoke-testing instead, not chased for full automation.

## Key data-flow invariants

- All deployment-specific values (`TIMETABLE_FOLDER_ID`, `MSSS_FILENAME`, `JS_FILENAME`, `FAVICON_URL`, `LOGO_URL`, `LOGO_ALT`) live in Script Properties, not in code. Run `setupConfig()` once from the editor to seed placeholders, then set real values under Project Settings → Script Properties. `getConfig()` reads them at runtime and throws a descriptive error if any required property is missing. Optional properties (`FAVICON_URL`, `LOGO_URL`, `LOGO_ALT`) default to blank/empty gracefully.
- XML files are never committed to this repo — update them in Drive directly.
- The favicon is set via `setFaviconUrl()` in `doGet()` using the `FAVICON_URL` script property. It must be a direct image URL (e.g. `drive.google.com/uc?export=download`). The `<link rel="icon">` approach does not work — Apps Script strips it from the HTML output. If `FAVICON_URL` is blank, no favicon is set.
- The school logo (`LOGO_URL`) is fetched at startup via `getClientConfig()` and applied dynamically — it is hidden until the URL is available. Both favicon and logo must use direct image URLs, not Drive viewer/thumbnail redirects.
- `appsscript.json` sets `executeAs: USER_DEPLOYING` and `access: DOMAIN` — the app runs as the deploying account and is restricted to the domain.
