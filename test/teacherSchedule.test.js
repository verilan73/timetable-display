'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCode, toPlain } = require('./helpers/loadCode');

const code = loadCode();
function buildTeacherSchedule(...args) { return toPlain(code.buildTeacherSchedule(...args)); }

/** Mirrors the shape parseScheduleSource() produces from one XML file. */
function buildSource(overrides = {}) {
  return Object.assign({
    periods:  [{ period: 1, label: 'Period 1', short: 'P1', startMin: 480, endMin: 520, durationMin: 40 }],
    subjects: { MAT: { name: 'Mathematics', short: 'MAT' } },
    classrooms: { R1: { name: 'Room 101', short: 'R101' }, R2: { name: 'Room 202', short: 'R202' } },
    classes:  { C1: { short: '6G' } },
    groups:   {
      wholeClass: { name: '6G', classId: 'C1', entireClass: true },
      groupA:     { name: '1-1', classId: 'C1', entireClass: false },
    },
    lessons:  {
      L1: { subjectId: 'MAT', classIds: ['C1'], groupIds: ['groupA'], teacherIds: ['T1'], classroomIds: [] },
    },
    cards: [
      { lessonId: 'L1', period: 1, days: '10000', weeks: '11', terms: '11', classroomIds: [] },
    ],
    weeksMode: 'AB',
  }, overrides);
}

test('a lesson taught by the requested teacher appears with real clock times from its period', () => {
  const schedule = buildTeacherSchedule('T1', buildSource());
  const block = schedule.S1.A[1][0];

  assert.equal(block.subjectShort, 'MAT');
  assert.equal(block.startMin, 480);
  assert.equal(block.endMin, 520);
  assert.equal(block.classNames, '6G');
});

test('a lesson taught by a different teacher does not appear at all', () => {
  const schedule = buildTeacherSchedule('T-someone-else', buildSource());
  assert.deepEqual(schedule.S1.A[1], []);
});

test('a card restricted to Week B only does not appear in Week A', () => {
  const source = buildSource({
    cards: [{ lessonId: 'L1', period: 1, days: '10000', weeks: '01', terms: '11', classroomIds: [] }],
  });
  const schedule = buildTeacherSchedule('T1', source);

  assert.deepEqual(schedule.S1.A[1], []);
  assert.equal(schedule.S1.B[1].length, 1);
});

test('card-level classroom overrides the lesson-level default room', () => {
  const source = buildSource({
    lessons: {
      L1: { subjectId: 'MAT', classIds: ['C1'], groupIds: ['groupA'], teacherIds: ['T1'], classroomIds: ['R1'] },
    },
    cards: [
      { lessonId: 'L1', period: 1, days: '10000', weeks: '11', terms: '11', classroomIds: ['R2'] },
    ],
  });
  const schedule = buildTeacherSchedule('T1', source);

  assert.equal(schedule.S1.A[1][0].roomShort, 'R202');
});

test('falls back to the lesson-level room when the card specifies none', () => {
  const source = buildSource({
    lessons: {
      L1: { subjectId: 'MAT', classIds: ['C1'], groupIds: ['groupA'], teacherIds: ['T1'], classroomIds: ['R1'] },
    },
  });
  const schedule = buildTeacherSchedule('T1', source);

  assert.equal(schedule.S1.A[1][0].roomShort, 'R101');
});

test('entire-class groups are suppressed from group names, same as buildGrids', () => {
  const source = buildSource({
    lessons: {
      L1: { subjectId: 'MAT', classIds: ['C1'], groupIds: ['wholeClass'], teacherIds: ['T1'], classroomIds: [] },
    },
  });
  const schedule = buildTeacherSchedule('T1', source);

  assert.deepEqual(schedule.S1.A[1][0].groupNames, []);
});

test('a JS-style single-week source produces a "single" week key instead of A/B', () => {
  const source = buildSource({ weeksMode: 'single' });
  const schedule = buildTeacherSchedule('T1', source);

  assert.equal(schedule.S1.single[1].length, 1);
  assert.equal(schedule.S1.A, undefined);
});
