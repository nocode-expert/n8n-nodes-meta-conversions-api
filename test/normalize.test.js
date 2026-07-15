const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
	normalizeEmail,
	normalizePhone,
	normalizeName,
	normalizeCity,
	normalizeState,
	normalizeZip,
	normalizeCountry,
	normalizeGender,
	normalizeDateOfBirth,
	normalizeIp,
	normalizeFbc,
	hashNormalized,
	isSha256Hex,
	sha256,
} = require('../dist/nodes/MetaConversions/shared/normalize.js');

const SHA256_OF_EMPTY_STRING =
	'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('email is trimmed and lowercased', () => {
	assert.equal(normalizeEmail('  JSmith@Example.COM '), 'jsmith@example.com');
});

test('email that is not an email is dropped rather than hashed', () => {
	assert.equal(normalizeEmail('n/a'), undefined);
	assert.equal(normalizeEmail(''), undefined);
	assert.equal(normalizeEmail('   '), undefined);
	assert.equal(normalizeEmail(undefined), undefined);
});

test('phone keeps digits only and strips leading zeros', () => {
	// Meta's own example of a correctly formatted US number.
	assert.equal(normalizePhone('+1 (650) 555-1212'), '16505551212');
	assert.equal(normalizePhone('001 650 555 1212'), '16505551212');
});

test('phone without a country code gets the configured default', () => {
	assert.equal(normalizePhone('6505551212', '1'), '16505551212');
	assert.equal(normalizePhone('(650) 555-1212', '+1'), '16505551212');
});

test('phone that already has a plus is not given a second country code', () => {
	assert.equal(normalizePhone('+44 7700 900123', '1'), '447700900123');
});

test('phone too short to dial is dropped', () => {
	assert.equal(normalizePhone('12345'), undefined);
	assert.equal(normalizePhone('N/A'), undefined);
});

test('name is lowercased with punctuation removed', () => {
	assert.equal(normalizeName("O'Brien"), 'obrien');
	assert.equal(normalizeName('  Anne-Marie '), 'anne-marie');
	assert.equal(normalizeName('Dr. Smith'), 'dr smith');
});

test('city removes spaces and punctuation', () => {
	assert.equal(normalizeCity('San Francisco'), 'sanfrancisco');
	assert.equal(normalizeCity("Coeur d'Alene"), 'coeurdalene');
});

test('state is lowercased alphanumerics', () => {
	assert.equal(normalizeState('TX'), 'tx');
	assert.equal(normalizeState('  ca '), 'ca');
});

test('US zip is truncated to the first five digits', () => {
	assert.equal(normalizeZip('94025-1234'), '94025');
	assert.equal(normalizeZip('94025'), '94025');
});

test('non-US postcode keeps its alphanumerics without spaces', () => {
	assert.equal(normalizeZip('SW1A 1AA'), 'sw1a1aa');
});

test('country must be alpha-2 or it is dropped', () => {
	assert.equal(normalizeCountry('US'), 'us');
	assert.equal(normalizeCountry('  us '), 'us');
	// "usa" and "United States" would never match, so they are not sent.
	assert.equal(normalizeCountry('usa'), undefined);
	assert.equal(normalizeCountry('United States'), undefined);
});

test('gender is reduced to a single lowercase initial', () => {
	assert.equal(normalizeGender('Female'), 'f');
	assert.equal(normalizeGender('m'), 'm');
	assert.equal(normalizeGender('unknown'), undefined);
});

test('date of birth becomes YYYYMMDD', () => {
	assert.equal(normalizeDateOfBirth('1990-04-23'), '19900423');
	assert.equal(normalizeDateOfBirth('19900423'), '19900423');
});

test('date of birth uses UTC so a timezone cannot shift the day', () => {
	assert.equal(normalizeDateOfBirth('1990-04-23T00:30:00Z'), '19900423');
});

test('implausible date of birth is dropped', () => {
	assert.equal(normalizeDateOfBirth('1850-01-01'), undefined);
	assert.equal(normalizeDateOfBirth('not a date'), undefined);
});

test('ip accepts v4 and v6 and drops anything else', () => {
	assert.equal(normalizeIp('203.0.113.5'), '203.0.113.5');
	assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
	assert.equal(normalizeIp('999.1.1.1'), undefined);
	assert.equal(normalizeIp('unknown'), undefined);
});

test('ip takes the client address from an X-Forwarded-For chain', () => {
	assert.equal(normalizeIp('203.0.113.5, 70.41.3.18'), '203.0.113.5');
});

test('a bare fbclid is upgraded to the fbc format Meta expects', () => {
	assert.equal(normalizeFbc('IwAR2xyz', 1700000000000), 'fb.1.1700000000000.IwAR2xyz');
});

test('an already formatted fbc is passed through untouched', () => {
	const fbc = 'fb.1.1699999999999.IwAR2xyz';
	assert.equal(normalizeFbc(fbc, 1700000000000), fbc);
});

test('hashNormalized never returns the hash of an empty string', () => {
	assert.equal(hashNormalized(undefined), undefined);
	assert.notEqual(hashNormalized(normalizeEmail('')), SHA256_OF_EMPTY_STRING);
	assert.equal(hashNormalized(normalizeEmail('')), undefined);
});

test('hash matches a SHA-256 computed independently', () => {
	const expected = createHash('sha256').update('jsmith@example.com', 'utf8').digest('hex');
	assert.equal(hashNormalized(normalizeEmail('JSmith@example.com ')), expected);
});

test('an already hashed value is passed through, never double hashed', () => {
	const alreadyHashed = sha256('jsmith@example.com');
	assert.ok(isSha256Hex(alreadyHashed));
	assert.equal(hashNormalized(alreadyHashed), alreadyHashed);
	assert.notEqual(hashNormalized(alreadyHashed), sha256(alreadyHashed));
});


// ---------------------------------------------------------------------------
// Regressions found by an independent audit, 2026-07-15. Every one produced a
// well-formed hash of the wrong string: the platform answers success, the event
// matches nobody, and nothing surfaces the mistake. They are pinned here per
// case rather than in one test, so a failure names the country it breaks.
// ---------------------------------------------------------------------------

test('date of birth does not shift a day in timezones east of UTC', () => {
	// "April 23, 1990" parses as LOCAL midnight; reading UTC parts off it landed
	// on the 22nd for every user in India, Europe and APAC.
	const original = process.env.TZ;
	try {
		for (const tz of ['UTC', 'Asia/Kolkata', 'Australia/Sydney', 'America/New_York']) {
			process.env.TZ = tz;
			assert.equal(normalizeDateOfBirth('April 23, 1990'), '19900423', `wrong in ${tz}`);
		}
	} finally {
		process.env.TZ = original;
	}
});

test('an ISO date of birth is read literally, not through a timezone', () => {
	assert.equal(normalizeDateOfBirth('1990-04-23'), '19900423');
});

test('non-US postcodes are not truncated to five digits', () => {
	assert.equal(normalizeZip('110001'), '110001', 'India');
	assert.equal(normalizeZip('018956'), '018956', 'Singapore');
	assert.equal(normalizeZip('1500002'), '1500002', 'Japan');
});

test('US zips keep Meta\'s five-digit rule', () => {
	assert.equal(normalizeZip('90210'), '90210');
	assert.equal(normalizeZip('90210-1234'), '90210', 'ZIP+4 with a dash');
	assert.equal(normalizeZip('902101234'), '90210', 'ZIP+4 without a dash');
});

test('a trunk zero is stripped before the country code', () => {
	// 07911 dialled from abroad is +44 7911, never +44 07911. Keeping the zero
	// hashes a number nobody has.
	assert.equal(normalizePhone('07911123456', '44'), '447911123456');
});

test('a national number keeps its country code when it opens with the same digits', () => {
	// An Indian mobile can legitimately start 91, so testing whether the number
	// already opens with its country code mistakes it for an international one.
	assert.equal(normalizePhone('9198765432', '91'), '919198765432');
});

test('a national number longer than ten digits still gets its country code', () => {
	// German numbers are 11 digits after the trunk zero, which a length-only
	// rule dropped on the floor.
	assert.equal(normalizePhone('015123456789', '49'), '4915123456789');
});

test('a number that already carries its country code is not given a second one', () => {
	assert.equal(normalizePhone('447911123456', '44'), '447911123456');
});


test('a bracketed trunk zero is dropped, not embedded', () => {
	// "+44 (0)7911 123456" is how much of Europe writes a number. Stripping only
	// a leading zero left +44 0 7911..., which is nobody's number.
	assert.equal(normalizePhone('+44 (0)7911 123456'), '447911123456');
	assert.equal(normalizePhone('+49 (0) 151 23456789'), '4915123456789');
});

test('an explicit country code is trusted over a length guess', () => {
	// A Chinese mobile is 11 digits, which a length-only rule read as already
	// carrying a country code it did not have.
	assert.equal(normalizePhone('13800000000', '86'), '8613800000000');
	// ...while a number that already opens with its code AND is too long to be
	// national is left alone.
	assert.equal(normalizePhone('447911123456', '44'), '447911123456');
});
