import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	CUSTOM_EVENT_OPTION,
	META_EVENTS_REQUIRING_VALUE,
	metaFields,
} from './meta/MetaFields';
import {
	buildMetaEvent,
	META_RESERVED_CUSTOM_DATA_KEYS,
	parseValue,
} from './meta/buildMetaEvent';
import type { MetaServerEvent, MetaUserDataInput } from './meta/buildMetaEvent';
import { parseEventTime } from './shared/parseEventTime';

/** Meta accepts at most 1000 events in one request. */
const META_MAX_EVENTS_PER_REQUEST = 1000;

/** Meta rejects events with an event_time older than 7 days. */
const META_MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface MetaSendGroup {
	datasetId: string;
	apiVersion: string;
	testEventCode?: string;
	events: MetaServerEvent[];
	itemIndexes: number[];
	/**
	 * Batching is opt-in per item, so a group batches only if every item in it
	 * asked to. Anything else would let one item's setting silently change how
	 * another item is sent.
	 */
	batch: boolean;
}

export class MetaConversions implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Meta Conversions API',
		// The internal name is what workflows reference. It stays stable across
		// display name changes, or every existing workflow breaks. Changing it is
		// free only because nothing has been published yet.
		name: 'metaConversions',
		icon: { light: 'file:conversions.svg', dark: 'file:conversions.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{ $parameter["eventName"] === "__custom" ? $parameter["customEventName"] : $parameter["eventName"] }}',
		description: 'Send server-side conversion events to the Meta Conversions API',
		defaults: {
			name: 'Meta Conversions API',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'metaConversionsApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Send Event',
						value: 'sendEvent',
						description: 'Send a conversion event',
						action: 'Send conversion event',
					},
				],
				default: 'sendEvent',
			},
			...metaFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('metaConversionsApi');
		const credentialApiVersion = (credentials.apiVersion as string) || 'v23.0';

		// Items can target different datasets when Dataset ID is an expression, so
		// group by the fields that must match for events to share one request.
		const groups = new Map<string, MetaSendGroup>();

		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as IDataObject;

				let eventName = this.getNodeParameter('eventName', i) as string;
				if (eventName === CUSTOM_EVENT_OPTION) {
					eventName = (this.getNodeParameter('customEventName', i, '') as string).trim();
					if (eventName === '') {
						throw new NodeOperationError(this.getNode(), 'Custom Event Name is empty', {
							itemIndex: i,
							description: 'Choose a standard event, or type the name of your custom event.',
						});
					}
				}

				const datasetId = (this.getNodeParameter('datasetId', i, '') as string).trim();
				if (datasetId === '') {
					throw new NodeOperationError(this.getNode(), 'Dataset ID is empty', {
						itemIndex: i,
						description:
							'Set the Dataset ID from Events Manager, or map it from your input data.',
					});
				}

				const actionSource = this.getNodeParameter('actionSource', i) as string;
				const eventSourceUrl = (
					this.getNodeParameter('eventSourceUrl', i, '') as string
				).trim();

				// Meta requires event_source_url for website events.
				if (actionSource === 'website' && eventSourceUrl === '') {
					throw new NodeOperationError(this.getNode(), 'Event Source URL is empty', {
						itemIndex: i,
						description:
							'Meta requires an Event Source URL for events with Action Source "Website". Map the page URL, or change Action Source.',
					});
				}

				const rawValue = this.getNodeParameter('value', i, '') as string;
				let value: number | undefined;
				try {
					value = parseValue(rawValue);
				} catch (error) {
					throw new NodeOperationError(this.getNode(), (error as Error).message, {
						itemIndex: i,
						description:
							'Value must be a number, or empty for events that carry no value.',
					});
				}

				// Purchase is the only standard event where Meta requires value and currency.
				if (value === undefined && META_EVENTS_REQUIRING_VALUE.includes(eventName)) {
					throw new NodeOperationError(
						this.getNode(),
						`Meta requires a value for the ${eventName} event`,
						{
							itemIndex: i,
							description: 'Map a Value, or use a different event name.',
						},
					);
				}

				const eventTimeMs = resolveEventTime.call(this, i);

				const userData = this.getNodeParameter('userData', i, {}) as MetaUserDataInput;

				const customDataParam = this.getNodeParameter('customData', i, {}) as {
					property?: Array<{ name: string; value: string }>;
				};
				const customData: IDataObject = {};
				for (const prop of customDataParam.property ?? []) {
					const name = prop.name?.trim();
					if (!name) continue;

					// Meta ignores these when nested in custom_data, so setting one here
					// looks like it worked and does nothing.
					const setBy = META_RESERVED_CUSTOM_DATA_KEYS[name];
					if (setBy) {
						throw new NodeOperationError(
							this.getNode(),
							`"${name}" is not a custom data property`,
							{
								itemIndex: i,
								description: `Meta reads ${name} from the top of the event, not from custom_data, and ignores it when nested there. Remove this custom data property and use ${setBy} instead.`,
							},
						);
					}

					customData[name] = prop.value;
				}

				const event = buildMetaEvent({
					eventName,
					eventTimeMs,
					eventId: (this.getNodeParameter('eventId', i, '') as string).trim() || undefined,
					eventSourceUrl: eventSourceUrl || undefined,
					actionSource,
					value: rawValue,
					currency: this.getNodeParameter('currency', i, 'USD') as string,
					userData,
					customData,
					optOut: options.optOut as boolean | undefined,
					referrerUrl: options.referrerUrl as string | undefined,
					limitedDataUse: options.limitedDataUse as boolean | undefined,
					lduCountry: options.lduCountry as number | undefined,
					lduState: options.lduState as number | undefined,
					defaultCountryCallingCode: options.defaultCountryCallingCode as string | undefined,
				});

				// An event with no identifiers cannot be attributed to anyone.
				if (Object.keys(event.user_data).length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'Event has no customer information to match on',
						{
							itemIndex: i,
							description:
								'Map at least one identifier under Customer Information, such as Email, Phone, fbc or Client IP Address. Values that failed validation are dropped, so check the format of what you mapped.',
						},
					);
				}

				// event_id is what deduplicates against the browser pixel. Falling back to
				// the execution ID keeps retries idempotent when nothing else is mapped.
				if (!event.event_id) {
					event.event_id = `${this.getExecutionId()}-${i}`;
				}

				const apiVersion = ((options.apiVersion as string) || credentialApiVersion).trim();
				const testEventCode = ((options.testEventCode as string) ?? '').trim() || undefined;

				const itemWantsBatch = (options.batch as boolean) ?? false;

				const groupKey = `${datasetId}|${apiVersion}|${testEventCode ?? ''}`;
				const group = groups.get(groupKey);
				if (group) {
					group.events.push(event);
					group.itemIndexes.push(i);
					group.batch = group.batch && itemWantsBatch;
				} else {
					groups.set(groupKey, {
						datasetId,
						apiVersion,
						testEventCode,
						events: [event],
						itemIndexes: [i],
						batch: itemWantsBatch,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Carries over the guidance from the validation errors raised above,
				// and pins the failure to the item that caused it.
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
					description: (error as NodeOperationError).description ?? undefined,
				});
			}
		}

		for (const group of groups.values()) {
			// Meta rejects an entire batch if any event in it is invalid, so chunking
			// also limits the blast radius of one bad event.
			const chunkSize = group.batch ? META_MAX_EVENTS_PER_REQUEST : 1;

			for (let start = 0; start < group.events.length; start += chunkSize) {
				const chunk = group.events.slice(start, start + chunkSize);
				const chunkIndexes = group.itemIndexes.slice(start, start + chunkSize);

				// Form encoded, with `data` as a JSON string. This is the format Meta
				// documents (curl -F) and the format its official SDKs send.
				//
				// Meta also accepts an application/json body. Both are believed to work;
				// this follows the documented shape rather than the tolerated one.
				const form = new URLSearchParams();
				form.append('data', JSON.stringify(chunk));
				if (group.testEventCode) form.append('test_event_code', group.testEventCode);

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: `https://graph.facebook.com/${group.apiVersion}/${group.datasetId}/events`,
					body: form,
				};

				try {
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'metaConversionsApi',
						requestOptions,
					)) as IDataObject;

					for (let c = 0; c < chunk.length; c++) {
						returnData.push({
							json: {
								...response,
								dataset_id: group.datasetId,
								// test_event_code is a main body parameter rather than part of
								// the event, so it is surfaced here. Without it there is no way
								// to tell from the output whether this counted as a real
								// conversion or landed in Test Events.
								...(group.testEventCode ? { test_event_code: group.testEventCode } : {}),
								event: chunk[c] as unknown as IDataObject,
							},
							pairedItem: { item: chunkIndexes[c] },
						});
					}
				} catch (error) {
					if (this.continueOnFail()) {
						for (let c = 0; c < chunk.length; c++) {
							returnData.push({
								json: {
									error: (error as Error).message,
									dataset_id: group.datasetId,
									...(group.testEventCode ? { test_event_code: group.testEventCode } : {}),
									event: chunk[c] as unknown as IDataObject,
								},
								pairedItem: { item: chunkIndexes[c] },
							});
						}
						continue;
					}
					throw new NodeApiError(this.getNode(), error as JsonObject, {
						itemIndex: chunkIndexes[0],
						description:
							chunk.length > 1
								? 'Meta rejects the whole batch if any event in it is invalid. Turn off Batch Events in Options to find the event at fault.'
								: undefined,
					});
				}
			}
		}

		return [returnData];
	}
}

/**
 * Resolves event_time, defaulting to now. Meta rejects the entire request when
 * any event is older than 7 days, so that is caught here with a message that
 * names the offending item.
 */
function resolveEventTime(this: IExecuteFunctions, itemIndex: number): number {
	const raw = this.getNodeParameter('eventTime', itemIndex, '');

	let eventTimeMs: number;
	try {
		eventTimeMs = parseEventTime(raw, Date.now());
	} catch (error) {
		throw new NodeOperationError(this.getNode(), (error as Error).message, {
			itemIndex,
			description: 'Leave Event Time empty to use the current time.',
		});
	}

	if (Date.now() - eventTimeMs > META_MAX_EVENT_AGE_MS) {
		throw new NodeOperationError(
			this.getNode(),
			`Event Time is more than 7 days in the past, which Meta rejects`,
			{
				itemIndex,
				description: `Meta returns an error for the whole request if any event_time is older than 7 days. The value was ${new Date(eventTimeMs).toISOString()}.`,
			},
		);
	}

	return eventTimeMs;
}
