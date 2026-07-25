'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Loads Code.js into a fresh Node vm context and returns it.
 *
 * Code.js has no module.exports (Apps Script doesn't use them) — it's a flat
 * set of top-level function/const declarations, exactly as Apps Script sees
 * it. Running it via vm, rather than require()-ing it directly, means these
 * tests exercise the exact same file that gets pushed to Apps Script, with
 * zero modification and zero build step.
 *
 * Only functions that don't call any Apps Script service (Logger, XmlService,
 * DriveApp, PropertiesService, CacheService, HtmlService) are safe to call
 * from tests — e.g. buildGrids, detectTravellingGroups, detectJsClasses,
 * buildTeacherSchedule, gradeSortKey, inferJsGrade, timeToMinutes, splitIds.
 * Functions that do call a service (getConfig, parsePeriods, loadXmlFromDrive,
 * the cache helpers, etc.) will load fine here but throw a ReferenceError if
 * actually invoked, since no Apps Script globals are stubbed. That's
 * deliberate — those functions depend on the real Google services to mean
 * anything, and are better covered by manual /dev smoke-testing than a mock.
 *
 * @returns {object} The vm context — top-level functions are properties on it
 *   (e.g. context.buildGrids), top-level const/let are not (a vm quirk: only
 *   var/function declarations attach to the context object), but that's fine
 *   since the functions still close over them correctly when called.
 */
function loadCode() {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'Code.js'), 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'Code.js' });
  return context;
}

/**
 * Deep-clones a value out of the vm context's realm into a plain, ordinary
 * object/array belonging to this (the test's) realm.
 *
 * vm.createContext() gives the loaded code its own Array/Object/etc.
 * constructors, separate from the outer process's. Values returned from
 * vm-loaded functions are structurally identical to normal JS values but are
 * *instances of a different realm's built-ins* — assert.deepEqual/
 * deepStrictEqual treats that as a mismatch ("same structure but are not
 * reference-equal") even when every field matches. Since everything these
 * functions return is plain, JSON-serialisable data (no functions, Dates,
 * etc.), round-tripping through JSON is a simple, reliable fix.
 *
 * @param {*} value
 * @returns {*}
 */
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { loadCode, toPlain };
