# Explicit non-goals

Stated plainly so scope doesn't quietly creep during the build:

- **No real Account Aggregator integration of any kind.** No code calling a
  real AA/Sahamati endpoint anywhere in this repo - confirmed impossible on
  this timeline (see `docs/DATA_SCHEMA.md`, "Disclosure").
- **No conversational "AI CFO" chat interface.** Out of scope, a different
  product (see the QED "AI CFO" line in the VC-research alignment table).
- **No crypto/stablecoin rails.**
- **No invented company names, partnerships, certifications, or
  statistics** anywhere in the UI, docs, or demo copy beyond what's in the
  planning doc and these docs.
- **No deepfake/identity-fraud detection** ("Proving You're Human" YC
  thesis) - AA consent is identity-linked, but that's incidental, not a
  feature we build.

If a task seems to call for any of the above, stop and flag it rather than
building it.
