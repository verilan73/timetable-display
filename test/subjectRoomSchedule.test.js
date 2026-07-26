'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCode, toPlain } = require('./helpers/loadCode');

const code = loadCode();
function buildSubjectSchedule(...args) { return toPlain(code.buildSubjectSchedule(...args)); }
function buildRoomSchedule(...args)    { return toPlain(code.buildRoomSchedule(...args)); }

/** Mirrors the shape parseScheduleSource() produces from one XML file. */
function buildSource(overrides = {}) {
  return Object.assign({
    periods:  [{ period: 1, label: 'Period 1', short: 'P1', startMin: 480, endMin: 520, durationMin: 40 }],
    subjects: { MAT: { name: 'Mathematics', short: 'MAT' }, MUS: { name: 'Music', short: 'MUS' } },
    teachers: { T1: { name: 'Jane Doe' }, T2: { name: 'John Smith' } },
    classrooms: { R1: { name: 'Room 101', short: 'R101' }, R2: { name: 'Room 202', short: 'R202' } },
    classes:  { C1: { short: '6G' } },
    groups:   { groupA: { name: '1-1', classId: 'C1', entireClass: false } },
    lessons:  {
      L1: { subjectId: 'MAT', classIds: ['C1'], groupIds: ['groupA'], teacherIds: ['T1'], classroomIds: ['R1'] },
      L2: { subjectId: 'MUS', classIds: ['C1'], groupIds: ['groupA'], teacherIds: ['T2'], classroomIds: ['R2'] },
    },
    cards: [
      { lessonId: 'L1', period: 1, days: '10000', weeks: '11', terms: '11', classroomIds: [] },
      { lessonId: 'L2', period: 1, days: '01000', weeks: '11', terms: '11', classroomIds: [] },
    ],
    weeksMode: 'AB',
  }, overrides);
}

test('buildSubjectSchedule includes only lessons of the requested subject, with the teacher name surfaced', () => {
  const schedule = buildSubjectSchedule('MAT', buildSource());

  assert.equal(schedule.S1.A[1].length, 1);
  assert.equal(schedule.S1.A[1][0].teacherNames, 'Jane Doe');
  assert.deepEqual(schedule.S1.A[2], [], 'the Music lesson (day 2) is a different subject');
});

test('buildSubjectSchedule finds a subject taught by multiple teachers across different lessons', () => {
  const source = buildSource({
    lessons: {
      L1: { subjectId: 'MAT', classIds: ['C1'], groupIds: ['groupA'], teacherIds: ['T1'], classroomIds: [] },
      L2: { subjectId: 'MAT', classIds: ['C1'], groupIds: ['groupA'], teacherIds: ['T2'], classroomIds: [] },
    },
  });
  const schedule = buildSubjectSchedule('MAT', source);

  const teachers = [schedule.S1.A[1][0].teacherNames, schedule.S1.A[2][0].teacherNames].sort();
  assert.deepEqual(teachers, ['Jane Doe', 'John Smith']);
});

test('buildRoomSchedule includes only lessons booked into the requested room, with subject and teacher surfaced', () => {
  const schedule = buildRoomSchedule('R1', buildSource());

  assert.equal(schedule.S1.A[1].length, 1);
  assert.equal(schedule.S1.A[1][0].subjectShort, 'MAT');
  assert.equal(schedule.S1.A[1][0].teacherNames, 'Jane Doe');
  assert.deepEqual(schedule.S1.A[2], [], 'the Music lesson (day 2) is booked into a different room');
});

test('buildRoomSchedule respects a card-level room override, same as the class-grid and teacher-schedule builders', () => {
  const source = buildSource({
    cards: [
      { lessonId: 'L1', period: 1, days: '10000', weeks: '11', terms: '11', classroomIds: ['R2'] },
    ],
  });

  assert.equal(buildRoomSchedule('R1', source).S1.A[1].length, 0, 'card override means L1 is NOT in R1 this time');
  assert.equal(buildRoomSchedule('R2', source).S1.A[1].length, 1, 'the card-level override room does get it');
});
