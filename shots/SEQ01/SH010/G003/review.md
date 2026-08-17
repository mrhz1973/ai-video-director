# G003 / V3 review

Date: 2026-08-17
Verdict: partial approval, not final

## Approved

- Facial identity and realism are the strongest so far.
- Medium-close frame-right composition is successful.
- Radio equipment, microphone and hut remain readable.
- Performance is restrained.
- Eyes move before the final head turn.

## Rejected

- Tattoo artwork, scale and position do not match the exact reference.
- Artificial hair appears on torso and arms.
- Head is too large relative to torso.
- Shoulder width and body scale are reduced.

## Root cause

The body reference and prompt did not separate reference roles strongly enough. The prompt named the tattoo design and used body hair as a positive feature, inviting invention. Cropped views did not provide a reliable head/neck/shoulder proportional bridge.

## Decision

Use V3 only as face, framing, environment and performance evidence. Create a new Element with a role-separated hairless lateral body reference and exact tattoo close-up. Do not rerun the V3 prompt unchanged.

