/**
 * Resolves a user-supplied event time to epoch milliseconds.
 *
 * Accepts what people actually have. Meta's API speaks Unix seconds, so that is
 * what upstream payloads usually carry, and `new Date("1784059038")` is an
 * Invalid Date: JavaScript reads a bare numeric string as a date string rather
 * than a timestamp. Anything Date can parse is also accepted, for sources that
 * carry ISO strings.
 */

/** Unix seconds for 2001-09-09, the point where 10-digit second timestamps begin. */
const TEN_DIGIT_SECONDS_MIN = 1_000_000_000;

/** Unix seconds for 2286-11-20, where second timestamps grow to 11 digits. */
const TEN_DIGIT_SECONDS_MAX = 9_999_999_999;

export class EventTimeError extends Error {}

export function parseEventTime(value: unknown, nowMs: number): number {
	if (value === undefined || value === null || String(value).trim() === '') {
		return nowMs;
	}

	// n8n may hand back a Date for a dateTime parameter.
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			throw new EventTimeError('Event Time is not a valid date');
		}
		return value.getTime();
	}

	const raw = String(value).trim();

	// A bare integer is a Unix timestamp, in seconds or milliseconds.
	if (/^\d+$/.test(raw)) {
		const digits = Number(raw);

		if (raw.length === 13) return digits;
		if (raw.length === 10) return digits * 1000;

		// Meta speaks seconds, so an ambiguous integer is read as seconds when it
		// lands in a plausible range, and rejected rather than guessed at otherwise.
		if (digits >= TEN_DIGIT_SECONDS_MIN && digits <= TEN_DIGIT_SECONDS_MAX) {
			return digits * 1000;
		}

		throw new EventTimeError(
			`Event Time "${raw}" is not a recognisable timestamp. Use Unix seconds (10 digits), Unix milliseconds (13 digits), or a date such as 2026-07-14T19:45:42Z.`,
		);
	}

	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		throw new EventTimeError(
			`Event Time "${raw}" is not a valid date. Use Unix seconds, or a date such as 2026-07-14T19:45:42Z. Leave it empty to use the current time.`,
		);
	}

	return parsed.getTime();
}
