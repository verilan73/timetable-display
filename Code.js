/**
 * @fileoverview Timetable Viewer — Google Apps Script backend.
 *
 * Reads aSc Timetables XML exports from a specific Google Drive folder and
 * returns structured schedule data to the browser for interactive display.
 * Supports two schemas:
 *   MSSS — Middle/Senior School: Week A/B rotation, grades 6–12, travelling groups.
 *   JS   — Junior School: single-week, Mon–Fri, grades JK–5, class-based selector.
 *
 * Setup:
 *  1. Run setupConfig() once from the Apps Script editor to seed Script Properties
 *     with placeholder values, then update them under Project Settings → Script Properties.
 *  2. Upload your timetable XMLs to the Drive folder identified by TIMETABLE_FOLDER_ID.
 *  3. Deploy > New deployment > Web app.
 *     Execute as: Me | Who has access: Anyone in your organisation.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Reads all deployment-specific config from Script Properties.
 * Throws a descriptive error if any required property is missing, so
 * misconfigured deployments fail loudly rather than silently misbehaving.
 *
 * Set values under Apps Script editor → Project Settings → Script Properties,
 * or run setupConfig() once to seed placeholder values you can then edit.
 *
 * @returns {{ folderId: string, msssFilename: string, jsFilename: string, faviconUrl: string }}
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const required = ['TIMETABLE_FOLDER_ID', 'MSSS_FILENAME', 'JS_FILENAME'];
  const missing = required.filter(k => !props.getProperty(k));
  if (missing.length) {
    throw new Error(
      `Missing Script Properties: ${missing.join(', ')}. ` +
      'Run setupConfig() to seed placeholders, then set real values in Project Settings → Script Properties.'
    );
  }
  return {
    folderId:     props.getProperty('TIMETABLE_FOLDER_ID'),
    msssFilename: props.getProperty('MSSS_FILENAME'),
    jsFilename:   props.getProperty('JS_FILENAME'),
    faviconUrl:   props.getProperty('FAVICON_URL') || '',
  };
}

/**
 * Seeds Script Properties with placeholder values so a new deployment has a
 * starting point to edit. Safe to re-run — only sets properties that are not
 * already present, so it will not overwrite real values.
 *
 * Run once from the Apps Script editor after cloning the project.
 */
function setupConfig() {
  const props = PropertiesService.getScriptProperties();
  const defaults = {
    TIMETABLE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID',
    MSSS_FILENAME:       'MSSS Schedule.xml',
    JS_FILENAME:         'JS Schedule.xml',
    FAVICON_URL:         '',
  };
  Object.entries(defaults).forEach(([k, v]) => {
    if (!props.getProperty(k)) props.setProperty(k, v);
  });
  Logger.log('Config seeded. Update values in Project Settings → Script Properties.');
}

/**
 * Grades (MSSS) that use the travelling-group system. Groups whose names start
 * with a digit are clustered by that leading digit.
 */
const TRAVELLING_GROUP_GRADES = [6, 7, 8, 9];

/**
 * Grades (MSSS) shown as whole-class views. Simultaneous elective groups appear
 * as horizontal splits, exactly as TG splits do.
 */
const CLASS_VIEW_GRADES = [10, 11, 12];

/** Maps a 5-bit day string from the XML to a day number (1–5). */
const DAY_FROM_BITS = {
  '10000': 1, '01000': 2, '00100': 3, '00010': 4, '00001': 5
};

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Serves the web app HTML when accessed via the deployment URL.
 * ALLOWALL is required for embedding in Google Sites.
 *
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet() {
  const { faviconUrl } = getConfig();
  const output = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Timetable Viewer')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  if (faviconUrl) output.setFaviconUrl(faviconUrl);
  return output;
}




// ── Client-callable function ──────────────────────────────────────────────────

/**
 * Returns all timetable data needed by the frontend.
 * Called from the browser via google.script.run.getTimetableData(schedule).
 *
 * @param {string} [schedule='MSSS']  'MSSS' for Middle/Senior School; 'JS' for Junior School.
 * @returns {{
 *   periods:          Array,
 *   travellingGroups: Array,
 *   grids:            Object,
 *   schemaType:       string,
 *   weeksMode:        string,
 *   dayLabels:        string[]
 * }}
 */
function getTimetableData(schedule) {
  const { msssFilename, jsFilename } = getConfig();
  const filename = (schedule === 'JS') ? jsFilename : msssFilename;
  const doc = loadXmlFromDrive(filename);
  return buildTimetableData(doc);
}

// ── XML loading ───────────────────────────────────────────────────────────────

/**
 * Finds and parses a named timetable XML from the designated Shared Drive folder.
 * If multiple copies share the filename, the most recently modified wins.
 *
 * @see https://developers.google.com/apps-script/reference/drive/drive-app#getFolderById(String)
 * @param {string} filename
 * @returns {GoogleAppsScript.XML_Service.Document}
 * @throws {Error} If the folder or file cannot be found.
 */
function loadXmlFromDrive(filename) {
  const { folderId } = getConfig();
  // getFolderById works with Shared Drives under the V8 runtime.
  const folder = DriveApp.getFolderById(folderId);
  const files  = folder.getFilesByName(filename);
  if (!files.hasNext()) {
    throw new Error(
      `"${filename}" was not found in the timetable folder (${folderId}). ` +
      'Upload the XML export to that folder and ensure the filename matches.'
    );
  }
  let best = files.next();
  while (files.hasNext()) {
    const candidate = files.next();
    if (candidate.getLastUpdated() > best.getLastUpdated()) best = candidate;
  }
  return XmlService.parse(best.getBlob().getDataAsString('UTF-8'));
}

// ── Data building ─────────────────────────────────────────────────────────────

/**
 * Orchestrates parsing of an XML document into the structure the frontend expects.
 * Schema type (MSSS vs JS) is detected automatically from the weeksdefs section.
 *
 * @param {GoogleAppsScript.XML_Service.Document} doc
 * @returns {Object}
 */
function buildTimetableData(doc) {
  const root = doc.getRootElement();

  const schemaType = detectSchema(root);
  // JS has a single Mon–Fri week; MSSS alternates between Week A and Week B.
  const weeksMode = schemaType === 'JS' ? 'single' : 'AB';
  const dayLabels = schemaType === 'JS'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    : ['D1',  'D2',  'D3',  'D4',  'D5'];

  const periods    = parsePeriods(root);
  const subjects   = parseSection(root, 'subjects',   'subject');
  const teachers   = parseSection(root, 'teachers',   'teacher');
  const classrooms = parseSection(root, 'classrooms', 'classroom');
  const classes    = parseSection(root, 'classes',    'class');
  const allGroups  = parseGroups(root);
  const lessons    = parseLessons(root);
  const cards      = parseCards(root);

  const travellingGroups = detectTravellingGroups(classes, allGroups, schemaType);
  const grids = buildGrids(
    travellingGroups, lessons, cards,
    subjects, teachers, classrooms, allGroups, periods, weeksMode
  );

  return { periods, travellingGroups, grids, schemaType, weeksMode, dayLabels };
}

// ── Schema detection ──────────────────────────────────────────────────────────

/**
 * Determines whether the XML uses the MSSS or JS schema.
 * MSSS uses a two-week bit-pair system ("10" = Week A, "01" = Week B).
 * JS has only one week definition with weeks="1".
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @returns {'MSSS'|'JS'}
 */
function detectSchema(root) {
  const weeksdefs = root.getChild('weeksdefs');
  if (!weeksdefs) return 'MSSS';
  const hasAB = weeksdefs.getChildren('weeksdef')
    .some(w => attrVal(w, 'weeks') === '10' || attrVal(w, 'weeks') === '01');
  return hasAB ? 'MSSS' : 'JS';
}

// ── Section parsers ───────────────────────────────────────────────────────────

/**
 * Parses the <periods> section and resolves each entry to real clock times.
 * Period names like "1." are normalised to "Period 1" for display.
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @returns {Array} Sorted array of {period, label, short, startMin, endMin, durationMin}
 */
function parsePeriods(root) {
  const result  = [];
  const section = root.getChild('periods');
  if (!section) return result;

  section.getChildren('period').forEach(p => {
    const rawLabel = attrVal(p, 'name');
    const label    = /^\d+\.$/.test(rawLabel)
      ? 'Period ' + rawLabel.replace('.', '')
      : rawLabel;

    const startMin = timeToMinutes(attrVal(p, 'starttime'));
    const endMin   = timeToMinutes(attrVal(p, 'endtime'));

    result.push({
      period:      parseInt(attrVal(p, 'period'), 10),
      label,
      short:       attrVal(p, 'short'),
      startMin,
      endMin,
      durationMin: endMin - startMin
    });
  });

  return result.sort((a, b) => a.period - b.period);
}

/**
 * Converts a "H:MM" time string to minutes from midnight.
 *
 * @param {string} timeStr  e.g. "8:15" or "13:30"
 * @returns {number}
 */
function timeToMinutes(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * Parses a named XML section into an object keyed by each element's id attribute.
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @param {string} sectionTag  e.g. 'subjects'
 * @param {string} childTag    e.g. 'subject'
 * @returns {Object} Map of id → {all attributes as key:value strings}
 */
function parseSection(root, sectionTag, childTag) {
  const result  = {};
  const section = root.getChild(sectionTag);
  if (!section) return result;
  section.getChildren(childTag).forEach(el => {
    const id = attrVal(el, 'id');
    if (!id) return;
    const attrs = {};
    el.getAttributes().forEach(a => { attrs[a.getName()] = a.getValue(); });
    result[id] = attrs;
  });
  return result;
}

/**
 * Parses the <groups> section.
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @returns {Object} Map of id → {name, classId, entireClass, divisionTag}
 */
function parseGroups(root) {
  const result  = {};
  const section = root.getChild('groups');
  if (!section) return result;
  section.getChildren('group').forEach(g => {
    const id = attrVal(g, 'id');
    if (!id) return;
    result[id] = {
      name:        attrVal(g, 'name'),
      classId:     attrVal(g, 'classid'),
      entireClass: attrVal(g, 'entireclass') === '1',
      divisionTag: parseInt(attrVal(g, 'divisiontag') || '0', 10)
    };
  });
  return result;
}

/**
 * Parses the <lessons> section.
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @returns {Object} Map of id → {subjectId, classIds, groupIds, teacherIds, classroomIds}
 */
function parseLessons(root) {
  const result  = {};
  const section = root.getChild('lessons');
  if (!section) return result;
  section.getChildren('lesson').forEach(l => {
    const id = attrVal(l, 'id');
    if (!id) return;
    result[id] = {
      subjectId:    attrVal(l, 'subjectid'),
      classIds:     splitIds(attrVal(l, 'classids')),
      groupIds:     splitIds(attrVal(l, 'groupids')),
      teacherIds:   splitIds(attrVal(l, 'teacherids')),
      classroomIds: splitIds(attrVal(l, 'classroomids'))
    };
  });
  return result;
}

/**
 * Parses the <cards> section into a flat array.
 * Each card is one scheduled instance of a lesson at a specific day/week/term/period.
 *
 * JS files use weeks="1" for the single week; this is normalised to "11" so the
 * same filtering logic works for both schemas without special-casing.
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @returns {Array}
 */
function parseCards(root) {
  const result  = [];
  const section = root.getChild('cards');
  if (!section) return result;
  section.getChildren('card').forEach(c => {
    const rawWeeks = attrVal(c, 'weeks');
    result.push({
      lessonId:     attrVal(c, 'lessonid'),
      period:       parseInt(attrVal(c, 'period') || '0', 10),
      days:         attrVal(c, 'days'),
      // "1" (JS single-week) → "11" (universal/both-weeks flag) so existing week
      // comparison logic handles it identically to a lesson in both MSSS weeks.
      weeks:        rawWeeks === '1' ? '11' : rawWeeks,
      terms:        attrVal(c, 'terms'),
      classroomIds: splitIds(attrVal(c, 'classroomids'))
    });
  });
  return result;
}

// ── Group / class detection ───────────────────────────────────────────────────

/**
 * Builds the list of selectable schedule units for the frontend dropdown.
 * Routes to the MSSS or JS detection logic based on schemaType.
 *
 * Each entry includes gradeLabel and gradeSortOrder so the frontend can group
 * entries correctly without parsing the grade value itself.
 *
 * @param {Object} classes     Map of classId → class attributes
 * @param {Object} allGroups   Map of groupId → group data
 * @param {string} schemaType  'MSSS' | 'JS'
 * @returns {Array}
 */
function detectTravellingGroups(classes, allGroups, schemaType) {
  if (schemaType === 'JS') return detectJsClasses(classes, allGroups);

  // MSSS: travelling groups for grades 6–9; whole-class view for 10–12.
  const result = [];

  Object.entries(classes).forEach(([classId, cls]) => {
    const grade = parseInt(cls.grade || '0', 10);

    const classGroupEntries = Object.entries(allGroups)
      .filter(([, g]) => g.classId === classId)
      .map(([id, g]) => ({ id, ...g }));

    const gradeLabel     = `Grade ${grade}`;
    const gradeSortOrder = grade;

    if (TRAVELLING_GROUP_GRADES.includes(grade)) {
      if (cls.short.includes('BY')) {
        result.push({
          id: `${cls.short}-BY`,
          label: `${grade}G-BY`,
          grade, gradeLabel, gradeSortOrder,
          classId, className: cls.name, classShort: cls.short,
          groupIds: classGroupEntries.map(g => g.id),
          viewType: 'tg'
        });
        return;
      }

      // Cluster groups by leading digit to form travelling groups.
      const numericGroups = classGroupEntries.filter(g => /^\d/.test(g.name));
      const byDigit = {};
      numericGroups.forEach(g => {
        const digit = g.name.charAt(0);
        if (!byDigit[digit]) byDigit[digit] = [];
        byDigit[digit].push(g);
      });

      Object.keys(byDigit).sort().forEach(digit => {
        result.push({
          id: `${cls.short}-${digit}`,
          label: `${grade}G-${digit}`,
          grade, gradeLabel, gradeSortOrder,
          classId, className: cls.name, classShort: cls.short,
          groupIds: byDigit[digit].map(g => g.id),
          viewType: 'tg'
        });
      });

    } else if (CLASS_VIEW_GRADES.includes(grade)) {
      result.push({
        id: `${cls.short}-CLASS`,
        label: cls.short,
        grade, gradeLabel, gradeSortOrder,
        classId, className: cls.name, classShort: cls.short,
        groupIds: classGroupEntries.map(g => g.id),
        viewType: 'class'
      });
    }
  });

  return result.sort((a, b) => {
    if (a.gradeSortOrder !== b.gradeSortOrder) return a.gradeSortOrder - b.gradeSortOrder;
    return a.label.localeCompare(b.label);
  });
}

/**
 * JS-specific class detection. Every class (JKP, G1DZ, G2AI, etc.) becomes one
 * selectable entry with viewType:'class'. Grade is inferred from the class short
 * name since the XML grade attribute is inconsistently populated for JS.
 *
 * PYP Meetings and other non-homeroom entries (no inferable grade) are skipped.
 *
 * @param {Object} classes
 * @param {Object} allGroups
 * @returns {Array}
 */
function detectJsClasses(classes, allGroups) {
  const result = [];

  Object.entries(classes).forEach(([classId, cls]) => {
    const grade = inferJsGrade(cls.short);
    if (!grade) return;

    const classGroupEntries = Object.entries(allGroups)
      .filter(([, g]) => g.classId === classId)
      .map(([id, g]) => ({ id, ...g }));

    const gradeSortOrder = gradeSortKey(grade);
    const gradeLabel     = grade === 'JK' ? 'Junior Kindergarten'
                         : grade === 'SK' ? 'Senior Kindergarten'
                         : `Grade ${grade}`;

    result.push({
      id: `${cls.short}-CLASS`,
      label: cls.short,
      grade, gradeLabel, gradeSortOrder,
      classId, className: cls.name, classShort: cls.short,
      groupIds: classGroupEntries.map(g => g.id),
      viewType: 'class'
    });
  });

  return result.sort((a, b) => {
    if (a.gradeSortOrder !== b.gradeSortOrder) return a.gradeSortOrder - b.gradeSortOrder;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Infers a JS grade string from a class short name.
 * Returns null for unrecognised class names (e.g. "PYP Meetings").
 *
 * @param {string} classShort  e.g. 'JKP', 'SKJH', 'G1DZ', 'G5CC'
 * @returns {string|null}      e.g. 'JK', 'SK', '1', '5', or null
 */
function inferJsGrade(classShort) {
  if (classShort.startsWith('JK')) return 'JK';
  if (classShort.startsWith('SK')) return 'SK';
  const m = classShort.match(/^G(\d+)/);
  if (m) return m[1];
  return null;
}

/**
 * Returns a numeric sort key for a JS grade string so that
 * JK < SK < Grade 1 < Grade 2 … < Grade 5 in the dropdown.
 *
 * @param {string} grade  e.g. 'JK', 'SK', '1', '5'
 * @returns {number}
 */
function gradeSortKey(grade) {
  if (grade === 'JK') return -2;
  if (grade === 'SK') return -1;
  return parseInt(grade) || 0;
}

// ── Grid builder ──────────────────────────────────────────────────────────────

/**
 * Builds pre-computed grid data for every schedule unit.
 *
 * Grid structure:
 *   grids[tgId][semester][week][day][xmlPeriodNum] = Array of slot objects
 *
 * For MSSS (weeksMode 'AB'):  week ∈ {'A', 'B'}
 * For JS   (weeksMode 'single'): week = 'single'
 *
 * Each slot: { subject, subjectShort, teacher, room, roomShort, subGroupNames }
 *
 * @param {Array}  travellingGroups  Output of detectTravellingGroups()
 * @param {Object} lessons
 * @param {Array}  cards
 * @param {Object} subjects
 * @param {Object} teachers
 * @param {Object} classrooms
 * @param {Object} allGroups
 * @param {Array}  periods           Output of parsePeriods()
 * @param {string} weeksMode         'AB' | 'single'
 * @returns {Object}
 */
function buildGrids(travellingGroups, lessons, cards, subjects, teachers, classrooms, allGroups, periods, weeksMode) {

  // For the 'AB' mode the weekBit is the actual MSSS bit-pattern; for 'single' we
  // use '11' (universal) which matches all cards after the normalisation in parseCards.
  const weekEntries = weeksMode === 'AB'
    ? [['A', '10'], ['B', '01']]
    : [['single', '11']];

  // Only TG-mode groups feed the shared-lesson detection set.
  // Class-view groups (MSSS 10–12 and all JS classes) are excluded so their
  // lessons aren't accidentally shown in grades 6–9 TG views.
  const allTgGroupIds = new Set(
    travellingGroups
      .filter(tg => tg.viewType === 'tg')
      .flatMap(tg => tg.groupIds)
  );

  const allPeriodNums = periods.map(p => p.period);
  const grids = {};

  travellingGroups.forEach(tg => {
    const tgGroupSet = new Set(tg.groupIds);
    grids[tg.id] = {};

    ['S1', 'S2'].forEach(semester => {
      const termBit = semester === 'S1' ? '10' : '01';
      grids[tg.id][semester] = {};

      weekEntries.forEach(([week, weekBit]) => {
        grids[tg.id][semester][week] = {};

        for (let day = 1; day <= 5; day++) {
          grids[tg.id][semester][week][day] = {};
          allPeriodNums.forEach(pNum => {
            grids[tg.id][semester][week][day][pNum] = [];
          });
        }

        cards.forEach(card => {
          // The weekBit for 'single' is '11'; after parseCards normalisation,
          // all JS cards also carry '11', so they always match.
          if (card.weeks !== weekBit && card.weeks !== '11') return;
          if (card.terms !== termBit && card.terms !== '11') return;

          const day = DAY_FROM_BITS[card.days];
          if (!day) return;
          if (!allPeriodNums.includes(card.period)) return;

          const lesson = lessons[card.lessonId];
          if (!lesson) return;
          if (!lesson.classIds.includes(tg.classId)) return;

          let include = false;
          let relevantGroupIds = [];

          if (tg.viewType === 'class') {
            include = true;
            relevantGroupIds = lesson.groupIds.filter(gId => tgGroupSet.has(gId));
          } else {
            const matchesTg = lesson.groupIds.some(gId => tgGroupSet.has(gId));
            const isShared  = !lesson.groupIds.some(gId => allTgGroupIds.has(gId));
            include = matchesTg || isShared;
            relevantGroupIds = matchesTg
              ? lesson.groupIds.filter(gId => tgGroupSet.has(gId))
              : lesson.groupIds;
          }

          if (!include) return;

          const subj = subjects[lesson.subjectId] || { name: 'Unknown', short: '?' };

          const teacher = lesson.teacherIds
            .map(id => (teachers[id] || {}).name || id).join(', ');

          const roomIds = card.classroomIds.length > 0
            ? card.classroomIds
            : lesson.classroomIds;
          const roomShort = roomIds.map(id => (classrooms[id] || {}).short || id).join(', ');
          const roomFull  = roomIds.map(id => (classrooms[id] || {}).name  || id).join(', ');

          // Suppress "Entire class" — adds no info when there is only one slot.
          const subGroupNames = relevantGroupIds
            .map(gId => allGroups[gId])
            .filter(g => g && !g.entireClass)
            .map(g => g.name);

          grids[tg.id][semester][week][day][card.period].push({
            subject:      subj.name,
            subjectShort: subj.short,
            teacher,
            room:         roomFull,
            roomShort,
            subGroupNames
          });
        });
      });
    });
  });

  return grids;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

/**
 * Returns the value of a named XML attribute, or an empty string if absent.
 *
 * @param {GoogleAppsScript.XML_Service.Element} el
 * @param {string} name
 * @returns {string}
 */
function attrVal(el, name) {
  const attr = el.getAttribute(name);
  return attr ? attr.getValue() : '';
}

/**
 * Splits a comma-separated ID string into an array, filtering empty entries.
 *
 * @param {string} str
 * @returns {string[]}
 */
function splitIds(str) {
  return str ? str.split(',').filter(Boolean) : [];
}

// ── Teacher view ──────────────────────────────────────────────────────────────

/**
 * CacheService key prefix and settings for teacher data.
 * CacheService is in-memory on Google's servers and shared across all users of
 * this script, which is exactly what we want for shared timetable data.
 * The per-key limit is 100 KB, so large payloads are split into chunks.
 */
const TEACHER_CACHE_KEY = 'timetable_teacher_v1';
const CACHE_CHUNK_SIZE  = 90000;  // 90 KB per chunk (leaves headroom under 100 KB limit)
const CACHE_TTL         = 21600;  // 6 hours — the maximum CacheService TTL

/**
 * Returns merged teacher roster and per-teacher schedules from both school XMLs.
 * Results are served from the script-level cache when available, so only the
 * first request (or a forced refresh) pays the full XML-parse cost.
 *
 * Teachers are matched across schools in two stages:
 *  1. Email match — exact, authoritative; use this once emails are populated.
 *  2. Normalised name match — fallback for teachers without email.
 *     Names are compared case-insensitively with collapsed whitespace so
 *     minor casing or spacing differences don't prevent a match.
 *     Note: two different people with identical names would incorrectly merge;
 *     the email key eliminates this risk once emails are filled in.
 *
 * @param {boolean} [forceRefresh=false]  Pass true to bypass the cache.
 * @returns {{teachers: Array, schedules: Object, msssPeriods: Array, jsPeriods: Array}}
 */
function getTeacherData(forceRefresh) {
  const cache = CacheService.getScriptCache();

  // ── Cache read ────────────────────────────────────────────────────────────
  if (!forceRefresh) {
    const metaJson = cache.get(TEACHER_CACHE_KEY + '_meta');
    if (metaJson) {
      try {
        const { chunkCount } = JSON.parse(metaJson);
        const parts = [];
        for (let i = 0; i < chunkCount; i++) {
          const part = cache.get(TEACHER_CACHE_KEY + '_' + i);
          if (!part) break;   // partial eviction — fall through to rebuild
          parts.push(part);
        }
        if (parts.length === chunkCount) {
          return JSON.parse(parts.join(''));
        }
      } catch (e) {
        // Corrupted cache entry — fall through to rebuild
      }
    }
  }

  // ── Cache miss — build from source XMLs ───────────────────────────────────
  const data = buildTeacherData();
  const json = JSON.stringify(data);

  const chunkCount = Math.ceil(json.length / CACHE_CHUNK_SIZE);
  for (let i = 0; i < chunkCount; i++) {
    cache.put(
      TEACHER_CACHE_KEY + '_' + i,
      json.slice(i * CACHE_CHUNK_SIZE, (i + 1) * CACHE_CHUNK_SIZE),
      CACHE_TTL
    );
  }
  cache.put(TEACHER_CACHE_KEY + '_meta', JSON.stringify({ chunkCount }), CACHE_TTL);

  return data;
}

/**
 * Clears the cached teacher data so the next getTeacherData() call rebuilds
 * from the source XMLs. Call this after uploading updated XML files.
 */
function clearTeacherCache() {
  const cache = CacheService.getScriptCache();
  cache.remove(TEACHER_CACHE_KEY + '_meta');
  for (let i = 0; i < 20; i++) cache.remove(TEACHER_CACHE_KEY + '_' + i);
}

/**
 * Builds the full teacher dataset by loading and parsing both XML files.
 * This is the slow path; results are cached by getTeacherData().
 *
 * @returns {{teachers: Array, schedules: Object, msssPeriods: Array, jsPeriods: Array}}
 */
function buildTeacherData() {
  const msssDoc = loadXmlFromDrive(XML_FILENAME);
  const jsDoc   = loadXmlFromDrive(JS_XML_FILENAME);

  const msss = parseScheduleSource(msssDoc);
  const js   = parseScheduleSource(jsDoc);

  // ── Two-level teacher merge ───────────────────────────────────────────────
  const byKey      = {};   // canonical key → teacher entry
  const keyByEmail = {};   // email → key (authoritative lookup)
  const keyByName  = {};   // normalisedName → key (fallback lookup)

  function normaliseName(name) {
    return (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  // Pass 1: register all MSSS teachers
  Object.entries(msss.teachers).forEach(([id, t]) => {
    const key = t.email ? `e:${t.email}` : `m:${id}`;
    byKey[key] = { name: t.name, email: t.email || '', msssId: id, jsId: null };
    if (t.email) keyByEmail[t.email] = key;
    keyByName[normaliseName(t.name)] = key;  // register all, not just no-email ones
  });

  // Pass 2: merge JS teachers — email match first, name match as fallback
  Object.entries(js.teachers).forEach(([id, t]) => {
    const norm = normaliseName(t.name);
    let key;

    if (t.email && keyByEmail[t.email]) {
      // Exact email match — most reliable
      key = keyByEmail[t.email];
    } else if (keyByName[norm]) {
      // Normalised name match — handles cases where one or both systems lack email
      key = keyByName[norm];
    } else {
      // No match found — create a new entry for this JS-only teacher
      key = t.email ? `e:${t.email}` : `j:${id}`;
      byKey[key] = { name: t.name, email: t.email || '', msssId: null, jsId: null };
    }

    byKey[key].jsId = id;
    if (t.email && !keyByEmail[t.email]) keyByEmail[t.email] = key;
    if (!keyByName[norm]) keyByName[norm] = key;
  });

  const teachers = Object.entries(byKey)
    .map(([key, t]) => ({ ...t, scheduleKey: key }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const schedules = {};
  teachers.forEach(t => {
    schedules[t.scheduleKey] = {
      msss: t.msssId ? buildTeacherSchedule(t.msssId, msss) : null,
      js:   t.jsId   ? buildTeacherSchedule(t.jsId,   js)   : null
    };
  });

  return { teachers, schedules, msssPeriods: msss.periods, jsPeriods: js.periods };
}

/**
 * Parses all schedule-relevant sections from one XML document, including the
 * weeksMode so callers know how to interpret the card week bit-fields.
 * Reuses the same individual parsers that the class/TG view uses.
 *
 * @param {GoogleAppsScript.XML_Service.Document} doc
 * @returns {Object}
 */
function parseScheduleSource(doc) {
  const root       = doc.getRootElement();
  const schemaType = detectSchema(root);
  return {
    teachers:   parseSection(root, 'teachers',   'teacher'),
    periods:    parsePeriods(root),
    subjects:   parseSection(root, 'subjects',   'subject'),
    classrooms: parseSection(root, 'classrooms', 'classroom'),
    classes:    parseSection(root, 'classes',    'class'),
    groups:     parseGroups(root),
    lessons:    parseLessons(root),
    cards:      parseCards(root),
    weeksMode:  schemaType === 'JS' ? 'single' : 'AB'
  };
}

/**
 * Builds a per-teacher schedule from a parsed source.
 * Returned structure: schedule[semester][week][day] = Array of lesson-block objects.
 * For a JS source, week is always 'single'; for MSSS it is 'A' or 'B'.
 *
 * Each lesson block contains the subject, class(es), group names, room, and the
 * real start/end times in minutes-from-midnight so the frontend can position
 * blocks accurately on the shared time axis.
 *
 * @param {string} teacherId
 * @param {Object} source    Output of parseScheduleSource()
 * @returns {Object}
 */
function buildTeacherSchedule(teacherId, source) {
  const weekEntries = source.weeksMode === 'AB'
    ? [['A', '10'], ['B', '01']]
    : [['single', '11']];

  const schedule = {};

  ['S1', 'S2'].forEach(semester => {
    const termBit = semester === 'S1' ? '10' : '01';
    schedule[semester] = {};

    weekEntries.forEach(([week, weekBit]) => {
      schedule[semester][week] = {};
      for (let day = 1; day <= 5; day++) schedule[semester][week][day] = [];

      source.cards.forEach(card => {
        if (card.weeks !== weekBit && card.weeks !== '11') return;
        if (card.terms !== termBit && card.terms !== '11') return;

        const day = DAY_FROM_BITS[card.days];
        if (!day) return;

        const lesson = source.lessons[card.lessonId];
        if (!lesson || !lesson.teacherIds.includes(teacherId)) return;

        const period = source.periods.find(p => p.period === card.period);
        if (!period) return;

        const subj = source.subjects[lesson.subjectId] || { name: 'Unknown', short: '?' };

        const classNames = lesson.classIds
          .map(id => (source.classes[id] || {}).short || id)
          .join(', ');

        const groupNames = lesson.groupIds
          .map(gId => source.groups[gId])
          .filter(g => g && !g.entireClass)
          .map(g => g.name);

        const roomIds = card.classroomIds.length > 0
          ? card.classroomIds : lesson.classroomIds;
        const roomShort = roomIds
          .map(id => (source.classrooms[id] || {}).short || id)
          .join(', ');

        schedule[semester][week][day].push({
          subjectShort: subj.short,
          subject:      subj.name,
          startMin:     period.startMin,
          endMin:       period.endMin,
          classNames,
          groupNames,
          roomShort
        });
      });
    });
  });

  return schedule;
}
