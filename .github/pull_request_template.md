## What this changes

<!-- One or two sentences. What behaviour is different after this PR? -->

## Why

<!-- Link the issue if there is one. If this is a spec change, link the platform
     documentation page that says so. Claims about platform behaviour need a citation. -->

## What breaks if this is wrong

<!-- The most useful section for a reviewer. If this mis-normalizes a field,
     what happens downstream? Silent match quality loss? Rejected events? -->

## How it was verified

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] Added or updated tests covering this change
- [ ] Tested against a real dataset using a Test Event Code

<!-- If you tested against Test Events, say what you saw arrive. -->

## Checklist

- [ ] No access tokens, dataset IDs, or personal data anywhere in the diff
- [ ] Absent values are omitted, not sent as placeholders or empty hashes
- [ ] Comments explain why, and cite the spec where a rule comes from one
