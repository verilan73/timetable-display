'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCode, toPlain } = require('./helpers/loadCode');

const code = loadCode();
/** Runs buildGrids and returns a plain (this-realm) copy of the result. */
function buildGrids(...args) {
  return toPlain(code.buildGrids(...args));
}

/**
 * A minimal Grade 9 fixture reproducing the exact shape that caused Arts
 * classes to vanish from digit TG views: two digit-clustered travelling
 * groups (9-1, 9-2) plus a BY group that — per the real XML data — contains
 * every group in the class, including cross-class elective groups like "Mus".
 *
 * One lesson (Music) belongs only to the elective group "Mus", never to a
 * digit group directly, and should still show up in every digit TG's view
 * because it's shared across the whole grade.
 */
function buildFixture() {
  const travellingGroups = [
    { id: '9G-1',  classId: 'C9', groupIds: ['9-1'],              viewType: 'tg' },
    { id: '9G-2',  classId: 'C9', groupIds: ['9-2'],              viewType: 'tg' },
    { id: '9G-BY', classId: 'C9', groupIds: ['9-1', '9-2', 'Mus'], viewType: 'tg' },
  ];

  const lessons = {
    'L-MUS': { subjectId: 'MUS', classIds: ['C9'], groupIds: ['Mus'], teacherIds: ['T1'], classroomIds: [] },
    'L-MAT': { subjectId: 'MAT', classIds: ['C9'], groupIds: ['9-1'], teacherIds: ['T2'], classroomIds: [] },
  };

  const cards = [
    { lessonId: 'L-MUS', period: 1, days: '10000', weeks: '11', terms: '11', classroomIds: [] },
    { lessonId: 'L-MAT', period: 1, days: '10000', weeks: '11', terms: '11', classroomIds: [] },
  ];

  const subjects   = { MUS: { name: 'Music', short: 'MUS' }, MAT: { name: 'Mathematics', short: 'MAT' } };
  const teachers   = { T1: { name: 'Teacher One' }, T2: { name: 'Teacher Two' } };
  const classrooms = {};
  const allGroups  = {
    '9-1': { name: '9-1', classId: 'C9', entireClass: false, divisionTag: 0 },
    '9-2': { name: '9-2', classId: 'C9', entireClass: false, divisionTag: 0 },
    'Mus': { name: 'Mus', classId: 'C9', entireClass: false, divisionTag: 0 },
  };
  const periods = [{ period: 1, label: 'Period 1', short: 'P1', startMin: 480, endMin: 520, durationMin: 40 }];

  return { travellingGroups, lessons, cards, subjects, teachers, classrooms, allGroups, periods };
}

function subjectsIn(slots) {
  return slots.map(s => s.subjectShort).sort();
}

test('shared elective lessons (BY-only groups) appear in every digit TG view', () => {
  const f = buildFixture();
  const grids = buildGrids(
    f.travellingGroups, f.lessons, f.cards,
    f.subjects, f.teachers, f.classrooms, f.allGroups, f.periods, 'AB'
  );

  const tg1Slots = grids['9G-1'].S1.A[1][1];
  const tg2Slots = grids['9G-2'].S1.A[1][1];

  assert.deepEqual(subjectsIn(tg1Slots), ['MAT', 'MUS'],
    'TG 9G-1 should see its own Maths lesson plus the shared Music elective');
  assert.deepEqual(subjectsIn(tg2Slots), ['MUS'],
    'TG 9G-2 has no lesson of its own here, but should still see the shared Music elective');
});

test('the BY view itself sees every lesson in the class', () => {
  const f = buildFixture();
  const grids = buildGrids(
    f.travellingGroups, f.lessons, f.cards,
    f.subjects, f.teachers, f.classrooms, f.allGroups, f.periods, 'AB'
  );

  const bySlots = grids['9G-BY'].S1.A[1][1];
  assert.deepEqual(subjectsIn(bySlots), ['MAT', 'MUS']);
});

test('a lesson tied to one digit group only appears in that group\'s own view, not the other digit group', () => {
  const f = buildFixture();
  const grids = buildGrids(
    f.travellingGroups, f.lessons, f.cards,
    f.subjects, f.teachers, f.classrooms, f.allGroups, f.periods, 'AB'
  );

  const tg2Slots = grids['9G-2'].S1.A[1][1];
  assert.ok(!subjectsIn(tg2Slots).includes('MAT'),
    'the Maths lesson belongs only to group 9-1 and should not leak into 9G-2\'s view');
});

test('class-view groups (grades 10-12) include every lesson for the class, not just group-matched ones', () => {
  const f = buildFixture();
  f.travellingGroups.push({ id: 'C9-CLASS', classId: 'C9', groupIds: ['9-1', '9-2', 'Mus'], viewType: 'class' });

  const grids = buildGrids(
    f.travellingGroups, f.lessons, f.cards,
    f.subjects, f.teachers, f.classrooms, f.allGroups, f.periods, 'AB'
  );

  assert.deepEqual(subjectsIn(grids['C9-CLASS'].S1.A[1][1]), ['MAT', 'MUS']);
});

test('week and term bit-matching: a Week-A-only, Semester-1-only card does not appear in Week B or Semester 2', () => {
  const f = buildFixture();
  f.cards = [
    { lessonId: 'L-MAT', period: 1, days: '10000', weeks: '10', terms: '10', classroomIds: [] },
  ];

  const grids = buildGrids(
    f.travellingGroups, f.lessons, f.cards,
    f.subjects, f.teachers, f.classrooms, f.allGroups, f.periods, 'AB'
  );

  assert.deepEqual(subjectsIn(grids['9G-1'].S1.A[1][1]), ['MAT'], 'present in S1 / Week A');
  assert.deepEqual(subjectsIn(grids['9G-1'].S1.B[1][1]), [], 'absent from Week B');
  assert.deepEqual(subjectsIn(grids['9G-1'].S2.A[1][1]), [], 'absent from Semester 2');
});

test('JS-style single-week schedules: a card carrying the normalised "11" week/term bits matches every week/semester slot', () => {
  const f = buildFixture();
  // parseCards() normalises JS's weeks="1" to "11" before buildGrids ever sees it.
  f.cards = [
    { lessonId: 'L-MAT', period: 1, days: '10000', weeks: '11', terms: '11', classroomIds: [] },
  ];

  const grids = buildGrids(
    f.travellingGroups, f.lessons, f.cards,
    f.subjects, f.teachers, f.classrooms, f.allGroups, f.periods, 'single'
  );

  assert.deepEqual(subjectsIn(grids['9G-1'].S1.single[1][1]), ['MAT']);
  assert.deepEqual(subjectsIn(grids['9G-1'].S2.single[1][1]), ['MAT']);
});

test('"entire class" groups are suppressed from sub-group names (they add no information alone)', () => {
  const f = buildFixture();
  f.allGroups['9-1'].entireClass = true;

  const grids = buildGrids(
    f.travellingGroups, f.lessons, f.cards,
    f.subjects, f.teachers, f.classrooms, f.allGroups, f.periods, 'AB'
  );

  const matSlot = grids['9G-1'].S1.A[1][1].find(s => s.subjectShort === 'MAT');
  assert.deepEqual(matSlot.subGroupNames, []);
});
