const test = require('node:test');
const assert = require('node:assert/strict');

const {
	MetaConversions,
} = require('../dist/nodes/MetaConversions/MetaConversions.node.js');

/**
 * These tests cover how the request goes on the wire, not how the payload is
 * built. Every unit test can pass while the request itself is shaped wrongly,
 * because Meta answers events_received: 1 to a great deal it does not act on.
 *
 * The wire format follows what Meta documents (curl -F) and what its official
 * SDKs send. Meta also accepts an application/json body.
 */

function makeContext(params, capture) {
	return {
		getInputData: () => [{ json: {} }],
		getCredentials: async () => ({ apiVersion: 'v23.0' }),
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'Meta Conversions API' }),
		getExecutionId: () => 'exec-1',
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: {
				call: async (_ctx, _credName, options) => {
					capture.options = options;
					capture.credentialName = _credName;
					return { events_received: 1, fbtrace_id: 'TRACE' };
				},
			},
		},
	};
}

const baseParams = {
	operation: 'sendEvent',
	datasetId: '123456789',
	eventName: 'Schedule',
	actionSource: 'website',
	eventSourceUrl: 'https://example.com/thanks',
	eventId: 'evt-1',
	eventTime: '',
	value: '',
	currency: 'USD',
	userData: { email: 'test@gmail.com' },
	customData: {},
	options: {},
};

async function run(params) {
	const capture = {};
	const ctx = makeContext(params, capture);
	const output = await MetaConversions.prototype.execute.call(ctx);
	return { capture, output };
}

test('the request body is form encoded, not a JSON body', async () => {
	const { capture } = await run(baseParams);
	// Meta documents curl -F and its SDKs send form encoded, so that is the shape
	// this node follows.
	assert.ok(
		capture.options.body instanceof URLSearchParams,
		'body must be URLSearchParams so it is sent as application/x-www-form-urlencoded',
	);
});

test('data is sent as a JSON encoded string', async () => {
	const { capture } = await run(baseParams);
	const data = capture.options.body.get('data');
	assert.equal(typeof data, 'string');
	const parsed = JSON.parse(data);
	assert.ok(Array.isArray(parsed));
	assert.equal(parsed[0].event_name, 'Schedule');
});

test('test_event_code is its own form field, never nested inside data', async () => {
	const { capture } = await run({
		...baseParams,
		options: { testEventCode: 'TEST87463' },
	});

	assert.equal(capture.options.body.get('test_event_code'), 'TEST87463');

	// It is a main body parameter, a sibling of data. Nesting it inside an event
	// would mean it is ignored and the event counts as a real conversion.
	const parsed = JSON.parse(capture.options.body.get('data'));
	assert.ok(!('test_event_code' in parsed[0]));
});

test('no test_event_code field is sent when none is configured', async () => {
	const { capture } = await run(baseParams);
	assert.equal(capture.options.body.get('test_event_code'), null);
});

test('the request posts to the dataset events endpoint on the configured version', async () => {
	const { capture } = await run(baseParams);
	assert.equal(capture.options.method, 'POST');
	assert.equal(capture.options.url, 'https://graph.facebook.com/v23.0/123456789/events');
});

test('the node authenticates through the credential rather than a token in the URL', async () => {
	const { capture } = await run(baseParams);
	assert.equal(capture.credentialName, 'metaConversionsApi');
	assert.ok(!capture.options.url.includes('access_token'));
});

test('test_event_code is reported in the output so a test send is distinguishable', async () => {
	const { output } = await run({ ...baseParams, options: { testEventCode: 'TEST87463' } });
	assert.equal(output[0][0].json.test_event_code, 'TEST87463');
	assert.equal(output[0][0].json.events_received, 1);
});

test('events for different datasets are sent in separate requests', async () => {
	const capture = { calls: [] };
	const ctx = {
		...makeContext(baseParams, {}),
		getInputData: () => [{ json: {} }, { json: {} }],
		// Simulates Dataset ID mapped to an expression that differs per item.
		getNodeParameter: (name, i, fallback) => {
			if (name === 'datasetId') return i === 0 ? 'dataset-a' : 'dataset-b';
			return name in baseParams ? baseParams[name] : fallback;
		},
		helpers: {
			httpRequestWithAuthentication: {
				call: async (_ctx, _credName, options) => {
					capture.calls.push(options.url);
					return { events_received: 1, fbtrace_id: 'TRACE' };
				},
			},
		},
	};

	await MetaConversions.prototype.execute.call(ctx);

	assert.equal(capture.calls.length, 2);
	assert.ok(capture.calls.some((u) => u.includes('dataset-a')));
	assert.ok(capture.calls.some((u) => u.includes('dataset-b')));
});

test('a reserved server event parameter in Custom Data is rejected, not silently nested', async () => {
	// Meta ignores action_source inside custom_data, so accepting it would mean
	// the user sets a value, the event sends, Meta returns events_received, and
	// the setting does nothing.
	await assert.rejects(
		run({
			...baseParams,
			customData: { property: [{ name: 'action_source', value: 'physical_store' }] },
		}),
		/is not a custom data property/,
	);
});

test('the rejection points at the option that actually sets it', async () => {
	await assert.rejects(
		run({
			...baseParams,
			customData: { property: [{ name: 'event_name', value: 'Purchase' }] },
		}),
		/event_name/,
	);
});

test('ordinary custom data properties still pass through', async () => {
	const { capture } = await run({
		...baseParams,
		customData: { property: [{ name: 'content_name', value: 'Pricing' }] },
	});
	const parsed = JSON.parse(capture.options.body.get('data'));
	assert.equal(parsed[0].custom_data.content_name, 'Pricing');
});

// ---------------------------------------------------------------------------
// The node's field names and the builder's interface are joined by an unchecked
// cast, so TypeScript cannot catch a rename on one side. The TikTok twin had
// exactly this: its interface said `ip`/`userAgent` while the fields supplied
// `clientIpAddress`/`clientUserAgent`, so every event went out without them and
// the platform still answered success. Unit tests missed it because they call
// the builder directly with the interface's names. This drives execute instead,
// and asserts the values reach the wire.
// ---------------------------------------------------------------------------

test('identifiers mapped on the node survive the trip to the wire', async () => {
	let sent;
	const params = {
		eventName: 'Lead',
		datasetId: '1234567890123456',
		actionSource: 'website',
		eventSourceUrl: 'https://example.com/thanks',
		value: '',
		currency: 'USD',
		eventId: '12345',
		eventTime: '',
		customData: {},
		options: {},
		userData: {
			email: 'test@example.com',
			clientIpAddress: '254.254.254.254',
			clientUserAgent: 'Mozilla/5.0',
		},
	};
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'Meta Conversions API' }),
		getExecutionId: () => 'exec',
		continueOnFail: () => false,
		getCredentials: async () => ({ apiVersion: 'v23.0' }),
		helpers: {
			httpRequestWithAuthentication: async function (_cred, options) {
				sent = options;
				return { events_received: 1 };
			},
		},
	};

	await MetaConversions.prototype.execute.call(ctx);
	const event = JSON.parse(new URLSearchParams(sent.body).get('data'))[0];

	assert.ok(event.user_data.em, 'email should reach the wire');
	assert.equal(event.user_data.client_ip_address, '254.254.254.254', 'IP should reach the wire');
	assert.equal(event.user_data.client_user_agent, 'Mozilla/5.0', 'user agent should reach the wire');
});
