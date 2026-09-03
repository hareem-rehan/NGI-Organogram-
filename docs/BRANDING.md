# Branding — DotZero

This application was rebranded from its original placeholder identity ("Dynamic Organogram Manager") to **DotZero**, per explicit user instruction. Source assets: `DotZero Color Palette.pdf` and `DotZero Logos.ai` (provided by the user, not fetched or invented). Logo variants were extracted from the source file as real vector SVGs (`pdftocairo -svg`), not rasterized, and live in `public/brand/`.

## App name

**"DotZero Organogram"** — a default choice (not an explicit user answer; the user was asked and didn't specify a name before moving on to sharing assets), following the same "[Product] [Function]" pattern as the user's own other DotZero product ("DotZero CRMS"). Set in exactly one place — `NEXT_PUBLIC_APP_NAME` (`.env.local`/`.env.example`/`.env.test`) — every page title, the sign-in page's logo alt text, and the health endpoint's `application` field all derive from it, so renaming again later is a one-line change, not a repo-wide edit. If a different name is wanted, just change that variable.

## Color palette (source: `DotZero Color Palette.pdf`)

| Name         | Role (per source) | Hex                                                          |
| ------------ | ----------------- | ------------------------------------------------------------ |
| Velocity Red | Primary           | `#EF323F`                                                    |
| White        | Neutral           | `#FFFFFF`                                                    |
| Soft White   | Neutral           | `#F7F7F7`                                                    |
| Almond       | Neutral           | `#F3F0E8`                                                    |
| Dark Slate   | Primary Dark      | `#2D2D2D` (also `#212121`, `#161616` shown as darker shades) |
| Ash Gray     | Neutral           | `#5D5B5B`                                                    |
| Soft Silver  | Neutral           | `#D3D3D3`                                                    |

### Applied to `app/globals.css`'s design tokens

| Token                            | Value                      | Source color                   | Why                                                                                                          |
| -------------------------------- | -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `--color-background`             | `#FFFFFF`                  | White                          | Base surface                                                                                                 |
| `--color-foreground`             | `#2D2D2D`                  | Dark Slate                     | Body text — 13.77:1 on white                                                                                 |
| `--color-muted`                  | `#F7F7F7`                  | Soft White                     | Subtle backgrounds                                                                                           |
| `--color-muted-foreground`       | `#5D5B5B`                  | Ash Gray                       | 6.75:1 on white, 6.30:1 on Soft White — both comfortably pass WCAG AA                                        |
| `--color-border`/`--color-input` | `#D3D3D3`                  | Soft Silver                    | Structural lines                                                                                             |
| `--color-ring`                   | `#EF323F`                  | Velocity Red (exact)           | Focus ring — a non-text UI indicator (WCAG 1.4.11's 3:1 threshold), so the unmodified brand red is safe here |
| `--color-primary`                | `#D72D39`                  | Velocity Red, darkened         | See "Why the brand red is darkened for buttons" below                                                        |
| `--color-secondary`              | `#F7F7F7` / text `#2D2D2D` | Soft White / Dark Slate        |                                                                                                              |
| `--color-accent`                 | `#F3F0E8` / text `#2D2D2D` | Almond / Dark Slate            | Hover/active surfaces                                                                                        |
| `--color-destructive`            | `#BA2731`                  | Velocity Red, darkened further | See below                                                                                                    |

**Not changed:** `--color-status-*` (position status badges) and `--color-dept-*` (department color-coding) — these are independently contrast-verified, semantically arbitrary categorical colors from earlier phases, not core brand identity. The source palette doesn't provide a set of department-differentiating colors, so inventing 8 new ones under the "DotZero" label would be fabricating brand guidance that doesn't exist, not applying it.

### Why the brand red is darkened for buttons (a real, measured finding, not a stylistic choice)

White text directly on the exact brand red (`#EF323F`) measures **4.04:1** — under WCAG AA's 4.5:1 minimum for normal-size text. This app's buttons use `text-sm font-medium` (14px, weight 500), which does not qualify as WCAG "large text" (needs ≥18.66px bold or ≥24px regular), so the 4.5:1 threshold genuinely applies. This was computed directly (WCAG relative-luminance formula), not assumed:

```
White on #EF323F  -> 4.04:1  (FAILS AA normal text)
White on #D72D39  -> 4.86:1  (PASSES, used for --color-primary)
White on #BA2731  -> 6.14:1  (PASSES with more margin, used for --color-destructive)
```

`#D72D39` and `#BA2731` are both darkened shades of the exact same hue as Velocity Red (not a different color) — visually unmistakably "the brand red" at a glance, while staying text-safe. This mirrors the exact same reasoning this file's `--color-status-filled`/`--color-status-vacant` tokens already document for unrelated colors discovered in earlier phases — this app has a standing discipline of never shipping a color pairing that fails measured contrast, and the brand rollout doesn't get an exception.

`--color-primary` and `--color-destructive` are deliberately two different darkened reds (not the same value) so a primary "Save"/"Create" action stays visually distinguishable from a destructive "Delete"/"Archive" action at a glance, even though both are brand-red-family. The real safety net for destructive actions remains `components/patterns/confirm-dialog.tsx`'s explicit confirmation step (`docs/PROJECT_SPEC.md` §12: color is never the only signal) — this is a legibility choice on top of that, not a replacement for it.

## Logo assets (source: `DotZero Logos.ai`, extracted as vector SVG)

| File                                    | Used where                                              | Description                                                                                           |
| --------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `public/brand/dotzero-wordmark.svg`     | App header (`components/layout/site-header.tsx`)        | Red icon mark + dark-slate "DotZero" wordmark — the source file's own light-background primary lockup |
| `public/brand/dotzero-wordmark-red.svg` | Sign-in page                                            | Full red icon + red wordmark — more brand impact on a page with no surrounding chrome                 |
| `public/brand/dotzero-icon.svg`         | Favicon (`app/icon.svg`, Next.js App Router convention) | Icon mark only, red                                                                                   |
| `public/brand/dotzero-icon-dark.svg`    | Not currently used                                      | Icon mark only, dark — reserved for a future dark-mode header if one is built                         |

The source `.ai` file also contained gray/muted wordmark and icon variants (11 pages total) — not used, since this app currently has no dark-mode/watermark surface that needs them; they remain available in the source file if a future need arises.

## What was deliberately NOT changed

- `docs/phase-reports/*.md` — historical records of what was built, under the name it had at the time. Rewriting history to match a later rebrand would make these reports inaccurate about what actually happened when.
- `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and the other ~30 pre-existing spec/reference docs that mention the old name — a full rename sweep across the entire documentation corpus was judged out of scope for a branding pass on the running application; only the two "living" top-level docs (`README.md`, `CLAUDE.md`) had their title line updated, since those are read as current, not historical.
- Department/status color tokens — see above.
- Any actual company/legal name in `Company`/`CompanySettings` records — those are HR-managed data, not application branding, and untouched by this change.
