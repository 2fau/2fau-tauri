# Manual checks

Automated tests cover the vault, storage, and menu construction. These behaviours
involve real Chrome surfaces and cannot be verified headlessly — run them before
calling a change done, and report the actual outcome.

Load: `pnpm --filter @twofau/extension build`, then `chrome://extensions` →
Developer mode → Load unpacked → `apps/twofau-extension/dist`.

- [ ] First run shows "Create a passphrase"; a vault is created.
- [ ] Adding an `otpauth://` URI by paste produces a code that rotates.
- [ ] Reopening the popup keeps the vault unlocked.
- [ ] `chrome.storage.sync.get(console.log)` in the service-worker console shows
      only `vault.manifest` and `v*.chunk.*` — nothing readable.
- [ ] Right-click on a normal page → 2FAU → an account copies its code; the
      badge flashes green.
- [ ] The same works on a `chrome://extensions` tab (offscreen clipboard path).
- [ ] While locked, the submenu holds one disabled "Locked" item.
- [ ] `Ctrl+Shift+U` / `Cmd+Shift+U` opens the popup.
- [ ] Auto-lock: set it to 1 minute in Options, wait, confirm the popup asks for
      the passphrase again.
- [ ] Options: export the vault, change the passphrase, confirm the old one is
      rejected, re-import the exported file with the old passphrase, accounts survive.
- [ ] Two browsers signed into the same Chrome profile: add an account in each
      while both are unlocked, confirm both accounts survive (revision guard).
- [ ] QR capture: open a live 2FA enrolment page, open the popup, use the scan
      action, confirm the account is added. (Task 11 spike confirmed the popup
      button carries the `activeTab` grant — 2026-07-23.)
