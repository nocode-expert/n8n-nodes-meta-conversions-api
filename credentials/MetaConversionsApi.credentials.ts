import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class MetaConversionsApi implements ICredentialType {
	name = 'metaConversionsApi';

	displayName = 'Meta Conversions API';

	icon: Icon = { light: 'file:conversions.svg', dark: 'file:conversions.dark.svg' };

	// Drives the "Need help filling out these fields? Read our docs" link in the
	// credential modal. Points at our own token guide rather than Meta's: the
	// question people actually have here is which of Meta's five token types to
	// use, and Meta's own docs do not answer that in one place.
	documentationUrl = 'https://nocode.expert/docs/n8n/meta-conversions-api/access-token';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'System user access token with the ads_management permission. Generate one in Events Manager under Settings, or in Business Settings under System Users.',
		},
		{
			displayName: 'API Version',
			name: 'apiVersion',
			type: 'string',
			default: 'v23.0',
			description: 'Graph API version to call, for example v23.0',
		},
	];

	// Meta accepts the token as a query parameter on Graph API requests.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			qs: {
				access_token: '={{ $credentials.accessToken }}',
			},
		},
	};

	/**
	 * Resolves the token's owner. This proves the token is valid and unexpired,
	 * which is all a credential can prove on its own.
	 *
	 * It deliberately does not check access to a dataset: the dataset is per-event
	 * data that belongs on the node, not auth, and a single token often covers
	 * many datasets. A token that is valid here but not permitted on a given
	 * dataset surfaces as an error on the node, naming that dataset.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '=https://graph.facebook.com/{{ $credentials.apiVersion || "v23.0" }}',
			url: '/me',
			method: 'GET',
			qs: {
				fields: 'id',
			},
		},
	};
}
