'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCode, toPlain } = require('./helpers/loadCode');

const code = loadCode();
function detectTravellingGroups(...args) { return toPlain(code.detectTravellingGroups(...args)); }
function detectJsClasses(...args)        { return toPlain(code.detectJsClasses(...args)); }

// parseSection() copies every XML attribute as a raw string, so classes/groups
// fixtures use string grades exactly as the real parser would produce.

test('MSSS: a travelling-group grade clusters groups by leading digit', () => {
  const classes = { C6: { grade: '6', short: '6G', name: 'Grade 6' } };
  const allGroups = {
    g1a: { name: '1-1', classId: 'C6', entireClass: false, divisionTag: 0 },
    g1b: { name: '1-2', classId: 'C6', entireClass: false, divisionTag: 0 },
    g2a: { name: '2-1', classId: 'C6', entireClass: false, divisionTag: 0 },
  };

  const result = detectTravellingGroups(classes, allGroups, 'MSSS');

  assert.equal(result.length, 2, 'one TG per distinct leading digit');
  const ids = result.map(tg => tg.id).sort();
  assert.deepEqual(ids, ['6G-1', '6G-2']);
  const tg1 = result.find(tg => tg.id === '6G-1');
  assert.deepEqual(tg1.groupIds.sort(), ['g1a', 'g1b']);
  assert.equal(tg1.viewType, 'tg');
});

test('MSSS: a class short containing "BY" becomes one whole-grade TG instead of digit clusters', () => {
  const classes = { C6: { grade: '6', short: '6GBY', name: 'Grade 6' } };
  const allGroups = {
    g1: { name: '1-1', classId: 'C6', entireClass: false, divisionTag: 0 },
    g2: { name: '2-1', classId: 'C6', entireClass: false, divisionTag: 0 },
    gm: { name: 'Mus', classId: 'C6', entireClass: false, divisionTag: 0 },
  };

  const result = detectTravellingGroups(classes, allGroups, 'MSSS');

  assert.equal(result.length, 1);
  assert.equal(result[0].id, '6GBY-BY');
  assert.deepEqual(result[0].groupIds.sort(), ['g1', 'g2', 'gm'],
    'BY groups include every group in the class, including non-digit electives');
});

test('MSSS: grades 10-12 become a single whole-class view, not travelling groups', () => {
  const classes = { C10: { grade: '10', short: '10A', name: 'Grade 10 A' } };
  const allGroups = {
    g1: { name: 'Elective 1', classId: 'C10', entireClass: false, divisionTag: 0 },
  };

  const result = detectTravellingGroups(classes, allGroups, 'MSSS');

  assert.equal(result.length, 1);
  assert.equal(result[0].id, '10A-CLASS');
  assert.equal(result[0].viewType, 'class');
});

test('MSSS: grades outside 6-12 produce no entry at all', () => {
  const classes = { C5: { grade: '5', short: '5G', name: 'Grade 5' } };
  const allGroups = {};

  const result = detectTravellingGroups(classes, allGroups, 'MSSS');

  assert.deepEqual(result, []);
});

test('MSSS: results are sorted by grade, then label', () => {
  const classes = {
    C7: { grade: '7', short: '7G', name: 'Grade 7' },
    C6: { grade: '6', short: '6G', name: 'Grade 6' },
  };
  const allGroups = {
    a: { name: '1-1', classId: 'C7', entireClass: false, divisionTag: 0 },
    b: { name: '1-1', classId: 'C6', entireClass: false, divisionTag: 0 },
  };

  const result = detectTravellingGroups(classes, allGroups, 'MSSS');

  assert.deepEqual(result.map(tg => tg.id), ['6G-1', '7G-1']);
});

test('JS: JK/SK classes get human-readable grade labels and sort before numbered grades', () => {
  const classes = {
    CJK: { grade: '', short: 'JKP', name: 'Junior Kindergarten P' },
    CSK: { grade: '', short: 'SKJH', name: 'Senior Kindergarten JH' },
    C1:  { grade: '', short: 'G1DZ', name: 'Grade 1 DZ' },
  };
  const allGroups = {};

  const result = detectJsClasses(classes, allGroups);

  assert.deepEqual(result.map(c => c.id), ['JKP-CLASS', 'SKJH-CLASS', 'G1DZ-CLASS']);
  assert.equal(result[0].gradeLabel, 'Junior Kindergarten');
  assert.equal(result[1].gradeLabel, 'Senior Kindergarten');
  assert.equal(result[2].gradeLabel, 'Grade 1');
});

test('JS: classes with no inferable grade (e.g. "PYP Meetings") are skipped entirely', () => {
  const classes = {
    CX: { grade: '', short: 'PYP Meetings', name: 'PYP Meetings' },
  };
  const allGroups = {};

  const result = detectJsClasses(classes, allGroups);

  assert.deepEqual(result, []);
});
