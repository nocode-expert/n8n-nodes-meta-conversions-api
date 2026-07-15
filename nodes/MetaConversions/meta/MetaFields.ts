import type { INodeProperties } from 'n8n-workflow';

/**
 * Standard events per the Meta Pixel reference:
 * https://developers.facebook.com/docs/meta-pixel/reference
 *
 * PageView is included because it is accepted by the Conversions API and is
 * commonly sent server-side, even though the reference lists it apart from the
 * 17 standard conversion events.
 */
export const META_STANDARD_EVENTS = [
	'AddPaymentInfo',
	'AddToCart',
	'AddToWishlist',
	'CompleteRegistration',
	'Contact',
	'CustomizeProduct',
	'Donate',
	'FindLocation',
	'InitiateCheckout',
	'Lead',
	'PageView',
	'Purchase',
	'Schedule',
	'Search',
	'StartTrial',
	'SubmitApplication',
	'Subscribe',
	'ViewContent',
] as const;

/** Purchase is the only standard event where Meta requires value and currency. */
export const META_EVENTS_REQUIRING_VALUE: string[] = ['Purchase'];

export const DEFAULT_EVENT_NAME = 'Lead';

/**
 * Every field on the node.
 *
 * Map raw values here: normalization and SHA-256 hashing to Meta's spec are the
 * node's job, and the reason it exists. Doing them upstream is how match quality
 * quietly breaks, because Meta answers events_received: 1 either way.
 */

export const CUSTOM_EVENT_OPTION = '__custom';

export const metaFields: INodeProperties[] = [
	{
		displayName: 'Dataset ID',
		name: 'datasetId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 1234567890123456',
		description:
			'The dataset the event is written to, from Events Manager under Data sources. Formerly called the pixel ID. Supports an expression, so one workflow can route events to several datasets.',
	},
	{
		displayName: 'Event Name',
		name: 'eventName',
		type: 'options',
		options: [
			...META_STANDARD_EVENTS.map((event) => ({ name: event, value: event })),
			{ name: 'Custom Event…', value: CUSTOM_EVENT_OPTION },
		],
		default: DEFAULT_EVENT_NAME,
		required: true,
		description:
			'The standard event to report. Choose Custom Event to send an event name of your own.',
	},
	{
		displayName: 'Custom Event Name',
		name: 'customEventName',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'QualifiedLead',
		description:
			'The custom event name to report. Must match the name in Events Manager exactly, including case.',
		displayOptions: { show: { eventName: [CUSTOM_EVENT_OPTION] } },
	},

	// ---- Platform-specific, because the concept does not exist elsewhere ----
	{
		displayName: 'Action Source',
		name: 'actionSource',
		type: 'options',
		default: 'website',
		required: true,
		description:
			'Where the conversion happened. Must match the dataset type: an offline dataset will not show website events.',
		options: [
			{ name: 'App', value: 'app' },
			{ name: 'Business Messaging', value: 'business_messaging' },
			{ name: 'Chat', value: 'chat' },
			{ name: 'Email', value: 'email' },
			{ name: 'Other', value: 'other' },
			{ name: 'Phone Call', value: 'phone_call' },
			{ name: 'Physical Store', value: 'physical_store' },
			{ name: 'System Generated', value: 'system_generated' },
			{ name: 'Website', value: 'website' },
		],
	},
	{
		displayName: 'Event Source URL',
		name: 'eventSourceUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/thank-you',
		description: 'The page the event happened on. Meta requires it for website events.',
		displayOptions: { show: { actionSource: ['website'] } },
	},

	// ---- Shared again ----
	{
		displayName: 'Event ID',
		name: 'eventId',
		type: 'string',
		default: '',
		description:
			'Deduplication key against the browser pixel. Use whatever the pixel sends for the same event. Leave empty and the node generates one from the execution ID, which is idempotent on retry but will not deduplicate against the pixel.',
	},
	{
		displayName: 'Event Time',
		name: 'eventTime',
		type: 'string',
		default: '',
		placeholder: 'e.g. 1784059038',
		description:
			'When the event happened. Accepts Unix seconds, Unix milliseconds, or an ISO date. Leave empty for now. Meta rejects the whole request if any event is over 7 days old.',
	},
	{
		displayName: 'Value',
		name: 'value',
		type: 'string',
		default: '',
		placeholder: 'e.g. 60',
		description:
			'Monetary value of the conversion. Leave empty to send no value at all. 0 is sent as a real value. Meta requires it for Purchase.',
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'string',
		default: 'USD',
		description: 'ISO 4217 code for Value, for example USD. Only sent when Value is set.',
	},
	{
		displayName: 'Customer Information',
		name: 'userData',
		type: 'collection',
		placeholder: 'Add Identifier',
		default: {},
		description:
			'Map raw values. Each is normalized to Meta’s rules and SHA-256 hashed where Meta requires it. Fields left empty are omitted rather than sent as a hash of an empty string, which is a well-formed hash of nobody.',
		// Alphabetized by name, which n8n's lint requires.
		options: [
			{
				displayName: 'City',
				name: 'city',
				type: 'string',
				default: '',
				description: 'Hashed',
			},
			{
				displayName: 'Client IP Address',
				name: 'clientIpAddress',
				type: 'string',
				default: '',
				description:
					'Public IP of the browser, IPv4 or IPv6. Sent raw. An X-Forwarded-For chain is reduced to the client IP.',
			},
			{
				displayName: 'Client User Agent',
				name: 'clientUserAgent',
				type: 'string',
				default: '',
				description: 'User agent from the user’s device. Sent raw.',
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				description: 'Lowercase ISO 3166-1 alpha-2, hashed',
			},
			{
				displayName: 'Date of Birth',
				name: 'dateOfBirth',
				type: 'string',
				default: '',
				description: 'Hashed as YYYYMMDD',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Trimmed, lowercased, then SHA-256 hashed',
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				description: 'Your stable user ID. Trimmed, then SHA-256 hashed. Keep it consistent across events.',
			},
			{
				displayName: 'Fbc (Click ID)',
				name: 'fbc',
				type: 'string',
				default: '',
				description: 'The _fbc cookie. A bare fbclid is upgraded to Meta’s fb.1.&lt;time&gt;.&lt;fbclid&gt; format. Sent raw.',
			},
			{
				displayName: 'Fbp (Cookie ID)',
				name: 'fbp',
				type: 'string',
				default: '',
				description: 'The _fbp cookie. Sent raw.',
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				description: 'Hashed',
			},
			{
				displayName: 'Gender',
				name: 'gender',
				type: 'string',
				default: '',
				description: 'Reduced to f or m, then hashed',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				description: 'Hashed',
			},
			{
				displayName: 'Lead ID',
				name: 'leadId',
				type: 'string',
				default: '',
				description: 'Meta lead ad ID. Sent raw.',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				description:
					'Normalized to Meta’s format, then hashed: digits only, with a country code and no plus sign. A number with no country code needs Default Country Calling Code, or it is dropped rather than guessed at.',
			},
			{
				displayName: 'State',
				name: 'state',
				type: 'string',
				default: '',
				description: 'Hashed. Two-letter ANSI code for US states.',
			},
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'string',
				default: '',
				description: 'Your subscription ID for this user. Sent raw.',
			},
			{
				displayName: 'Zip Code',
				name: 'zip',
				type: 'string',
				default: '',
				description: 'Hashed. US ZIP+4 is truncated to five digits.',
			},
		],
	},
	{
		displayName: 'Custom Data',
		name: 'customData',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Property',
		default: {},
		description:
			'Extra properties sent inside custom_data, such as content_name or content_id. Values are sent as-is.',
		options: [
			{
				name: 'property',
				displayName: 'Property',
				values: [
					{ displayName: 'Name', name: 'name', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		// Alphabetized by name, which n8n's lint requires.
		options: [
			{
				displayName: 'Action Source URL Referrer',
				name: 'referrerUrl',
				type: 'string',
				default: '',
				description: 'The HTTP referrer of the page that triggered the event',
			},
			{
				displayName: 'API Version',
				name: 'apiVersion',
				type: 'string',
				default: '',
				placeholder: 'e.g. v23.0',
				description: 'Overrides the Graph API version from the credential',
			},
			{
				displayName: 'Batch Events',
				name: 'batch',
				type: 'boolean',
				default: false,
				description:
					'Whether to send all input items in one request, up to Meta’s limit of 1000, grouped by dataset. Off by default: Meta rejects the entire batch if any single event is invalid.',
			},
			{
				displayName: 'Default Country Calling Code',
				name: 'defaultCountryCallingCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1',
				description:
					'Prepended to phone numbers that arrive without a country code. Without it, a bare national number is dropped rather than guessed at, because a wrong guess hashes to a value that matches nobody.',
			},
			{
				displayName: 'Limited Data Use',
				name: 'limitedDataUse',
				type: 'boolean',
				default: false,
				description: 'Whether to apply Meta’s LDU flag',
			},
			{
				displayName: 'Limited Data Use Country',
				name: 'lduCountry',
				type: 'number',
				default: 0,
				description: 'Country for LDU. 0 lets Meta infer it from the IP.',
				displayOptions: { show: { limitedDataUse: [true] } },
			},
			{
				displayName: 'Limited Data Use State',
				name: 'lduState',
				type: 'number',
				default: 0,
				description: 'State for LDU. 0 lets Meta infer it from the IP.',
				displayOptions: { show: { limitedDataUse: [true] } },
			},
			{
				displayName: 'Opt Out',
				name: 'optOut',
				type: 'boolean',
				default: false,
				description:
					'Whether to use the event for attribution only, not for delivery optimisation',
			},
			{
				displayName: 'Test Event Code',
				name: 'testEventCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. TEST12345',
				description:
					'Routes the event to Test Events instead of counting it as a real conversion. Find it in Events Manager, under your dataset. The code is per-dataset. Remove it before going live, or your conversions will never be counted.',
			},
		],
	},
];
