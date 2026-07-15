import { parseConversionValue } from '../shared/parseValue';
import {
	hashIdentifier,
	normalizeCity,
	normalizeCountry,
	normalizeDateOfBirth,
	normalizeEmail,
	normalizeExternalId,
	normalizeFbc,
	normalizeGender,
	normalizeIp,
	normalizeName,
	normalizePhone,
	normalizeRaw,
	normalizeState,
	normalizeZip,
} from '../shared/normalize';

/** Re-exported under the name the node and tests already use. */
export const parseValue = parseConversionValue;

export interface MetaUserDataInput {
	email?: string;
	phone?: string;
	firstName?: string;
	lastName?: string;
	city?: string;
	state?: string;
	zip?: string;
	country?: string;
	dateOfBirth?: string;
	gender?: string;
	externalId?: string;
	clientIpAddress?: string;
	clientUserAgent?: string;
	fbc?: string;
	fbp?: string;
	leadId?: string;
	subscriptionId?: string;
}

export interface BuildMetaEventInput {
	eventName: string;
	eventTimeMs: number;
	eventId?: string;
	eventSourceUrl?: string;
	actionSource: string;
	value?: string | number;
	currency?: string;
	userData: MetaUserDataInput;
	customData?: Record<string, unknown>;
	optOut?: boolean;
	referrerUrl?: string;
	limitedDataUse?: boolean;
	lduCountry?: number;
	lduState?: number;
	defaultCountryCallingCode?: string;
}

export interface MetaServerEvent {
	event_name: string;
	event_time: number;
	action_source: string;
	user_data: Record<string, unknown>;
	event_id?: string;
	event_source_url?: string;
	custom_data?: Record<string, unknown>;
	opt_out?: boolean;
	referrer_url?: string;
	data_processing_options?: string[];
	data_processing_options_country?: number;
	data_processing_options_state?: number;
}

/**
 * Server event parameters that live at the top of the event, not inside
 * custom_data. Meta silently ignores these when they are nested, so a value set
 * here would do nothing at all: the event still sends, Meta still returns
 * events_received, and the setting the user believed they applied is absent.
 *
 * Each entry names the node option that actually sets it.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
 */
export const META_RESERVED_CUSTOM_DATA_KEYS: Record<string, string> = {
	action_source: 'the Action Source option',
	event_name: 'the Event Name option',
	event_time: 'the Event Time option',
	event_id: 'the Event ID option',
	event_source_url: 'the Event Source URL option',
	user_data: 'the Customer Information section',
	custom_data: 'the Custom Data section itself',
	opt_out: 'the Opt Out option',
	referrer_url: 'the Action Source URL Referrer option',
	data_processing_options: 'the Limited Data Use option',
	data_processing_options_country: 'the Limited Data Use Country option',
	data_processing_options_state: 'the Limited Data Use State option',
};

/** Assigns only when the value carries signal, so absent keys stay absent. */
function setIfPresent(
	target: Record<string, unknown>,
	key: string,
	value: string | undefined,
): void {
	if (value !== undefined) target[key] = value;
}

/**
 * Meta expects hashed identifiers as arrays, which lets one event carry several
 * values for the same key (for example two emails for one person).
 */
function setHashed(
	target: Record<string, unknown>,
	key: string,
	hashed: string | undefined,
): void {
	if (hashed !== undefined) target[key] = [hashed];
}


/** Builds the user_data object, hashing and normalizing per Meta's rules. */
export function buildUserData(
	input: MetaUserDataInput,
	eventTimeMs: number,
	defaultCountryCallingCode?: string,
): Record<string, unknown> {
	const userData: Record<string, unknown> = {};

	// hashIdentifier, not normalize-then-hash: a value that is already a digest
	// must skip the normalizer, which would otherwise destroy it.
	setHashed(userData, 'em', hashIdentifier(input.email, normalizeEmail));
	setHashed(
		userData,
		'ph',
		hashIdentifier(input.phone, (value) => normalizePhone(value, defaultCountryCallingCode)),
	);
	setHashed(userData, 'fn', hashIdentifier(input.firstName, normalizeName));
	setHashed(userData, 'ln', hashIdentifier(input.lastName, normalizeName));
	setHashed(userData, 'ct', hashIdentifier(input.city, normalizeCity));
	setHashed(userData, 'st', hashIdentifier(input.state, normalizeState));
	setHashed(userData, 'zp', hashIdentifier(input.zip, normalizeZip));
	setHashed(userData, 'country', hashIdentifier(input.country, normalizeCountry));
	setHashed(userData, 'db', hashIdentifier(input.dateOfBirth, normalizeDateOfBirth));
	setHashed(userData, 'ge', hashIdentifier(input.gender, normalizeGender));
	setHashed(userData, 'external_id', hashIdentifier(input.externalId, normalizeExternalId));

	// Sent unhashed per Meta's reference.
	setIfPresent(userData, 'client_ip_address', normalizeIp(input.clientIpAddress));
	setIfPresent(userData, 'client_user_agent', normalizeRaw(input.clientUserAgent));
	setIfPresent(userData, 'fbc', normalizeFbc(input.fbc, eventTimeMs));
	setIfPresent(userData, 'fbp', normalizeRaw(input.fbp));
	setIfPresent(userData, 'lead_id', normalizeRaw(input.leadId));
	setIfPresent(userData, 'subscription_id', normalizeRaw(input.subscriptionId));

	return userData;
}

/**
 * Builds one Conversions API server event.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
 */
export function buildMetaEvent(input: BuildMetaEventInput): MetaServerEvent {
	const userData = buildUserData(input.userData, input.eventTimeMs, input.defaultCountryCallingCode);

	const event: MetaServerEvent = {
		event_name: input.eventName,
		// Meta wants seconds, not milliseconds.
		event_time: Math.floor(input.eventTimeMs / 1000),
		action_source: input.actionSource,
		user_data: userData,
	};

	if (input.eventId) event.event_id = input.eventId;
	if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
	if (input.referrerUrl) event.referrer_url = input.referrerUrl;
	if (input.optOut) event.opt_out = true;

	const customData: Record<string, unknown> = { ...(input.customData ?? {}) };

	// The whole point: an event either has a value or it does not.
	const value = parseValue(input.value);
	if (value !== undefined) {
		customData.value = value;
		customData.currency = (input.currency ?? 'USD').trim().toUpperCase();
	}

	if (Object.keys(customData).length > 0) event.custom_data = customData;

	if (input.limitedDataUse) {
		event.data_processing_options = ['LDU'];
		event.data_processing_options_country = input.lduCountry ?? 0;
		event.data_processing_options_state = input.lduState ?? 0;
	}

	return event;
}
