const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
	buildMetaEvent,
	buildUserData,
	parseValue,
} = require('../dist/nodes/MetaConversions/meta/buildMetaEvent.js');

const NOW = 1752000000000;

const baseInput = {
	eventName: 'Lead',
	eventTimeMs: NOW,
	actionSource: 'website',
	eventSourceUrl: 'https://example.com/thanks',
	userData: { email: 'jane@example.com' },
};

test('event_time is sent in seconds, not milliseconds', () => {
	const event = buildMetaEvent(baseInput);
	assert.equal(event.event_time, Math.floor(NOW / 1000));
});

test('hashed identifiers are wrapped in arrays', () => {
	const event = buildMetaEvent(baseInput);
	assert.ok(Array.isArray(event.user_data.em));
	assert.equal(event.user_data.em.length, 1);
});

test('absent identifiers are omitted entirely, not sent as empty hashes', () => {
	const userData = buildUserData({ email: 'jane@example.com', city: '', phone: undefined }, NOW);
	assert.ok('em' in userData);
	assert.ok(!('ct' in userData));
	assert.ok(!('ph' in userData));
	assert.deepEqual(Object.keys(userData), ['em']);
});

test('unhashed fields are sent raw', () => {
	const userData = buildUserData(
		{ clientIpAddress: '203.0.113.5', clientUserAgent: 'Mozilla/5.0', fbp: 'fb.1.123.456' },
		NOW,
	);
	assert.equal(userData.client_ip_address, '203.0.113.5');
	assert.equal(userData.client_user_agent, 'Mozilla/5.0');
	assert.equal(userData.fbp, 'fb.1.123.456');
});

test('an event with no value has no custom_data at all', () => {
	const event = buildMetaEvent({ ...baseInput, value: '' });
	assert.ok(!('custom_data' in event));
});

test('an event with a value carries value and currency', () => {
	const event = buildMetaEvent({ ...baseInput, value: '60', currency: 'usd' });
	assert.equal(event.custom_data.value, 60);
	assert.equal(event.custom_data.currency, 'USD');
});

test('a zero value is a real value and is still sent', () => {
	const event = buildMetaEvent({ ...baseInput, value: '0' });
	assert.equal(event.custom_data.value, 0);
});

test('custom data alone produces custom_data without a value key', () => {
	const event = buildMetaEvent({ ...baseInput, customData: { content_name: 'Pricing' } });
	assert.equal(event.custom_data.content_name, 'Pricing');
	assert.ok(!('value' in event.custom_data));
	assert.ok(!('currency' in event.custom_data));
});

test('value parsing tolerates currency formatting from CRM exports', () => {
	assert.equal(parseValue('$1,250.50'), 1250.5);
	assert.equal(parseValue(60), 60);
});

test('empty value means no value, not zero', () => {
	assert.equal(parseValue(''), undefined);
	assert.equal(parseValue('   '), undefined);
	assert.equal(parseValue(undefined), undefined);
});

test('a non-numeric value is surfaced instead of being sent as zero', () => {
	assert.throws(() => parseValue('N/A'), /not a number/);
});

test('limited data use sets the documented processing options', () => {
	const event = buildMetaEvent({ ...baseInput, limitedDataUse: true, lduCountry: 1, lduState: 1000 });
	assert.deepEqual(event.data_processing_options, ['LDU']);
	assert.equal(event.data_processing_options_country, 1);
	assert.equal(event.data_processing_options_state, 1000);
});

test('limited data use is absent unless asked for', () => {
	const event = buildMetaEvent(baseInput);
	assert.ok(!('data_processing_options' in event));
});

test('optional keys stay absent when not supplied', () => {
	const event = buildMetaEvent({ ...baseInput, eventSourceUrl: undefined });
	assert.ok(!('event_source_url' in event));
	assert.ok(!('event_id' in event));
	assert.ok(!('opt_out' in event));
	assert.ok(!('referrer_url' in event));
});

test('a bare fbclid becomes a valid fbc using the event time', () => {
	const event = buildMetaEvent({ ...baseInput, userData: { fbc: 'IwAR2xyz' } });
	assert.equal(event.user_data.fbc, `fb.1.${NOW}.IwAR2xyz`);
});

// ---------------------------------------------------------------------------
// Pre-hashed identifiers. Regression: the digest check used to run inside
// hashNormalized, i.e. AFTER the normalizer had already destroyed the digest.
// normalizeEmail dropped it for having no "@", and normalizePhone kept only the
// digits of the hex and hashed that. Meta answers events_received: 1 either way,
// so both failures were invisible from the response.
// ---------------------------------------------------------------------------

test('a pre-hashed email is passed through, not dropped', () => {
	const digest = createHash('sha256').update('jsmith@example.com').digest('hex');
	const userData = buildUserData({ email: digest }, Date.now());
	assert.deepEqual(userData.em, [digest]);
});

test('a pre-hashed phone is passed through, not re-hashed from its own digits', () => {
	const digest = createHash('sha256').update('12133734253').digest('hex');
	const userData = buildUserData({ phone: digest }, Date.now());
	assert.deepEqual(userData.ph, [digest]);
});

test('a pre-hashed identifier is accepted in upper case and lowercased', () => {
	const digest = createHash('sha256').update('jsmith@example.com').digest('hex');
	const userData = buildUserData({ email: digest.toUpperCase() }, Date.now());
	assert.deepEqual(userData.em, [digest]);
});

test('every hashable identifier accepts a pre-hashed value', () => {
	const digest = createHash('sha256').update('anything').digest('hex');
	const userData = buildUserData(
		{
			email: digest,
			phone: digest,
			firstName: digest,
			lastName: digest,
			city: digest,
			state: digest,
			zip: digest,
			country: digest,
			dateOfBirth: digest,
			gender: digest,
			externalId: digest,
		},
		Date.now(),
	);
	for (const key of ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'db', 'ge', 'external_id']) {
		assert.deepEqual(userData[key], [digest], `${key} should pass the digest through untouched`);
	}
});

test('a raw value is still normalized and hashed, not mistaken for a digest', () => {
	const userData = buildUserData({ email: ' JSmith@Example.COM ' }, Date.now());
	assert.deepEqual(userData.em, [createHash('sha256').update('jsmith@example.com').digest('hex')]);
});

// ---------------------------------------------------------------------------
// Value parsing. It used to strip every non-numeric character, which turned a
// mis-mapped field into a fabricated amount instead of an error: "12abc34"
// booked as 1234. The README promised the opposite.
// ---------------------------------------------------------------------------

test('a value with letters in it raises rather than being salvaged', () => {
	assert.throws(() => parseValue('12abc34'), /is not a number/);
	assert.throws(() => parseValue('N/A'), /is not a number/);
	assert.throws(() => parseValue('unknown'), /is not a number/);
});

test('an ambiguous european decimal raises rather than being guessed at', () => {
	// 1.234,56 is 1234.56 in Berlin and nonsense elsewhere. Stripping punctuation
	// silently booked it as 1.23456.
	assert.throws(() => parseValue('1.234,56'), /is not a number/);
});

test('the money formats a CRM actually exports still parse', () => {
	assert.equal(parseValue('60'), 60);
	assert.equal(parseValue('60.50'), 60.5);
	assert.equal(parseValue('$60.50'), 60.5);
	assert.equal(parseValue('$1,234.56'), 1234.56);
	assert.equal(parseValue(' 60 '), 60);
	assert.equal(parseValue('-25'), -25);
});

test('zero is a value and empty is not', () => {
	assert.equal(parseValue('0'), 0);
	assert.equal(parseValue(''), undefined);
	assert.equal(parseValue('   '), undefined);
	assert.equal(parseValue(undefined), undefined);
});
