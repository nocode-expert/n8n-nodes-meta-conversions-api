/**
 * Parses a user-supplied conversion value.
 *
 * The contract:
 *  - Empty means "this event has no value". The caller omits the value and the
 *    currency entirely rather than sending 0.
 *  - 0 means zero. It is a real value and is sent.
 *  - Anything that is not a number raises, naming the item, rather than being
 *    coerced. A conversion booked at a fabricated amount is worse than one that
 *    fails loudly, because nothing downstream will ever flag it.
 */
export function parseConversionValue(value: string | number | undefined): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

	const trimmed = value.trim();
	if (trimmed === '') return undefined;

	// Tolerates what a CRM export actually carries -- a leading currency symbol,
	// spaces, thousands separators -- and rejects everything else.
	//
	// Stripping every non-numeric character instead was worse than useless: it
	// turned "12abc34" into 1234, and the European "1.234,56" into 1.23456, then
	// booked the conversion at that number. A mis-mapped field became a
	// fabricated amount, silently.
	const cleaned = trimmed
		// Whitespace, including the non-breaking space spreadsheets love.
		.replace(/[\s\u00a0]/g, '')
		// A leading currency symbol or code: $, €, £, ¥, ₹, USD.
		.replace(/^[^\d.-]+/, '')
		// Thousands separators, only where one actually belongs.
		.replace(/,(?=\d{3}(\D|$))/g, '');

	// Whatever survives must be a plain number and nothing else. "1.234,56" does
	// not: its comma is a decimal separator, and guessing which convention the
	// sender meant would be inventing an amount.
	if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
		throw new Error(`Value "${value}" is not a number`);
	}

	const parsed = Number(cleaned);
	if (!Number.isFinite(parsed)) throw new Error(`Value "${value}" is not a number`);
	return parsed;
}
