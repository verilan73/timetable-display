'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCode, toPlain } = require('./helpers/loadCode');

const { weekEntriesFor, cardMatchesWeekTerm } = loadCode();

test('weekEntriesFor("AB") returns the MSSS Week A/B bit pairs', () => {
  assert.deepEqual(toPlain(weekEntriesFor('AB')), [['A', '10'], ['B', '01']]);
});

test('weekEntriesFor("single") returns the JS universal-bit pair', () => {
  assert.deepEqual(toPlain(weekEntriesFor('single')), [['single', '11']]);
});

test('cardMatchesWeekTerm requires both week and term bits to match', () => {
  assert.ok(cardMatchesWeekTerm({ weeks: '10', terms: '10' }, '10', '10'));
  assert.ok(!cardMatchesWeekTerm({ weeks: '01', terms: '10' }, '10', '10'), 'wrong week');
  assert.ok(!cardMatchesWeekTerm({ weeks: '10', terms: '01' }, '10', '10'), 'wrong term');
});

test('cardMatchesWeekTerm treats "11" on either field as a wildcard', () => {
  assert.ok(cardMatchesWeekTerm({ weeks: '11', terms: '11' }, '10', '10'),
    'JS single-week cards (normalised to "11") match every week/term combination');
  assert.ok(cardMatchesWeekTerm({ weeks: '11', terms: '10' }, '10', '10'),
    'a "11" week matches regardless of the requested weekBit, independent of the term field');
  assert.ok(cardMatchesWeekTerm({ weeks: '10', terms: '11' }, '10', '01'),
    'a "11" term matches regardless of the requested termBit, independent of the week field');
});
