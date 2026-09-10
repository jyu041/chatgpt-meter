# Release Checklist

## Code

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] Firefox and Chromium builds succeed
- [ ] `npm run zip:firefox` and `npm run zip:chrome` succeed
- [ ] Working tree is clean

## Privacy and Security

- [ ] Run a history-aware secret scan
- [ ] Inspect generated permissions
- [ ] Confirm no real conversation fixture or capture exists
- [ ] Review `PRIVACY.md` and `SECURITY.md`
- [ ] Confirm Firefox `data_collection_permissions` declaration

## Firefox Manual Tests

- [ ] Normal conversation
- [ ] Large paginated conversation
- [ ] Automatic post-response refresh
- [ ] Conversation navigation
- [ ] Project chat
- [ ] Prepare handoff without automatic submission
- [ ] Dark and light themes
- [ ] Settings persistence
- [ ] Regenerated response

## Chromium Manual Tests

- [ ] Normal conversation and core refresh behavior
- [ ] Navigation and handoff behavior

## GitHub

- [ ] Review commit email/privacy
- [ ] Set repository description and topics
- [ ] Enable security features
- [ ] Make repository public only after final scan
- [ ] Tag `v0.1.0` only after manual validation

## Stores

- [ ] Original icon
- [ ] Screenshots without private content
- [ ] Privacy-policy URL
- [ ] AMO source package
- [ ] Chrome listing disclosures
