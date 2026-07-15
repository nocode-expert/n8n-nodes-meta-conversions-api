import { createHash } from 'crypto';

/**
 * Normalization + SHA-256 hashing for advertising platform customer information.
 *
 * Rules follow Meta's Customer Information Parameters reference:
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 *
 * Every normalizer returns undefined for input that carries no signal, so the
 * caller can omit the key entirely rather than send a hash of an empty string.
 * SHA-256('') is a valid-looking digest that matches no real person.
 */

/** True when a value is absent or would normalize to nothing. */
function isBlank(value: unknown): boolean {
	return value === undefined || value === null || String(value).trim() === '';
}

/** SHA-256 hex digest. Input must already be normalized. */
export function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Detects an already-hashed value so we never double-hash. Meta accepts
 * pre-hashed identifiers, and re-hashing a digest silently destroys the match.
 */
export function isSha256Hex(value: string): boolean {
	return /^[a-f0-9]{64}$/i.test(value.trim());
}

/** "Trim any leading and trailing spaces. Convert all characters to lowercase." */
export function normalizeEmail(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const email = String(value).trim().toLowerCase();
	// A value without a local@domain shape is a data-entry artifact, not an email.
	if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) return undefined;
	return email;
}

/**
 * "Remove symbols, letters, and any leading zeros. Phone numbers must include a
 * country code" (e.g. 16505551212 for US).
 *
 * defaultCountryCode is prepended when the number is a bare national number, as
 * a phone without a country code will not match.
 */
export function normalizePhone(value: unknown, defaultCountryCode?: string): string | undefined {
	if (isBlank(value)) return undefined;

	const raw = String(value).trim();
	const hadPlus = raw.startsWith('+');
	// "+44 (0)7911 123456" is a standard European display format: the bracketed
	// zero is the national trunk prefix, to be dropped when dialling from
	// abroad. Left in, it becomes +4407911123456, which is nobody's number.
	const allDigits = raw.replace(/\(\s*0\s*\)/g, '').replace(/\D+/g, '');
	// A leading zero is a national trunk prefix, not part of the number: 07911
	// dialled from abroad is +44 7911, never +44 07911.
	const hadTrunkZero = /^0/.test(allDigits);
	let digits = allDigits.replace(/^0+/, '');
	if (digits === '') return undefined;

	const cc = (defaultCountryCode ?? '').replace(/\D+/g, '');
	if (!hadPlus && cc !== '' && needsCountryCode(digits, hadTrunkZero, cc)) {
		digits = `${cc}${digits}`;
	}

	// Shorter than this cannot be a dialable international number.
	if (digits.length < 7) return undefined;
	return digits;
}

/**
 * Whether a number with no leading + is missing its country code.
 *
 * There is no certain answer without a full numbering-plan database, and this
 * package ships no dependencies on purpose, so this is a heuristic. Its failure
 * modes are chosen deliberately, and it leans on the fact that the caller told
 * us the country: Default Country Calling Code is an explicit statement, not a
 * guess, so it is trusted unless the number visibly disagrees.
 *
 *  - A trunk zero is decisive. Nothing international starts with one, so the
 *    number is national. This is what makes UK (07911123456) and German
 *    (015123456789) numbers work, which a length rule alone gets wrong: both
 *    exceed 10 digits once the zero is stripped.
 *  - A number that already opens with the country code AND is longer than any
 *    national number already carries it; prepending would corrupt it.
 *  - Anything else is national and gets the code.
 *
 * Length alone was wrong in both directions. It dropped the code from every
 * national number over ten digits, and on numbers that merely start with their
 * own country code (an Indian mobile beginning 91) it skipped a code that was
 * genuinely missing. Both hash to values matching nobody, and every platform
 * answers success regardless.
 */
function needsCountryCode(
	digitsWithoutTrunkZero: string,
	hadTrunkZero: boolean,
	countryCode: string,
): boolean {
	if (hadTrunkZero) return true;
	// Longer than any national number and starting with the code: it is already
	// international. A Chinese mobile is 11 digits, so a length-only rule read
	// every one of them as already carrying a code they did not have.
	if (countryCode !== '' && digitsWithoutTrunkZero.startsWith(countryCode)) {
		return digitsWithoutTrunkZero.length <= 10;
	}
	return true;
}

/** "Lowercase only with no punctuation." Applies to first and last name. */
export function normalizeName(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const name = String(value)
		.trim()
		.toLowerCase()
		// Strip punctuation but keep letters in any script (Meta requires UTF-8
		// encoding for non-Roman characters, not transliteration).
		.replace(/[.,'"`^*!?()[\]{}<>:;|\\/_+=~$%#@&\d]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return name === '' ? undefined : name;
}

/** "Lowercase only with no punctuation, no special characters, and no spaces." */
export function normalizeCity(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const city = String(value)
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '');
	return city === '' ? undefined : city;
}

/**
 * "Use the 2-character ANSI abbreviation code in lowercase" for US states;
 * outside the US "lowercase with no punctuation, no special characters, and no
 * spaces."
 *
 * A full state name is passed through normalized rather than guessed at, since
 * mapping names to codes needs a lookup table this package will not ship.
 */
export function normalizeState(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const state = String(value)
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '');
	return state === '' ? undefined : state;
}

/**
 * "Use lowercase with no spaces and no dash. Use only the first 5 digits for
 * U.S. zip codes."
 *
 * ZIP+4 is truncated at the dash. Non-US postcodes keep their alphanumerics.
 */
export function normalizeZip(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const zip = String(value).trim().toLowerCase().split('-')[0].replace(/[^a-z0-9]/g, '');
	if (zip === '') return undefined;

	// "Use only the first 5 digits for U.S. zip codes" -- for US zips, which is
	// the part that matters. A US zip is exactly 5 digits, or 9 as ZIP+4 written
	// without its dash; nothing else is one.
	//
	// Truncating every numeric postcode to 5 instead would corrupt most of the
	// world: 110001 (India) became 11000, 018956 (Singapore) became 01895,
	// 1500002 (Japan) became 15000. Each of those hashes to a value matching
	// nobody, and Meta answers events_received: 1 regardless.
	if (/^\d{9}$/.test(zip)) return zip.slice(0, 5);
	return zip;
}

/** "Use the lowercase, 2-letter country codes in ISO 3166-1 alpha-2." */
export function normalizeCountry(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const country = String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z]/g, '');
	// Anything other than alpha-2 (e.g. "usa", "United States") would not match,
	// so it is dropped rather than sent as a bad identifier.
	if (country.length !== 2) return undefined;
	return country;
}

/** "Accept gender in the form of an initial in lowercase": f or m. */
export function normalizeGender(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const gender = String(value).trim().toLowerCase();
	if (gender.startsWith('f')) return 'f';
	if (gender.startsWith('m')) return 'm';
	return undefined;
}

/**
 * "Year: Use the YYYY format from 1900 to current year. Month: MM format 01-12.
 * Date: DD format 01-31." Result is YYYYMMDD.
 */
export function normalizeDateOfBirth(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	const raw = String(value).trim();

	// Already YYYYMMDD.
	const compact = raw.replace(/\D+/g, '');
	if (/^\d{8}$/.test(compact) && isPlausibleDob(compact)) return compact;

	// A plain calendar date, read literally. Date's own parsing is the trap here:
	// it treats "1990-04-23" as UTC midnight but "April 23, 1990" as LOCAL
	// midnight, so no single choice of getUTC*/get* is right for both. Reading
	// the digits out directly sidesteps the question entirely.
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
	if (iso) {
		const formatted = `${iso[1]}${iso[2]}${iso[3]}`;
		return isPlausibleDob(formatted) ? formatted : undefined;
	}

	// Anything else Date can parse (RFC strings, ISO with a time or a zone).
	//
	// Local parts, not UTC. A bare date string parses as local midnight, so
	// taking UTC parts moved the birthday a day earlier for every user east of
	// UTC: "April 23, 1990" hashed as 19900422 in India, Europe and APAC, and
	// matched nobody. A date carrying an explicit zone still resolves correctly
	// because Date has already applied the offset.
	const parsed = new Date(raw);
	if (!Number.isNaN(parsed.getTime())) {
		const yyyy = String(parsed.getFullYear()).padStart(4, '0');
		const mm = String(parsed.getMonth() + 1).padStart(2, '0');
		const dd = String(parsed.getDate()).padStart(2, '0');
		const formatted = `${yyyy}${mm}${dd}`;
		if (isPlausibleDob(formatted)) return formatted;
	}

	return undefined;
}

function isPlausibleDob(yyyymmdd: string): boolean {
	const year = Number(yyyymmdd.slice(0, 4));
	const month = Number(yyyymmdd.slice(4, 6));
	const day = Number(yyyymmdd.slice(6, 8));
	if (year < 1900 || year > new Date().getUTCFullYear()) return false;
	if (month < 1 || month > 12) return false;
	if (day < 1 || day > 31) return false;
	return true;
}

/** external_id is hashed but has no prescribed normalization beyond consistency. */
export function normalizeExternalId(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	return String(value).trim();
}

/**
 * "Must be a valid IPV4 or IPV6 address." Never hashed. An invalid address is
 * dropped, since Meta rejects malformed values.
 */
export function normalizeIp(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	// An X-Forwarded-For chain carries the client IP first.
	const ip = String(value).trim().split(',')[0].trim();
	if (ip === '') return undefined;

	const ipv4 =
		/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

	if (ipv4.test(ip)) return ip;
	if (isIpv6(ip)) return ip;
	return undefined;
}

/**
 * Structural IPv6 check: group count and :: compression, not just the alphabet.
 *
 * A character-class test is not a check. ":::" and "abc:def" are both made only
 * of hex and colons, and both used to pass; Meta rejects a malformed address, so
 * a permissive test here bounces the whole event rather than dropping one field.
 */
function isIpv6(value: string): boolean {
	// A zone index (%eth0) is legal and not part of the address itself.
	const address = value.split('%')[0];
	if (address === '' || !address.includes(':')) return false;
	// "::" compresses one run of zero groups. More than one is ambiguous, and
	// ":::" is not compression at all.
	if (address.includes(':::')) return false;
	const halves = address.split('::');
	if (halves.length > 2) return false;

	const compressed = halves.length === 2;
	const groups: string[] = [];
	for (const half of halves) {
		if (half === '') continue;
		groups.push(...half.split(':'));
	}

	// The last group may be a dotted IPv4, which occupies two groups' worth.
	let width = groups.length;
	const last = groups[groups.length - 1];
	if (last !== undefined && last.includes('.')) {
		if (!/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(last)) {
			return false;
		}
		groups.pop();
		width += 1;
	}

	if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return false;
	// Eight groups uncompressed; fewer only if "::" stands in for the rest.
	return compressed ? width < 8 : width === 8;
}

/** Plain passthrough for values that are sent raw: user agent, fbp, lead_id. */
export function normalizeRaw(value: unknown): string | undefined {
	if (isBlank(value)) return undefined;
	return String(value).trim();
}

/**
 * fbc format: "fb.${subdomain_index}.${creation_time}.${fbclid}".
 * A bare fbclid is upgraded into that format, since passing the raw click id
 * would not match. eventTimeMs stands in for click time when it is unknown.
 */
export function normalizeFbc(value: unknown, eventTimeMs: number): string | undefined {
	if (isBlank(value)) return undefined;
	const raw = String(value).trim();
	if (/^fb\.\d+\.\d+\..+/.test(raw)) return raw;
	return `fb.1.${eventTimeMs}.${raw}`;
}

/**
 * Hash unless the caller already supplied a digest. Returns undefined for blank
 * input so the key can be omitted.
 *
 * Prefer hashIdentifier for user input: by the time a value reaches here it has
 * already been through a normalizer, and the normalizers destroy digests.
 */
export function hashNormalized(normalized: string | undefined): string | undefined {
	if (normalized === undefined) return undefined;
	if (isSha256Hex(normalized)) return normalized.toLowerCase();
	return sha256(normalized);
}

/**
 * Normalizes and hashes one identifier, checking for an already-hashed value
 * BEFORE normalizing.
 *
 * The order matters, and getting it wrong is silent. A normalizer applied to a
 * digest destroys it: normalizeEmail drops it for having no "@", and
 * normalizePhone strips the letters out of the hex and keeps the digits, which
 * then get hashed into a value matching nobody. Both platforms answer with
 * success either way, so the damage is invisible from the response.
 */
export function hashIdentifier(
	raw: unknown,
	normalizer: (value: unknown) => string | undefined,
): string | undefined {
	if (isBlank(raw)) return undefined;
	const trimmed = String(raw).trim();
	if (isSha256Hex(trimmed)) return trimmed.toLowerCase();
	return hashNormalized(normalizer(trimmed));
}
