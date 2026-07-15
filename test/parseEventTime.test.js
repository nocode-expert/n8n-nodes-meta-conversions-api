const test = require('node:test');
const assert = require('node:assert/strict');

const {
	parseEventTime,
	EventTimeError,
} = require('../dist/nodes/MetaConversions/shared/parseEventTime.js');

const NOW = 1784059038000;

test('empty means now', () => {
	assert.equal(parseEventTime('', NOW), NOW);
	assert.equal(parseEventTime(undefined, NOW), NOW);
	assert.equal(parseEventTime(null, NOW), NOW);
	assert.equal(parseEventTime('   ', NOW), NOW);
});

test('a Unix timestamp in seconds is accepted', () => {
	// The format Meta's API speaks, and what upstream payloads carry.
	// new Date('1784059038') is an Invalid Date, which is the bug this guards.
	assert.equal(parseEventTime('1784059038', NOW), 1784059038000);
	assert.equal(parseEventTime(1784059038, NOW), 1784059038000);
});

test('a Unix timestamp in milliseconds is accepted', () => {
	assert.equal(parseEventTime('1784059038000', NOW), 1784059038000);
	assert.equal(parseEventTime(1784059038000, NOW), 1784059038000);
});

test('seconds and milliseconds resolve to the same instant', () => {
	assert.equal(parseEventTime('1784059038', NOW), parseEventTime('1784059038000', NOW));
});

test('an ISO date is accepted', () => {
	assert.equal(parseEventTime('2026-07-14T19:57:18Z', NOW), Date.parse('2026-07-14T19:57:18Z'));
});

test('a Date instance is accepted, as n8n may supply one', () => {
	const d = new Date(NOW);
	assert.equal(parseEventTime(d, NOW), NOW);
});

test('an invalid Date instance is rejected', () => {
	assert.throws(() => parseEventTime(new Date('nope'), NOW), EventTimeError);
});

test('a non-date string is rejected with guidance', () => {
	assert.throws(() => parseEventTime('yesterday', NOW), /not a valid date/);
	assert.throws(() => parseEventTime('N/A', NOW), /not a valid date/);
});

test('an integer too small to be a timestamp is rejected rather than guessed at', () => {
	// 20260714 looks like a date, and reading it as seconds would silently mean 1970.
	assert.throws(() => parseEventTime('20260714', NOW), /not a recognisable timestamp/);
	assert.throws(() => parseEventTime('0', NOW), /not a recognisable timestamp/);
});

test('the error names the offending value', () => {
	assert.throws(() => parseEventTime('yesterday', NOW), /yesterday/);
});
