/**
 * @fileoverview Timetable Travelling Group Viewer — Google Apps Script backend.
 *
 * Reads the aSc Timetables XML export from Google Drive and returns structured
 * schedule data to the browser for interactive display.
 *
 * Setup:
 *  1. Upload your timetable XML file to Google Drive (root or any accessible folder).
 *  2. Copy this file and Index.html into a new Apps Script project
 *     (script.google.com > New project).
 *  3. Deploy > New deployment > Web app.
 *     Execute as: Me | Who has access: Anyone in your organisation.
 *  4. Copy the deployment URL and embed it in Google Sites via Insert > Embed.
 */

/** Name of the XML file to locate in Google Drive. */
const XML_FILENAME = 'asctt2012.xml';

/**
 * Grades that use the travelling-group system. Groups in these grades whose
 * names start with a digit are auto-detected as travelling group sub-divisions.
 */
const TRAVELLING_GROUP_GRADES = [6, 7, 8, 9];

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Serves the web app HTML when accessed via the deployment URL.
 * The ALLOWALL frame option is required for embedding in Google Sites.
 *
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Timetable Viewer')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Client-callable function ──────────────────────────────────────────────────

/**
 * Returns all timetable data needed by the frontend.
 * Called from the browser via google.script.run.withSuccessHandler(fn).getTimetableData().
 *
 * The returned object contains:
 *  - travellingGroups: array of group descriptors (id, label, classId, etc.)
 *  - grids: pre-built schedule data keyed by [tgId][semester][week][day][period]
 *
 * @returns {{travellingGroups: Array, grids: Object}}
 */
function getTimetableData() {
  const doc = loadXmlFromDrive();
  return buildTimetableData(doc);
}

// ── XML loading ───────────────────────────────────────────────────────────────

/**
 * Finds and parses the timetable XML from Google Drive by filename.
 * If multiple files share the name, the most recently modified is used.
 *
 * @see https://developers.google.com/apps-script/reference/drive/drive-app#getFilesByName(String)
 * @returns {GoogleAppsScript.XML_Service.Document}
 * @throws {Error} If no matching file is found.
 */
function loadXmlFromDrive() {
  // https://developers.google.com/apps-script/reference/drive/drive-app
  const files = DriveApp.getFilesByName(XML_FILENAME);
  if (!files.hasNext()) {
    throw new Error(
      `"${XML_FILENAME}" was not found in Google Drive. ` +
      'Upload the file and ensure it is accessible to this script.'
    );
  }
  // If multiple copies exist, pick the most recently modified.
  let best = files.next();
  while (files.hasNext()) {
    const candidate = files.next();
    if (candidate.getLastUpdated() > best.getLastUpdated()) best = candidate;
  }
  const content = best.getBlob().getDataAsString('UTF-8');
  return XmlService.parse(content);
}

// ── Data building ─────────────────────────────────────────────────────────────

/**
 * Orchestrates parsing of the XML document into the data structure
 * the frontend grid renderer expects.
 *
 * @param {GoogleAppsScript.XML_Service.Document} doc
 * @returns {{travellingGroups: Array, grids: Object}}
 */
function buildTimetableData(doc) {
  const root = doc.getRootElement();

  const subjects   = parseSection(root, 'subjects',   'subject');
  const teachers   = parseSection(root, 'teachers',   'teacher');
  const classrooms = parseSection(root, 'classrooms', 'classroom');
  const classes    = parseSection(root, 'classes',    'class');
  const allGroups  = parseGroups(root);
  const lessons    = parseLessons(root);
  const cards      = parseCards(root);

  const travellingGroups = detectTravellingGroups(classes, allGroups);
  const grids = buildGrids(travellingGroups, lessons, cards, subjects, teachers, classrooms, allGroups);

  return { travellingGroups, grids };
}

// ── Section parsers ───────────────────────────────────────────────────────────

/**
 * Parses a named XML section (e.g. <subjects><subject .../></subjects>)
 * into an object keyed by each element's id attribute.
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @param {string} sectionTag  e.g. 'subjects'
 * @param {string} childTag    e.g. 'subject'
 * @returns {Object} Map of id → {all attributes as key:value strings}
 */
function parseSection(root, sectionTag, childTag) {
  const result = {};
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
  const result = {};
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
  const result = {};
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
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @returns {Array} Array of {lessonId, period, days, weeks, terms, classroomIds}
 */
function parseCards(root) {
  const result = [];
  const section = root.getChild('cards');
  if (!section) return result;
  section.getChildren('card').forEach(c => {
    result.push({
      lessonId:     attrVal(c, 'lessonid'),
      period:       parseInt(attrVal(c, 'period') || '0', 10),
      days:         attrVal(c, 'days'),
      weeks:        attrVal(c, 'weeks'),
      terms:        attrVal(c, 'terms'),
      classroomIds: splitIds(attrVal(c, 'classroomids'))
    });
  });
  return result;
}

// ── Travelling group detection ─────────────────────────────────────────────────

/**
 * Auto-detects travelling groups from the classes and groups data.
 *
 * Rules:
 *  - Only processes grades defined in TRAVELLING_GROUP_GRADES.
 *  - "BY" classes: the whole class is treated as one travelling group.
 *  - "G" classes: groups whose names start with a digit are clustered
 *    by that first digit into separate travelling groups (one per digit).
 *
 * @param {Object} classes   Map of classId → class attributes
 * @param {Object} allGroups Map of groupId → group data
 * @returns {Array} Array of {id, label, classId, className, classShort, groupIds, groupNames}
 */
function detectTravellingGroups(classes, allGroups) {
  const result = [];

  Object.entries(classes).forEach(([classId, cls]) => {
    const grade = parseInt(cls.grade || '0', 10);
    if (!TRAVELLING_GROUP_GRADES.includes(grade)) return;

    const classGroupEntries = Object.entries(allGroups)
      .filter(([, g]) => g.classId === classId)
      .map(([id, g]) => ({ id, ...g }));

    if (cls.short.includes('BY')) {
      // Boys class: entire class is one travelling group.
      result.push({
        id:         `${cls.short}-BY`,
        label:      `${grade}G-BY`,
        classId,
        className:  cls.name,
        classShort: cls.short,
        groupIds:   classGroupEntries.map(g => g.id),
        groupNames: classGroupEntries.map(g => g.name)
      });
      return;
    }

    // G class: cluster groups by their leading digit.
    const numericGroups = classGroupEntries.filter(g => /^\d/.test(g.name));
    const byDigit = {};
    numericGroups.forEach(g => {
      const digit = g.name.charAt(0);
      if (!byDigit[digit]) byDigit[digit] = [];
      byDigit[digit].push(g);
    });

    Object.keys(byDigit).sort().forEach(digit => {
      const groups = byDigit[digit];
      result.push({
        id:         `${cls.short}-${digit}`,
        label:      `${grade}G-${digit}`,
        classId,
        className:  cls.name,
        classShort: cls.short,
        groupIds:   groups.map(g => g.id),
        groupNames: groups.map(g => g.name)
      });
    });
  });

  return result.sort((a, b) => a.label.localeCompare(b.label));
}

// ── Grid builder ──────────────────────────────────────────────────────────────

/**
 * Maps XML period numbers to 1-based display period indices.
 * Periods 3 (Lunch Pt 1) and 4 (Lunch Pt 2 / Advisory) are excluded from display.
 */
const PERIOD_DISPLAY_MAP = { 1: 1, 2: 2, 5: 3, 6: 4 };

/** Maps a 5-bit day string from the XML to a day number (1–5). */
const DAY_FROM_BITS = {
  '10000': 1, '01000': 2, '00100': 3, '00010': 4, '00001': 5
};

/** Display labels and time ranges for each academic period. */
const PERIOD_INFO = {
  1: { label: 'Period 1', time: '8:15–9:35' },
  2: { label: 'Period 2', time: '9:45–11:05' },
  3: { label: 'Period 3', time: '12:10–13:30' },
  4: { label: 'Period 4', time: '13:40–15:00' }
};

/**
 * Builds pre-computed grid data for every travelling group.
 *
 * Grid structure:
 *   grids[tgId][semester][week][day][period] = Array of slot objects
 *
 * Each slot object:
 *   { subject, subjectShort, teacher, teacherShort, room, roomShort, subGroupNames }
 *
 * A slot represents one distinct lesson in that cell. Where a travelling group
 * splits (e.g. language sub-groups), there will be multiple slots per cell,
 * displayed horizontally by the frontend.
 *
 * Inclusion rules per cell:
 *  1. Include lessons whose groups overlap with the travelling group (TG-specific lessons).
 *  2. Include lessons whose groups contain none of any TG's numeric groups (shared lessons
 *     such as English ability groups or advisory that apply to all students).
 *  3. Exclude lessons whose groups belong only to a different travelling group.
 *
 * @param {Array}  travellingGroups
 * @param {Object} lessons
 * @param {Array}  cards
 * @param {Object} subjects
 * @param {Object} teachers
 * @param {Object} classrooms
 * @param {Object} allGroups
 * @returns {Object} Nested grid structure.
 */
function buildGrids(travellingGroups, lessons, cards, subjects, teachers, classrooms, allGroups) {

  // Set of all group IDs that belong to any travelling group, used to identify
  // "shared" lessons (those using no TG-specific groups, e.g. English ability groups).
  const allTgGroupIds = new Set(travellingGroups.flatMap(tg => tg.groupIds));

  const grids = {};

  travellingGroups.forEach(tg => {
    const tgGroupSet = new Set(tg.groupIds);
    grids[tg.id] = {};

    ['S1', 'S2'].forEach(semester => {
      const termBit = semester === 'S1' ? '10' : '01';
      grids[tg.id][semester] = {};

      ['A', 'B'].forEach(week => {
        const weekBit = week === 'A' ? '10' : '01';
        grids[tg.id][semester][week] = {};

        // Initialise empty cells for every day and display period.
        for (let day = 1; day <= 5; day++) {
          grids[tg.id][semester][week][day] = { 1: [], 2: [], 3: [], 4: [] };
        }

        cards.forEach(card => {
          // Card must fall in this week (exact match or "all weeks").
          if (card.weeks !== weekBit && card.weeks !== '11') return;

          // Card must fall in this semester (exact match or "all terms").
          if (card.terms !== termBit && card.terms !== '11') return;

          const day = DAY_FROM_BITS[card.days];
          if (!day) return;

          const displayPeriod = PERIOD_DISPLAY_MAP[card.period];
          if (!displayPeriod) return;

          const lesson = lessons[card.lessonId];
          if (!lesson) return;

          // Lesson must involve the TG's class (filters out cross-class lessons
          // that don't include this class at all).
          if (!lesson.classIds.includes(tg.classId)) return;

          const matchesTg = lesson.groupIds.some(gId => tgGroupSet.has(gId));
          const isShared  = !lesson.groupIds.some(gId => allTgGroupIds.has(gId));

          if (!matchesTg && !isShared) return;

          // Resolve display strings.
          const subj = subjects[lesson.subjectId] || { name: 'Unknown', short: '?' };

          const teacherShort = lesson.teacherIds
            .map(id => (teachers[id] || {}).short || id).join(', ');
          const teacherFull = lesson.teacherIds
            .map(id => (teachers[id] || {}).name || id).join(', ');

          // Cards can override the lesson's classroom assignment.
          const roomIds = card.classroomIds.length > 0
            ? card.classroomIds
            : lesson.classroomIds;
          const roomShort = roomIds.map(id => (classrooms[id] || {}).short || id).join(', ');
          const roomFull  = roomIds.map(id => (classrooms[id] || {}).name  || id).join(', ');

          // For TG-specific lessons, report only the sub-groups from this TG.
          // For shared lessons (English etc.), report the actual group name.
          const relevantGroupIds = matchesTg
            ? lesson.groupIds.filter(gId => tgGroupSet.has(gId))
            : lesson.groupIds;
          const subGroupNames = relevantGroupIds
            .map(gId => (allGroups[gId] || {}).name || gId);

          grids[tg.id][semester][week][day][displayPeriod].push({
            subject:      subj.name,
            subjectShort: subj.short,
            teacher:      teacherFull,
            teacherShort,
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
