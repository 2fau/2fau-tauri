# Sub-project 2 — Shared React UI (design)

**Date:** 2026-07-02
**Status:** Approved
**Part of:** 2FAU cross-platform Tauri 2 rewrite. Depends on sub-projects 0–1.

## Goal

A reusable React UI package (`packages/ui`) consumed later by the Tauri app (SP3) and the Chrome
extension (SP4). It talks only to a `VaultService` port, never to Tauri or `chrome.*`. **The layout,
element positions, spacings, and type are ported 1:1 from the existing Swift views** — this is a
visual re-implementation, not a redesign.

## Stack

React + TypeScript + Vite, Tailwind + shadcn/ui primitives, lucide icons. **Storybook** (Vite
builder) is the dev/preview harness: one story per screen and per component state, driven by
`MockVaultService`. Component tests: Vitest + Testing Library (jsdom).

## The `VaultService` port

The UI's only backend. `MockVaultService` implements it in-memory but with **real** OTP + crypto via
`@twofau/core-wasm`.

```ts
interface Capabilities { scanScreen: boolean; qrImage: boolean; paste: boolean }
interface VaultService {
  capabilities(): Capabilities
  isLocked(): boolean
  unlock(passphrase: string): Promise<void>
  list(): Promise<Account[]>
  addUri(otpauthUri: string): Promise<Account>
  addManual(fields: { issuer: string; label: string; secretBase32: string; type: "totp" | "hotp" }): Promise<Account>
  update(a: Account): Promise<void>
  remove(id: string): Promise<void>
  code(a: Account, unixTimeMs: number): string
  advanceHotp(id: string): Promise<void>
}
```

State: a `VaultProvider` context + `useVault()`; a `useNow()` hook ticks every 1s (drives ring +
codes). No Redux/Query.

## Layout parity (ported verbatim from the Swift app)

Root panel **width 320px**, inline navigation between `list | add | edit` (no modals/sheets), exactly
as `RootView`.

### List screen (`MenuBarView`) — `VStack(spacing:0)`: header · divider · [search] · list/empty · divider · footer

- **Header** — HStack spacing 8: shared **timer ring** (22×22) · `lock.shield.fill` (tint) ·
  “2FAU” (headline) · Spacer · actions HStack spacing 16: QR-scan (`qrcode.viewfinder`), paste
  (`doc.on.clipboard`), add (`plus`). Padding h14 / v11.
- **Timer ring** — one shared 30s countdown for all TOTP: 2.5px track (quaternary) + tint trim =
  `secondsLeft/30`, rotated −90°, `secondsLeft` centered in a 10px rounded monospaced-digit label.
- **Search bar** — shown only when accounts > 5: `magnifyingglass` + plain text field + clear
  (`xmark.circle.fill`); rounded-8 quaternary fill; inner pad h8/v6, outer pad h10/v8.
- **List** — fixed row height 64, capped at 5 visible rows (scrolls beyond), visible separators,
  clear row backgrounds.
- **Row** (`RowView`, inner height 48, row pad h8/v8, tap = copy, hover reveals actions):
  - Left `VStack(spacing:2)`:
    - `HStack(spacing:6)`: **primary** = label||issuer (subheadline semibold, 1 line) + **secondary**
      = issuer when a label exists (caption, secondary, 1 line).
    - `HStack(spacing:6)`: **code** split in half with a space (`"492 810"`, `"4928 7082"`),
      24px medium monospaced, turns green + `checkmark.circle.fill` for ~1s after copy.
  - Spacer(min 8), then hover **actions**: HOTP → refresh (`arrow.clockwise`); edit (`pencil`);
    delete (`trash`, red) → inline Delete/Cancel confirm (destructive + bordered). Errors: caption2 red.
- **Empty state** — `lock.shield` (large) · “No accounts yet” · “Tap + to add one”, pad v36.
- **No matches** — centered callout “No matches”, pad v24.
- **Footer** — HStack: “N account(s)” (caption, secondary) · Spacer · Quit (caption, secondary).
  Pad h14/v8.

### Add screen (`AddView`) — `VStack(spacing:12)`, pad 16

Back chevron + “Add account” (headline) · divider · button row `[Paste otpauth:// or QR]
[QR image file…]` · text fields issuer / label / secret (Base32) · segmented TOTP|HOTP · error
(red caption) · right-aligned Cancel / Save (Save = default action).

### Edit screen (`EditView`) — `VStack(spacing:12)`, pad 16

Back chevron + “Edit account” · divider · issuer / label fields · error · Cancel / Save.

### SwiftUI → Tailwind mapping (fidelity)

spacing 2/4/6/8/12/16 → gap 0.5/1/1.5/2/3/4; padding h14 v11 → px-3.5 py-[11px]; pad 16 → p-4.
Fonts: subheadline 13 semibold, caption 11, caption2 10, headline 15 bold, code 24 medium mono
(`ui-monospace`, tabular-nums). System font stack `-apple-system, "SF Pro Text", system-ui`.
Light/dark via `prefers-color-scheme`; tint = macOS accent blue.

## Unavoidable cross-platform deviations (only where a 1:1 port is impossible)

1. **`UnlockView` is net-new** — the Swift app unlocked silently via Secure Enclave; cross-platform
   the root of trust is a passphrase (SP1), so the shared UI needs a passphrase-entry screen. Styled
   to match (centered lock.shield, single secret field, “Unlock”, error caption).
2. **Header actions are capability-gated** — “scan QR from screen” is desktop-only; actions absent
   from `capabilities()` are hidden. Same positions/icons when present.
3. **QR image import** — Swift used `NSOpenPanel` + CoreImage; here a hidden file input + **jsQR**
   decodes the image to an `otpauth://` string. Same button.
4. **Copy + notify** — `navigator.clipboard.writeText` + the same green/checkmark in-row feedback;
   OS notifications (Swift `Notifier`) are a host concern injected via the service later.

## Testing / verification

- **Port contract** (Vitest): `MockVaultService` add-uri / add-manual / list / code / remove /
  advanceHotp behave correctly (codes come from the real WASM core).
- **Component** (Testing Library): `AccountRow` shows the half-split code and the secondary name only
  when a label exists; clicking copies and flips to the green checkmark; HOTP row shows the refresh
  action. `MenuBarView` shows the search bar only past 5 accounts; empty state otherwise.
- **Storybook** builds; stories cover list (0/1/6+ accounts), row (TOTP/HOTP/copied), add, edit,
  unlock, error states.
- **Gates:** `pnpm -F @twofau/ui build` + Storybook build green; Vitest green.

## Out of scope (later)

Real window vibrancy/tray (SP3), camera QR scan, drag-reorder, settings/preferences, i18n,
`chrome.storage` and Tauri service implementations (SP3/SP4).
