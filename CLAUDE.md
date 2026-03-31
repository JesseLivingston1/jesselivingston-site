# Jesse Livingston — Freelance UX Research Website

## Overview
Static single-page website for jesselivingston.com. Freelance UX research business with emerging technology focus and prototyping as a value-add.

## Architecture
This is a **single HTML file** with tabbed navigation (no routing, no build step). All CSS is inline in `<style>` blocks. All JS is inline in a `<script>` block. Images are in `/images/`.

```
├── index.html          # Everything: HTML, CSS, JS
├── images/
│   ├── headshot.jpg    # Jesse's photo (343KB, full-res)
│   ├── linkedin.png    # LinkedIn "in" logo
│   ├── servicenow.png  # ServiceNow logo
│   ├── netflix.png     # Netflix N logo
│   └── dwarvenforge.png # Dwarven Forge gold smith logo
├── CNAME               # GitHub Pages custom domain
└── CLAUDE.md           # This file
```

Microsoft and Treehouse logos are inline SVGs (no files needed).

## Tab Structure
The site uses JS-driven tabs, not separate pages. Five tabs:
- **Home** — Hero, about, principles
- **Services** — Focus areas, research methods, engagement models + pricing
- **Experience** — Timeline resume (8 roles)
- **Portfolio** — Password-protected (`livingston2026`). Two sub-tabs:
  - **Case Studies** — 4 cards (LinkedIn, Microsoft, Treehouse, Dwarven Forge) with detail modals
  - **Prototype** — Full embedded Aria demo (research communication pipeline)
- **Contact** — Form (mailto-based)

## CSS Architecture
Three `<style>` blocks in `<head>`:
1. **Main site CSS** (~14KB) — Uses short class names (`.tp`, `.bp`, `.cc`, etc.) and CSS vars from `:root` prefixed with `--` (e.g. `--p`, `--pl`, `--bg`)
2. **Comms pipeline CSS** (~6KB) — `.cm-` prefixed classes (legacy, partially used)
3. **Aria prototype CSS** (~20KB) — Uses `--a-` prefixed CSS vars to avoid conflicts with main site. Scoped via `.aria-wrap` where possible. Key override to watch: `body{}` rules — these MUST stay scoped to class selectors like `.tc-body`, `.rc-body`, never bare `body{}`

## JS Architecture
Single `<script>` block at the end of `<body>`:
- **Main site functions** (first ~2KB): `switchTab()`, `checkPw()`, `portTab()`, `openCase()`, `closeCase()`, `submitForm()`
- **Aria prototype** (remaining ~48KB): Full SPA with `render()`, data constants (`THEMES`, `RECIPIENTS`, `SLIDES`, etc.), and event attachment

### Critical: Blink Prevention
The Aria prototype uses `innerHTML` replacement for rendering. To avoid full-page flashes:
- Step changes update only `#aria-content` (not the full `#aria-app`)
- Helper functions: `ariaUpdateContent()`, `ariaStepTo()`, `ariaIngestTo()`, `ariaShapeTo()`, `ariaSlideClick()`
- `updateStepNav()` updates step pills directly via DOM
- Theme/recipient expand uses direct `.classList.toggle()` in `attachEvents()`
- Drag-and-drop calls `ariaUpdateContent()` not `render()`
- Only view-level transitions (intro → loading → wizard) call `render()`

### Init Safety
The Aria `render()` init is wrapped in `DOMContentLoaded` + try/catch because `#aria-app` doesn't exist when the portfolio tab is hidden.

## Design System
- **Brand**: `#7F77DD` purple, `#AFA9EC` light purple
- **Background**: `#1E2025` primary, `#252830` secondary, `#2C2F38` tertiary
- **Text**: `#E8E6F0` primary, `#B8B5C6` secondary, `#7B7891` muted
- **Fonts**: Fraunces (serif headings), DM Sans (body), DM Mono (labels/code)
- **No emoji in UI**
- **Font weights as numbers not strings**

## Headshot
Jesse's headshot file. No rotation transform needed for web (the uploaded file is already correctly oriented). If re-encoding, maintain quality — do NOT over-compress.

## Deployment
Static hosting. No build step. Push the repo root to:
- **GitHub Pages**: Add CNAME file, push to `main`, configure in repo settings
- **Cloudflare Pages**: Connect repo, build command = empty, output dir = `/`
- **Netlify**: Drag and drop, or connect repo

Domain: `jesselivingston.com` (DNS already on Cloudflare from existing setup)

## Spec Rule
**Update `SITE_SPEC.md` before touching any code.** If a change affects content, styles, or behavior described in the spec, update the spec first — then make the code change. This applies to every session.

## Common Edits
- **Password**: Search for `livingston2026` in the JS
- **Pricing**: Search for `$3–10K`, `$8–18K`, `$8–14K` in the HTML
- **Contact email**: Search for `jesselivingston1@gmail.com`
- **Case study content**: Inside `<div class="mo" id="modal-{company}">` blocks
- **Experience timeline**: Inside `<div class="tp" id="page-experience">`
- **Prototype data**: JS constants `THEMES`, `RECIPIENTS`, `SLIDES`, `BRIEFS`
