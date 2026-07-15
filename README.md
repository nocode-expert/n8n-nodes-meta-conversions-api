<picture>
  <source media="(prefers-color-scheme: dark)" srcset="nodes/MetaConversions/conversions.dark.svg">
  <img src="nodes/MetaConversions/conversions.svg" width="56" alt="Meta Conversions API">
</picture>

# Meta Conversions API node for n8n

An n8n community node that sends server-side conversion events to the Meta Conversions API, with the normalization and hashing done correctly.

Install it as `n8n-nodes-meta-conversions-api`. It appears in n8n as **Meta Conversions API**.

[![npm](https://img.shields.io/npm/v/n8n-nodes-meta-conversions-api)](https://www.npmjs.com/package/n8n-nodes-meta-conversions-api)
[![license](https://img.shields.io/npm/l/n8n-nodes-meta-conversions-api)](LICENSE)

Built by [nocode.expert](https://nocode.expert).

---

## Why this exists

The usual way to send conversion events from n8n is a hand built chain: a Crypto node per PII field, a Switch to work out whether the event has a value, a Code node to assemble the payload, and an HTTP Request node with the access token pasted into a query parameter. It works, until it quietly stops working.

That pattern has four failure modes, and all four are invisible in the n8n UI because the platform returns success either way:

1. **Hashes of empty strings.** A Crypto node runs whether or not the field has a value. When `city` is missing you send `SHA256("")`, which is a perfectly well formed hash of nobody.
2. **Normalization that does not match the spec.** Meta wants phone numbers as digits with a country code and no plus sign, US ZIPs cut to five digits but everyone else's postcode left alone, country as lowercase alpha-2, city with the spaces stripped. Lowercasing everything uniformly is not the same thing.
3. **Double hashing.** Hash an already hashed value and the match is silently destroyed.
4. **A token in the workflow JSON.** Export the workflow, share it, commit it, and the token goes with it.

This node handles all four, and turns roughly eighteen nodes into one.

## Install

In n8n, go to **Settings > Community nodes > Install** and enter:

```
n8n-nodes-meta-conversions-api
```

Self hosted, from the command line:

```bash
npm install n8n-nodes-meta-conversions-api
```

## Credentials

Create a **Meta Conversions API** credential:

| Field | Where to get it |
| --- | --- |
| **Access Token** | Events Manager > your dataset > **Settings** > **Generate access token**. Or Business Settings > System Users for a token that does not expire with your personal login. Needs `ads_management`. |
| **API Version** | Defaults to `v23.0`. |

The credential holds the token and nothing else. **Dataset ID is set on the node**, not here, because it is data rather than auth: one token often covers several datasets, and a per-node value can be an expression, so a single workflow can route events to different datasets.

Hit **Test** and the credential resolves the token's owner, which proves the token is valid and unexpired. It does not check access to any particular dataset, since it does not know which one you mean. If a token is valid but not permitted on a given dataset, the node raises that error and names the dataset.

The token lives in n8n's encrypted credential store, not in the workflow JSON. Exporting or sharing the workflow no longer leaks it.

## Quick start

**Webhook > Meta Conversions API.** That is the whole workflow.

| Parameter | What to map |
| --- | --- |
| Dataset ID | Your dataset ID from Events Manager. Map a field instead if one workflow serves several datasets. |
| Event Name | `Subscribe`, or any standard event, or **Custom Event…** |
| Action Source | Website |
| Event Source URL | The page the conversion happened on. Meta requires it for website events. |
| Event ID | Whatever your pixel sends as its `eventID` for the same conversion, usually an order ID. |
| Value | The order value, for events that have one. |
| Customer Information > Email | The customer's email, raw. |
| Customer Information > Phone | The customer's phone, raw, in whatever format you hold it. |
| Customer Information > Fbc | The `_fbc` cookie, or the `fbclid` from the landing URL. |
| Customer Information > Client IP Address | The visitor's IP, from the original request. |
| Customer Information > Client User Agent | The visitor's user agent, from the original request. |

**Map the raw values.** Do not lowercase the email, strip the phone, or hash
anything first. That is the node's job, and it is the job the node exists to do:
Meta's rules are specific, and getting them subtly wrong produces a well-formed
hash of nobody while Meta answers `events_received: 1` all the same.

The last two are the ones people forget. A browser knows the visitor's IP and
user agent; a server-side workflow only knows what the request carried to it, so
both have to survive the trip into your webhook payload. Meta says sending them
"may help improve event matching and could also help improve ad delivery" — and
if the payload never carried them, no mapping can invent them.

### Events with a value, and events without

An event either has a value or it does not, and you should not need a Switch to express that.

Map `Value` to whatever your payload uses. If it resolves to empty, the node omits `custom_data` from the event entirely. If it resolves to a number, the node sends `value` and `currency`. One field covers both cases, so an expression falling back across whichever fields your payload carries is enough.

`0` is treated as a real value and is sent. Empty is treated as no value. A non-numeric value such as `N/A` raises an error rather than being silently sent as `0`, because a conversion booked at zero dollars is worse than one that fails loudly.

`Purchase` is the one standard event where Meta requires a value, so the node refuses to send a `Purchase` without one instead of letting Meta reject it.

## What the node does for you

Every identifier is normalized to Meta's rules before hashing. Fields you leave empty are omitted from the payload, never sent as a hash of an empty string.

| Field | Sent as | Normalization |
| --- | --- | --- |
| Email | `em`, hashed | Trimmed, lowercased. Values that are not emails are dropped. |
| Phone | `ph`, hashed | Digits only, no plus sign, country code required. A national trunk zero is stripped, including the bracketed `+44 (0)7911` form. Set **Default Country Calling Code** and bare national numbers get one. |
| First / Last Name | `fn` / `ln`, hashed | Lowercased, punctuation removed. |
| City | `ct`, hashed | Lowercased, spaces and punctuation removed. |
| State | `st`, hashed | Lowercased alphanumerics. Use the two-letter code for US states. |
| Zip Code | `zp`, hashed | Lowercased. A US ZIP+4 is truncated to five digits; postcodes that are not US zips are left whole. |
| Country | `country`, hashed | Lowercase ISO 3166-1 alpha-2. `usa` or `United States` are dropped rather than sent unmatched. |
| Date of Birth | `db`, hashed | Any parseable date, converted to `YYYYMMDD`. |
| Gender | `ge`, hashed | Reduced to `f` or `m`. |
| External ID | `external_id`, hashed | Trimmed. Keep it stable across events. |
| Client IP Address | `client_ip_address`, raw | Checked as a real IPv4 or IPv6 address, not just IP-shaped text. An `X-Forwarded-For` chain is reduced to the client IP. |
| Client User Agent | `client_user_agent`, raw | Passed through. |
| Fbc | `fbc`, raw | A bare `fbclid` is upgraded to `fb.1.<timestamp>.<fbclid>`. |
| Fbp | `fbp`, raw | Passed through. |

Values that are already SHA-256 hashes are passed through untouched, so you can hash upstream if you prefer and the node will not double hash them. That check runs *before* normalizing, because a normalizer applied to a digest destroys it.

An event with no usable identifier at all is rejected with an error naming the item, rather than being sent to Meta to be counted as unmatched.

## Deduplication

Set **Event ID** to the same value your browser pixel sends and Meta will collapse the two into one conversion. Leave it empty and the node generates `{executionId}-{itemIndex}`, which keeps retries idempotent but will not deduplicate against the pixel.

## Testing before you go live

Set **Options > Test Event Code** to the code from Events Manager > **Test Events**. Events land in the Test Events tab and are not counted as real conversions. Remove it to go live.

## Batching

Off by default, and for a webhook that fires once per lead it changes nothing.

Turn it on when you are bulk loading, for example a Supabase query returning 500 offline conversions. The node then sends them in one request instead of 500, chunked at Meta's limit of 1000 events per request and grouped by dataset.

The tradeoff is Meta's, not this node's: *"If any event you send in a batch is invalid, we reject the entire batch."* One malformed row loses all 500. Leave batching off and a bad row fails on its own while the rest land, which is why off is the default.

## Errors

The node fails on the item that caused the problem and tells you which one, rather than returning `200 OK` and leaving you to find out from a dashboard three days later. Turn on **Settings > Continue on fail** to route failures to a separate branch instead.

Checks that run before anything is sent:

- Event Source URL is present for website events, which Meta requires
- Event Time is not older than 7 days, which Meta rejects for the whole request
- Value is a number, or genuinely empty
- Purchase has a value
- At least one usable identifier survives normalization

## Roadmap

This package integrates one service, which is what n8n's verification guidelines ask for:

> Each package should integrate exactly one third-party service.

Other platforms ship as their own packages under the same brand:

| Platform | Package |
| --- | --- |
| Meta Conversions API | `n8n-nodes-meta-conversions-api` (this one) |
| TikTok Events API | `n8n-nodes-tiktok-events-api` |
| Google Ads | Next |
| Taboola | Planned |

The identifiers you map are named the same in each, so moving a mapping between them is copy and paste. What differs is the normalization on the wire, which is the part worth getting right once per platform.

## Development

```bash
npm install
npm run dev     # runs n8n locally with this node loaded
npm run build
npm run lint
npm test
```

`npm run dev` starts n8n with the node linked, so you can drag it onto a canvas and hit it with a real payload.

The normalization rules are covered by unit tests in [`test/`](test). They assert against the examples in Meta's own documentation, so if Meta changes the spec, the tests are the place to encode it.

## References

- [Conversions API: customer information parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters)
- [Conversions API: server event parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event)
- [Conversions API: using the API](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api)
- [Meta Pixel standard events reference](https://developers.facebook.com/docs/meta-pixel/reference)

## License

[MIT](LICENSE)
