# jesselivingston.com — Site Spec

## Spec Rule
Update this file **before** making any code changes. If a change affects content, styles, or behavior described here, update the spec first.

## Overview
Single-page static site. No build step. Everything in `index.html` (HTML + CSS + JS inline). Images in `/images/`. Deployed via GitHub Pages with Cloudflare DNS.

**Repo**: `JesseLivingston1/jesselivingston-site`
**Domain**: `jesselivingston.com` (CNAME file in root)
**Contact email**: `jesse@jesselivingston.com`
**Portfolio password**: `livingston2026!`
**Web3Forms key**: `fb8dd8b0-9dd9-4c39-a1e5-51f00ee8fe7d`

---

## Tab Structure
Five main tabs (JS-driven, no routing):
- **Home** — Hero, About, Principles
- **Services** — Focus areas, Research Methods, Engagement Models + pricing (no "Most Popular" label)
- **Experience** — Timeline resume (8 roles, see below)
- **Portfolio** — Password-gated. Two sub-tabs:
  - **Case Studies** — 4 cards (LinkedIn, Microsoft, Treehouse, Dwarven Forge) with detail modals. Role tags do NOT include "(sole)".
  - **Prototype** — Full embedded Aria/SubNote prototype (research communication pipeline)
- **Contact** — Web3Forms form → jesse@jesselivingston.com. Header centered.

---

## Design System
| Token | Value |
|---|---|
| Primary purple | `#7F77DD` |
| Light purple | `#AFA9EC` |
| Background | `#1E2025` |
| Card | `#252830` / `#2A2D36` |
| Text primary | `#E8E6F0` |
| Text secondary | `#B8B5C6` |
| Text muted | `#7B7891` |
| Border | `rgba(127,119,221,.12)` |
| Border hover | `rgba(127,119,221,.3)` |
| Warm accent | `#E8A87C` |
| Green accent | `#7DD4A7` |
| Blue accent | `#77B8DD` |
| Radius large | `12px` |
| Radius small | `8px` |

**Fonts** (loaded from Google Fonts):
- `Fraunces` — display/headings (serif)
- `DM Sans` — body
- `DM Mono` — labels, code, tags

**Rules**: No emoji in UI. Font weights as numbers (600, 700), never "bold".

**Experience timeline text**: All text (dates, role titles, descriptions, bullets) uses `#fff`. Only the `→` arrows use `var(--mt)` (muted). Do NOT use `var(--t2)` or `var(--tx)` in the timeline — both have a purple cast that reads as purple on the dark background.

---

## CSS Architecture
Three `<style>` blocks in `<head>`:
1. **Main site CSS** (~14KB) — short class names (`.tp`, `.bp`, `.cc`, etc.), CSS vars in `:root` prefixed `--`
2. **Comms pipeline CSS** (~6KB) — `.cm-` prefix (legacy, partially used)
3. **Aria prototype CSS** (~20KB) — `--a-` prefixed CSS vars. Scoped to `.aria-wrap` where possible. Step nav classes scoped to `.step-nav .sl`, `.step-nav .sn` to avoid conflict with main site `.sl`

**Critical**: Never use bare `body{}` rules in blocks 2/3. Scope to class selectors.

---

## Key CSS Classes (Main Site)
| Class | Purpose |
|---|---|
| `.tp` / `.tp.on` | Page panels (hidden/shown), fades in on `.on` |
| `.sl` | Section label (DM Mono, uppercase, purple, left-aligned) |
| `.st` | Section title (Fraunces serif) |
| `.bp` | Primary button (purple fill) |
| `.bs` | Secondary button (border) |
| `.cc` | Case study card |
| `.cco` | Card logo area |
| `.cct` | Card title |
| `.mo` / `.mo.vis` | Modal overlay |
| `.lgo` | Logo strip item (hero) |
| `.fc` | Focus area card (Services) |
| `.eng` | Engagement model card |
| `.imp` | Impact bullet (diamond prefix) |
| `.ins` | Pull quote / insight callout |
| `.clb` | Collaboration callout box |
| `.fw` | 2-column framework grid (use `style="grid-template-columns:1fr 1fr 1fr"` for 3-col) |
| `.fi` | Framework card item |

---

## JS Architecture
Single `<script>` at end of `<body>`. Two sections:

### Main site functions (~2KB)
- `switchTab(t)` — switches main tab, resets Aria prototype state to intro
- `checkPw()` — unlocks portfolio (password: `livingston2026!`)
- `portTab(p, el)` — switches portfolio sub-tab; calls `render()` if switching to protos
- `openCase(id)` / `closeCase(id)` — modal open/close
- `submitForm()` — Web3Forms POST to jesse@jesselivingston.com

### Aria prototype (~48KB)
State variables (all `var`, not `let` — required for inline onclick access):
- `view` — `"intro"` | `"loading"` | `"scanning"` | `"wizard"`
- `step` — 0–6 (Ingest/Distill/Shape/Present/Target/Brief/Finale)
- `ingestSub`, `shapeSub`, `activeSlide`, `activeFw`
- `themeOrder`, `openThemes`, `openRecipients`

Key render functions:
- `render()` — top-level, routes by `view`
- `ariaStepTo(n)` — navigate to step n; calls `render()` if no `#aria-content` exists (e.g. from intro)
- `ariaUpdateContent()` — partial re-render of `#aria-content` only
- `updateSlide()` — updates slide canvas + thumbnails without full re-render
- `attachEvents()` — re-attaches all event listeners after innerHTML replacement

**Critical**: All state vars must be `var` (not `let`/`const`) since inline `onclick` attributes can't access block-scoped variables.

**Reset behavior**: `switchTab()` resets prototype to `view='intro'` whenever navigating away from portfolio tab.

---

## Prototype Flow
```
intro → [See it in action] → ingest (step 0)
  → [Distill your data] → loading (2.5s) → distill (step 1)
  → [Shape narrative] → shape (step 2, sub 1 skeleton → sub 2 full)
  → [Present] → present (step 3, slide viewer)
  → [Target] → scanning (2.8s) → target (step 4)
  → [Brief] → brief (step 5)
  → [Finale] → finale (step 6)
```

---

## Images
| File | Usage |
|---|---|
| `headshot.jpg` | Hero section (343KB, no rotation needed) |
| `linkedin.png` | LinkedIn "in" icon (22×22, object-fit:contain) |
| `servicenow.png` | ServiceNow logo |
| `netflix.png` | Netflix N logo |
| `dwarvenforge.png` | Dwarven Forge gold smith logo |

Microsoft logo = inline SVG (4-square grid). Treehouse logo = inline SVG (house + tree). Favicon = inline SVG data URI (purple circle, white "J").

---

## Deployment
**GitHub Pages**:
1. Push to `main` branch of `JesseLivingston1/jesselivingston-site`
2. Repo Settings → Pages → Source: `main`, folder: `/`
3. CNAME file in root already set to `jesselivingston.com`

**DNS (Cloudflare)**:
- Remove Wix DNS records (A records, CNAME for www pointing to Wix)
- Add GitHub Pages A records:
  ```
  185.199.108.153
  185.199.109.153
  185.199.110.153
  185.199.111.153
  ```
- Add CNAME: `www` → `jesselivingston1.github.io`
- Enable "Proxied" (orange cloud) on A records for Cloudflare SSL

---

## SEO / Meta Tags
Added to `<head>`:
- `<meta name="description">` — search snippet
- `<title>` — "Jesse Livingston — UX Researcher & Prototyper"
- Open Graph tags (`og:title`, `og:description`, `og:image` → headshot.jpg)
- Twitter card tags
- Schema.org `Person` structured data (JSON-LD)
- `<link rel="canonical" href="https://jesselivingston.com/">`

## Mobile Nav
`<ul class="nv" id="nv">` is a **sibling of `<nav>`**, not a child. This is intentional — placing it inside `<nav>` caused `backdrop-filter` to create a stacking context that made the mobile dropdown background transparent.

Mobile open state (`.nv.mob`) requires `height:auto` explicitly — without it, the desktop `height:64px` rule overrides `bottom:0` and collapses the menu.

## Experience Timeline Mobile Layout
The timeline wrapper has `class="exp-tl"`. On mobile (`max-width:768px`):
- Rows stack vertically (`flex-direction:column`)
- Date column goes full-width, left-aligned above company name
- Vertical line/dot column is hidden
- Content is full-width, no squishing

Date text is purple (`var(--pl)`) on mobile only — overrides the `#fff` inline style via `.tl .te-date div` in the `@media(max-width:768px)` block.

CSS rule lives in the main `@media(max-width:900px)` block as a separate `@media(max-width:768px)` block.

## Experience Timeline
8 roles in chronological order (newest first):
1. Freelance — Jan 2021–Present
2. ServiceNow — Aug 2024–Mar 2026
3. Microsoft — Mar–Aug 2024
4. Velir Studios — Jan 2023–Mar 2024
5. Netflix — Jun–Nov 2020
6. LinkedIn — Nov 2016–Jun 2020
7. Think Company — Apr 2015–Nov 2016
8. Haystack — Jan 2014–Mar 2015

## Common Edits
- **Password**: Search `livingston2026!` in JS
- **Pricing**: Search `$3–10K`, `$8–18K`, `$8–14K`
- **Contact email**: Search `jesse@jesselivingston.com`
- **Case study content**: Inside `<div class="mo" id="modal-{company}">` blocks
- **Experience timeline**: Inside `<div class="tp" id="page-experience">`
- **Prototype data**: JS constants `THEMES`, `RECIPIENTS`, `SLIDES`, `BRIEFS`, `BRIDGES`
- **Prototype step labels**: `STEP_IDS` and `STEP_LABELS` arrays
