/**
 * @fileoverview Timetable Viewer — Google Apps Script backend.
 *
 * Reads the aSc Timetables XML export from a specific Google Drive folder and
 * returns structured schedule data to the browser for interactive display.
 *
 * Setup:
 *  1. Upload your timetable XML to the folder identified by TIMETABLE_FOLDER_ID.
 *  2. Copy this file and Index.html into a new Apps Script project
 *     (script.google.com > New project).
 *  3. Deploy > New deployment > Web app.
 *     Execute as: Me | Who has access: Anyone in your organisation.
 *     (Users do NOT need Drive access — the script reads the file as you.)
 *  4. Copy the deployment URL and embed it in Google Sites via Insert > Embed.
 */

/** Name of the XML file to locate in the timetable folder. */
const XML_FILENAME = 'MSSS Schedule.xml';

/**
 * ID of the Shared Drive folder that holds the timetable XML.
 * Extract from the folder URL: drive.google.com/drive/.../folders/<ID>
 */
const TIMETABLE_FOLDER_ID = '1HP8gmuAjCm8AsqxRlTaS-OI2uMlK1Z54';

/**
 * Grades that use the travelling-group system. Groups whose names start with a
 * digit are clustered by that digit into separate travelling groups.
 */
const TRAVELLING_GROUP_GRADES = [6, 7, 8, 9];

/**
 * Grades shown as a whole-class view (no travelling group sub-division).
 * Each class appears as a single entry; simultaneous elective splits are
 * displayed as horizontal sub-slots, exactly as TG splits are.
 */
const CLASS_VIEW_GRADES = [10, 11, 12];

/** Maps a 5-bit day string from the XML to a day number (1–5). */
const DAY_FROM_BITS = {
  '10000': 1, '01000': 2, '00100': 3, '00010': 4, '00001': 5
};

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
 *  - periods:         array of period descriptors with real start/end times
 *  - travellingGroups: array of group/class descriptors
 *  - grids:           schedule data keyed by [tgId][semester][week][day][xmlPeriodNum]
 *
 * @returns {{periods: Array, travellingGroups: Array, grids: Object}}
 */
function getTimetableData() {
  const doc = loadXmlFromDrive();
  return buildTimetableData(doc);
}

// ── XML loading ───────────────────────────────────────────────────────────────

/**
 * Finds and parses the timetable XML from the designated Shared Drive folder.
 * Scoping to one folder avoids ambiguity when multiple XML exports exist across
 * Drive. If multiple copies share the filename, the most recently modified wins.
 *
 * @see https://developers.google.com/apps-script/reference/drive/drive-app#getFolderById(String)
 * @returns {GoogleAppsScript.XML_Service.Document}
 * @throws {Error} If the folder or file cannot be found.
 */
function loadXmlFromDrive() {
  // getFolderById works with Shared Drives under the V8 runtime.
  // https://developers.google.com/apps-script/reference/drive/drive-app#getFolderById(String)
  const folder = DriveApp.getFolderById(TIMETABLE_FOLDER_ID);
  const files = folder.getFilesByName(XML_FILENAME);
  if (!files.hasNext()) {
    throw new Error(
      `"${XML_FILENAME}" was not found in the timetable folder (${TIMETABLE_FOLDER_ID}). ` +
      'Upload the XML export to that folder and ensure the filename matches XML_FILENAME.'
    );
  }
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
 * Orchestrates parsing of the XML document into the structure the frontend expects.
 *
 * @param {GoogleAppsScript.XML_Service.Document} doc
 * @returns {{periods: Array, travellingGroups: Array, grids: Object}}
 */
function buildTimetableData(doc) {
  const root = doc.getRootElement();

  const periods    = parsePeriods(root);
  const subjects   = parseSection(root, 'subjects',   'subject');
  const teachers   = parseSection(root, 'teachers',   'teacher');
  const classrooms = parseSection(root, 'classrooms', 'classroom');
  const classes    = parseSection(root, 'classes',    'class');
  const allGroups  = parseGroups(root);
  const lessons    = parseLessons(root);
  const cards      = parseCards(root);

  const travellingGroups = detectTravellingGroups(classes, allGroups);
  const grids = buildGrids(
    travellingGroups, lessons, cards,
    subjects, teachers, classrooms, allGroups, periods
  );

  return { periods, travellingGroups, grids };
}

// ── Section parsers ───────────────────────────────────────────────────────────

/**
 * Parses the <periods> section and resolves each entry to real clock times.
 * Period names like "1." are normalised to "Period 1" for display.
 * Times are stored as minutes from midnight so the frontend can size rows
 * proportionally and the Phase 2 timeline can place blocks accurately.
 *
 * @param {GoogleAppsScript.XML_Service.Element} root
 * @returns {Array} Sorted array of {period, label, short, startMin, endMin, durationMin}
 */
function parsePeriods(root) {
  const result = [];
  const section = root.getChild('periods');
  if (!section) return result;

  section.getChildren('period').forEach(p => {
    const rawLabel = attrVal(p, 'name');
    // Normalise "1." → "Period 1", "2." → "Period 2" etc.; leave named periods as-is.
    const label = /^\d+\.$/.test(rawLabel)
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

// ── Group / class detection ───────────────────────────────────────────────────

/**
 * Builds the list of selectable schedule units for the frontend dropdown.
 *
 * For grades 6–9 (TRAVELLING_GROUP_GRADES):
 *   - BY classes → one entry for the whole class (viewType: 'tg')
 *   - G classes  → one entry per leading digit in group names (viewType: 'tg')
 *
 * For grades 10–12 (CLASS_VIEW_GRADES):
 *   - Each class → one entry; all its groups included (viewType: 'class')
 *   - Simultaneous elective groups appear as horizontal splits in cells
 *
 * Each entry carries a `grade` integer so the frontend can group by grade
 * without regex-parsing the label.
 *
 * @param {Object} classes   Map of classId → class attributes
 * @param {Object} allGroups Map of groupId → group data
 * @returns {Array} Sorted array of schedule unit descriptors
 */
function detectTravellingGroups(classes, allGroups) {
  const result = [];

  Object.entries(classes).forEach(([classId, cls]) => {
    const grade = parseInt(cls.grade || '0', 10);

    const classGroupEntries = Object.entries(allGroups)
      .filter(([, g]) => g.classId === classId)
      .map(([id, g]) => ({ id, ...g }));

    if (TRAVELLING_GROUP_GRADES.includes(grade)) {
      if (cls.short.includes('BY')) {
        result.push({
          id:         `${cls.short}-BY`,
          label:      `${grade}G-BY`,
          grade,
          classId,
          className:  cls.name,
          classShort: cls.short,
          groupIds:   classGroupEntries.map(g => g.id),
          viewType:   'tg'
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
        const groups = byDigit[digit];
        result.push({
          id:         `${cls.short}-${digit}`,
          label:      `${grade}G-${digit}`,
          grade,
          classId,
          className:  cls.name,
          classShort: cls.short,
          groupIds:   groups.map(g => g.id),
          viewType:   'tg'
        });
      });

    } else if (CLASS_VIEW_GRADES.includes(grade)) {
      result.push({
        id:         `${cls.short}-CLASS`,
        label:      cls.short,
        grade,
        classId,
        className:  cls.name,
        classShort: cls.short,
        groupIds:   classGroupEntries.map(g => g.id),
        viewType:   'class'
      });
    }
  });

  // Sort by grade ascending, then alphabetically within each grade.
  return result.sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    return a.label.localeCompare(b.label);
  });
}

// ── Grid builder ──────────────────────────────────────────────────────────────

/**
 * Builds pre-computed grid data for every schedule unit.
 *
 * Grid structure:
 *   grids[tgId][semester][week][day][xmlPeriodNum] = Array of slot objects
 *
 * xmlPeriodNum is the raw period number from the XML (not a display index), so
 * the frontend can look up slots using the period list from parsePeriods().
 * All named periods are included — lunch, advisory, etc.
 *
 * Each slot: { subject, subjectShort, teacher, room, roomShort, subGroupNames }
 *
 * Inclusion rules:
 *  viewType 'tg'   — include lessons whose groups overlap with this TG's groupIds
 *                    OR whose groups contain none of any TG's numeric groups (shared
 *                    lessons such as English ability sets or advisory).
 *  viewType 'class' — include all lessons where the classId matches; no group filtering.
 *                    Simultaneous elective splits appear as multiple slots per cell.
 *
 * @param {Array}  travellingGroups  Output of detectTravellingGroups()
 * @param {Object} lessons
 * @param {Array}  cards
 * @param {Object} subjects
 * @param {Object} teachers
 * @param {Object} classrooms
 * @param {Object} allGroups
 * @param {Array}  periods           Output of parsePeriods()
 * @returns {Object} Nested grid structure
 */
function buildGrids(travellingGroups, lessons, cards, subjects, teachers, classrooms, allGroups, periods) {

  // Only TG-mode groups feed the shared-lesson detection set.
  // Class-view groups (grades 10–12) are excluded so their lessons aren't
  // accidentally treated as "shared" and shown in grades 6–9 views.
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

      ['A', 'B'].forEach(week => {
        const weekBit = week === 'A' ? '10' : '01';
        grids[tg.id][semester][week] = {};

        for (let day = 1; day <= 5; day++) {
          grids[tg.id][semester][week][day] = {};
          allPeriodNums.forEach(pNum => {
            grids[tg.id][semester][week][day][pNum] = [];
          });
        }

        cards.forEach(card => {
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
            // Grades 10–12: show all lessons for the class.
            include = true;
            relevantGroupIds = lesson.groupIds.filter(gId => tgGroupSet.has(gId));
          } else {
            // Grades 6–9: TG-specific or shared lessons only.
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

          // Suppress "Entire class" — it adds no information when there's only one slot.
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
