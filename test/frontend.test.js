'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontend } = require('./helpers/loadFrontend');

const { subjectColour, formatTime, rowHeight, densityClass, isNonTeaching } = loadFrontend();

test('subjectColour returns the mapped colour for a known subject code', () => {
  assert.equal(subjectColour('MAT'), '#90caf9');
});

test('subjectColour matches regardless of case — the two XML exports don\'t agree on casing', () => {
  assert.equal(subjectColour('mus'), subjectColour('MUS'));
  assert.equal(subjectColour('Mus'), subjectColour('MUS'));
  assert.equal(subjectColour('bUs'), subjectColour('BUS'));
});

test('subjectColour falls back to a deterministic hash colour for an unknown code', () => {
  const a = subjectColour('SomeNewSubjectNeverSeenBefore');
  const b = subjectColour('SomeNewSubjectNeverSeenBefore');
  assert.equal(a, b, 'the same unknown code must always produce the same colour');
  assert.match(a, /^hsl\(\d+, 48%, 80%\)$/);
});

test('isNonTeaching matches period labels regardless of case', () => {
  assert.ok(isNonTeaching('Lunch Pt 1'));
  assert.ok(isNonTeaching('LUNCH PT 1'));
  assert.ok(isNonTeaching('reg'));
  assert.ok(!isNonTeaching('Period 1'));
});

test('formatTime renders minutes-from-midnight as H:MM, zero-padding minutes', () => {
  assert.equal(formatTime(480), '8:00');
  assert.equal(formatTime(485), '8:05');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(60 * 13 + 5), '13:05');
});

test('rowHeight is 1px per minute with a 32px floor', () => {
  assert.equal(rowHeight(18), 32, 'short periods are floored at 32px');
  assert.equal(rowHeight(65), 65);
});

test('densityClass buckets split count into the right density tier', () => {
  assert.equal(densityClass(1), '');
  assert.equal(densityClass(2), '');
  assert.equal(densityClass(3), 'density-compact');
  assert.equal(densityClass(4), 'density-dense');
  assert.equal(densityClass(5), 'density-dense');
  assert.equal(densityClass(6), 'density-ultra');
  assert.equal(densityClass(10), 'density-ultra');
});
