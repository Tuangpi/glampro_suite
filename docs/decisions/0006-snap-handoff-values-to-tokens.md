# 0006 — Snap handoff values to tokens; record the delta

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Engineering (values) · Design (fidelity)
- **Related:** the design-token source/copy rule,
  [`design/HANDOFF.md`](../design/HANDOFF.md) §3, §5,
  [`roadmap.md`](../roadmap.md) Phase 1, [`STATE.md`](../STATE.md) §3.1

## Evidence review — 2026-10-17

The accepted snap-to-token policy below is preserved. These qualifications describe the
current code and open gaps, not newly approved policy. Historical references remain
historical, as explained in the [ADR index](README.md#historical-references-and-current-scope).

- **Token files stay byte-identical.** `cmp design/handoff/tokens/tokens.css
  apps/web/src/styles/tokens.css` exits 0 — the copy rule from ADR 0006's
  Enforcement still holds, and no `--app-*` second namespace was introduced.

- **Fractional utilities emit CSS.** `npm run build:web` passes; `px-2.25`,
  `px-3.5`, `px-4.5`, `pt-1.5` and `font-heavy` all resolve (confirmed by the
  baseline build). `Badge` renders `text-xs font-heavy` with `px-2.25 py-1` — the
  tie-rounds-up rule (10.5px → 11px) and the fractional geometry are in place.

- **`design/HANDOFF.md` is absent.** ADR 0006's Enforcement says the reconciled
  table lives in `design/HANDOFF.md` §5. The file does not exist in this
  checkout. The deltas are recorded here in the ADR's own table instead.

- **No new amber token was added here.** The token file has no amber
  surface/text pair; that gap was left as Q23 and later closed by ADR 0009.

No code change is implied by this review. The snap-to-token rule and the copy
rule are both honored in the current code.

Phase 1's acceptance criterion is that primitives "reproduce the handoff geometry closely
enough that a screen built from them needs no new CSS values". Reconciling the four
standalone primitives surfaced a problem the token pipeline did not anticipate:

**The handoff's screens use values its own token file does not define.** The type scale stops
at `10 / 11 / 12.5 / 14 / 15.5 / 17 / 21 / 26 / 40px`, but the screens draw at `10.5px`
(`.tier`, `.status`), `13px` (`.chip`), `13.5px` (`.btn`), `14.5px` (`.card-title`,
`.section-title`) and `12px` (`.card-link`). Colours are worse: `.chip` writes `#2B3160`
on `#F3F4FA`, and `.status.progress` / `.tier.gold` use an amber surface `#FFF4DE` with
amber text `#B9740A` — **none of which is near any token**, since the token file exposes
amber only as a gradient stop for the dashboard income tile.

Three ways out, and they are not equally good:

1. Add `--app-*` tokens to `styles/app-chrome.css`, as the rail reconciliation did.
2. Add them to `design/handoff/tokens/tokens.css` and re-copy, which
   [`roadmap.md`](../roadmap.md):46-48 appears to ask for.
3. Snap each value to the nearest real token and write the delta down.

Option 2 edits the vendored handoff package. `design/handoff/` is reference material kept
exactly as delivered, and a designer should be asked for a token rather than have one
written for them. Option 1 grows a second token namespace for half-pixel typography, and
`--app-rail-label: 8.5px` is a fair precedent but a poor generalisation: the rail needed
one value, this needs six plus two colours.

## Decision

**Snap to the nearest existing token. Record every delta. Add nothing to either token file.**

- Nearest wins. When a value sits exactly between two tokens — the handoff's `10.5px` is
  equidistant from `text-2xs` (10px) and `text-xs` (11px) — **ties round up**,
  because legibility is the safer error at small sizes.
- A snapped value may differ from the screen by at most **1px**. If a screen's value is
  further than that from every token, it is not a snapping decision at all: it is a gap,
  and it becomes an open question (Q23) rather than an invented value.
- Colours follow the same rule, mapped to the nearest token.
- Where the handoff contradicts **itself**, the app takes the token and the disagreement
  is recorded. The handoff draws `.btn` at 37px in screens 06–11 and ~43px in screens
  01–02; it cannot be both. `--sp-control-h-md` is what the token file defines for
  "standard buttons" and what the roadmap's 44px tap-target rule requires, so 44px wins.

## What that produced

| Handoff                          | Snapped to     | Utility                | Δ      |
| -------------------------------- | -------------- | ---------------------- | ------ |
| `.card-title` `14.5px`/`800`     | `14px`/`800`   | `text-base font-heavy` | −0.5px |
| `.tier`/`.status` `10.5px`/`800` | `11px`/`800`   | `text-xs font-heavy`   | +0.5px |
| `.chip` `13px`/`600`             | `12.5px`/`600` | `text-sm font-medium`  | −0.5px |
| `.btn` `13.5px`/`700`            | `14px`/`700`   | `text-base font-bold`  | +0.5px |
| `.card-link` `12px`/`700`        | `12.5px`/`700` | `text-sm font-bold`    | +0.5px |
| `.tab-opt` `12.5px`/`700`        | `12.5px`/`700` | `text-sm font-bold`    | **0**  |
| `.chip` text `#2B3160`           | `#1B2350`      | `text-ink`             | ≈      |
| `.chip` fill `#F3F4FA`           | `#F3F4FA`      | `bg-surface-2`         | **0**  |

Every padding snapped exactly: `.card-head` `px-5 py-4`, `.card-body` `px-3 pt-1.5 pb-3`,
`.chip` `px-3.5 py-2`, `.tier` `px-2.25 py-1`, `.btn` `px-4.5`.

**Three conflicts were not snapped, because the token is a deliberate override.** These
are the cases where the app knowingly does not match the screen:

- `Button`/`Checkbox`/`Chip`-toggle height **44px**, against a handoff of ~30–43px. The
  roadmap requires 44px and `--sp-control-h-md` exists for it.
- `Chip` selected state is a **solid** `--sp-purple` fill, matching `.toggle-chip.active`.
- `Tabs` is a scrollable strip, not the handoff's `flex: 1` centred row, and its active
  tab is a `border-b-2` rather than an `inset 0 -2px 0` shadow. Both draw the same
  underline; the border cannot drift from the text colour.

**Q23 is what snapping could not resolve.** `#FFF4DE` and `#B9740A` are more than 1px
from any token, so the 1px rule sends them to an open question rather than a variant.
`Badge` deliberately has no amber tone and this ADR does not add one — the dashboard and
customers screens need it before those screens are built.

## Why not the alternatives

| Alternative                              | Why it was rejected                                                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `--app-*` tokens to `app-chrome.css` | A second token namespace for six half-pixel sizes and two colours, duplicating values the real scale already covers within 0.5px. `--app-rail-label: 8.5px` does not generalise: the rail needed one value, this needs eight |
| Edit `design/handoff/tokens/tokens.css`  | The handoff is vendored reference kept exactly as delivered; inventing designer tokens for the designer is how the two files drift. A real gap is a question **to** the designer, not an edit **of** their file              |
| Add a `--sp-text-14\.5`-style step       | Tokens are named for what they are, and a type scale with half-pixel steps stops being a scale                                                                                                                               |
| Match every screen exactly               | Violates the 44px tap-target rule for four primitives and the "no hand-written px values in components" rule for the rest                                                                                                    |
| Round ties **down**                      | Shrinks the smallest text in the system to make a rounding rule tidier                                                                                                                                                       |

## Consequences

- **Positive.** The token file and its copy stay byte-identical, no second namespace is
  introduced, and every primitive lands within 1px of the handoff while using only
  documented tokens. `cmp` on the token files still passes.
- **Negative / accepted.** Small type moves by up to 0.5px from the designer's drawing,
  and `Badge` renders at 11px rather than 10.5px. A visual diff against the static
  handoff HTML will show this; it is intended, and the table above is the record.
- **Negative / accepted.** The dashboard and customers screens cannot be built without an
  amber badge tone. That is Q23, and it blocks those two screens rather than this change.
- **Neutral.** `--app-rail-label: 8.5px` and the other rail values in `app-chrome.css`
  are untouched. They remain a single-case precedent, not a policy this ADR adopts.
- **Neutral.** Nothing consumes `Card`, `Badge`, `Chip` or `Tabs` outside their tests yet,
  so no screen changed appearance in this commit.

## Enforcement

- Class-level assertions in `Card.test.tsx`, `Badge.test.tsx`, `Chip.test.tsx` and
  `Tabs.test.tsx` pin the reconciled utilities. **jsdom performs no Tailwind layout, so
  these guard against a silent revert rather than measuring a pixel** — the rendered
  values are measured in the browser and recorded in
  [`design/HANDOFF.md`](../design/HANDOFF.md) §5.
- `npm run build:web` was run to confirm the fractional utilities (`px-2.25`, `px-3.5`,
  `px-4.5`, `pt-1.5`) and `font-heavy` all emit CSS and resolve to the token they should.
- The reconciled table lives in [`design/HANDOFF.md`](../design/HANDOFF.md) §5, so the
  handoff-facing document carries the deltas rather than this ADR alone.
