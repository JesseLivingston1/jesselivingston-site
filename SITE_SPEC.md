# jesselivingston.com — Site Spec

## Spec Rule
Update this file **before** making any code changes. If a change affects content, styles, or behavior described here, update the spec first.

## Overview
Single-page static site. No build step. Everything in `index.html` (HTML + CSS + JS inline). Images in `/images/`. Deployed via GitHub Pages with Cloudflare DNS.

**Repo**: `JesseLivingston1/jesselivingston-site`
**Domain**: `jesselivingston.com` (CNAME file in root)
**Contact email**: `jesse@jesselivingston.com`
**Portfolio**: case-study detail is client-side encrypted (AES-GCM); the password is private and NOT stored in the repo
**Web3Forms key**: `fb8dd8b0-9dd9-4c39-a1e5-51f00ee8fe7d`

---

## Tab Structure
Five main tabs (JS-driven, no routing):
- **Home** — Hero, About, Principles
- **Services** — Focus areas, Research Methods, Engagement Models + pricing (no "Most Popular" label). Two engagement tiers: Single Study + Monthly Retainer. No prototype offerings.
- **Experience** — Timeline resume (8 roles, see below)
- **Portfolio** — Password-gated. No sub-tab buttons shown — case studies display directly. 4 cards: LinkedIn, Microsoft, Treehouse, Dwarven Forge. Role tags do NOT include "(sole)".
  - ~~Prototype~~ — Panel hidden (commented out in HTML), JS intact. To restore: uncomment `<!-- PROTOTYPE PANEL -->` block, add back the `.ptabs` div with both buttons, and re-show `.ptabs`.
- **Contact** — Web3Forms form → jesse@jesselivingston.com. Header centered.

## Prototyping
Prototyping has been removed from all user-facing content (title, hero, services, portfolio). Do NOT add it back without explicit instruction. The Aria prototype JS and HTML remain in the file but are hidden.

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
- `checkPw()` — derives a key (PBKDF2) from the entered password and AES-GCM-decrypts the case-study modals, injecting them on success; a wrong password fails to decrypt and shows the error
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

## Hero Stats
Displayed as two cards below the hero paragraph: "11+ Years Experience" and "80+ Studies Led". Search `.crd` to find them.

## Common Edits
- **Portfolio password**: not in the repo (case studies are encrypted, password private). To rotate it, re-encrypt the modals with a new password (see the transform in saga-monorepo `agent-interview-test/portfolio-transform.js`)
- **Pricing**: Search `$3–10K`, `$8–18K`, `$8–14K`
- **Contact email**: Search `jesse@jesselivingston.com`
- **Case study content**: Inside `<div class="mo" id="modal-{company}">` blocks
- **Experience timeline**: Inside `<div class="tp" id="page-experience">`
- **Prototype data**: JS constants `THEMES`, `RECIPIENTS`, `SLIDES`, `BRIEFS`, `BRIDGES`
- **Prototype step labels**: `STEP_IDS` and `STEP_LABELS` arrays

---

## Agent Tollbooth / Saga Concierge (REMOVED — June 2026)
An experiment that detected automated agents and offered them a structured Q&A: "tollbooth" v1 (`agent-detect.js`), swapped for a voluntary "concierge" v2 (`concierge-widget.js`). Fully removed as of June 12, 2026:
- `concierge-widget.js` was deleted June 7, 2026 (commit `b93525d`) along with the `jl-tollbooth` Cloudflare Worker, but the `<script src="/concierge-widget.js">` tag before `</body>` was left behind and 404'd on every page load. Tag removed June 12, 2026.
- `agent-detect.js` deleted June 12, 2026 (orphaned since the v2 swap replaced its script tag).
- Nothing references `jl-tollbooth.jesselivingston.workers.dev` anymore.
- Do not re-add any of this without explicit instruction.

## Saga Analytics Widget (added June 2026)
`cdn.sagainsights.ai/widget/v1.js` is loaded as a `defer` script just before `</body>`. Client ID: `sk_wgt_gPj49ydphMxZzujJkOXay5PUzxEOTxJ0`. Display name: `Jesse Personal Site`. This is a publishable/embed key (safe to commit publicly).

**Kept from that work** (do not revert): case-study encryption. The portfolio modals live AES-GCM-encrypted in the inline JS (`SAGA_S` salt / `SAGA_I` IV / `SAGA_D` data + `_sb()` and `_sagaDecrypt()`); `checkPw()` derives the key from the entered password (PBKDF2, 100k iterations, SHA-256) and injects the decrypted modal HTML before `<footer>`. The password is not in the repo — see Common Edits for rotation.
