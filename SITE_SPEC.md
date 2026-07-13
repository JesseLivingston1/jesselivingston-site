# jesselivingston.com — Site Spec

## Spec Rule
Update this file **before** any code change. Spec first, then code.

## Overview
Static **multi-page** marketing/portfolio site for jesselivingston.com. No build step. One HTML file per page (root-relative links), shared CSS in `/styles.css`, images + the gated PDF in `/assets/`. Deployed via GitHub Pages (push to `main`); DNS on Cloudflare; `CNAME` in repo root.

**Redesigned 2026** to the cream/forest "trust" system (from a Claude design handoff), and split into one page per nav item. This **replaces** the previous dark-purple single-file tabbed site and the embedded Aria prototype, both removed.

## Architecture
- **Pages:** `index.html` (Home: hero + Research-as-Performance + What I've built) · `experience.html` · `portfolio.html` · `services.html` · `contact.html`. Each page is standalone; header (nav) and footer are duplicated (no build/includes); the current page's nav link carries `class="nl active"`.
- **Shared CSS:** `/styles.css` (base + hover/active + the 880px responsive breakpoint), linked from every page with a `?v=` cache-busting query (bump it when CSS changes). The body is a flex column (`footer{margin-top:auto}`) so the footer pins to the bottom on short pages. `header > div` is widened to `1220px` so the nav column aligns with the section content column. Section layout stays as inline styles (each section lives on one page, so nothing is duplicated).
- **Per-page JS:** the password gate is inline on `portfolio.html` only; the Web3Forms handler is inline on `contact.html` only.
- Desktop-first; one responsive breakpoint at **880px** (stacks grids, hero, timeline; hides nav text links). No framework/routing; nav links are root-relative page links (`/about.html` …), wordmark → `/`.

## Pages
- **Nav (every page):** wordmark → Home; Experience · Portfolio · Services · "Get in touch" (forest pill → contact). Active page link highlighted. (The "About" nav link and its `/#about` anchor were removed with the About section, below.)
- **Home** (`index.html`): hero (cream) → **What I've built** (**forest/green band**: Saga / Aria / Corpus trio + "See the work" link to portfolio) → **Research as Performance** (**cream band**, distilled/dramatic/targeted/timely) → footer. The **About section was removed** (2026) — its content (foundational-questions framing, the Talent Insights → builder-turn line, the "DESIGN → RESEARCH → BUILD" card) is not preserved elsewhere; the hero subtitle is now the only place carrying the design-background + builder narrative. **What I've built and Research as Performance were swapped** (2026) so the builder proof point comes right after the hero; each section kept its own original background color in the swap (What I've built stays green, Research as Performance stays cream). Research as Performance's own top/bottom borders (`#E7DECB`) separate it from What I've built above and the footer below, so no additional separator is needed.
  - **Positioning (2026 repositioning):** Jesse is a **UX Researcher & Builder** — co-equal identities. A **design background** stated up front, researcher as the through-line (11 years finding the foundational questions teams skip), and now, with AI coding tools, he **builds the products he used to only spec**. The three built things he references are **Saga** (AI-moderated research at scale), **Aria** (a research communication workflow tool), and **Corpus** (a research library). "Founder of Saga" is retired as the headline identity — Saga is now one of three built things.
  - **Hero:** kicker "UX Researcher & Builder"; headline about researching what's worth building and now building it; subtitle leads with the design background, then the 11 years across LinkedIn, Netflix, Microsoft, ServiceNow, then the builder turn naming Saga / Aria / Corpus. Four company logos sit **under the avatar** (no stat chips, no "trusted by teams at" label).
  - **What I've built (green band):** kicker + headline, three cards (Saga / Aria / Corpus) with one-line descriptions, and a "See the work →" link to `/portfolio.html`. **Keep these three descriptions in sync with the portfolio** (portfolio.html is maintained separately; if its copy for Saga/Aria/Corpus changes, mirror it here).
- **Experience** (`experience.html`): timeline of roles, newest first: **Saga** (Founder & Principal Researcher, 2025 - Present) → ServiceNow → Microsoft → Velir → Freelance → Netflix → LinkedIn → **Think Company** (Experience Designer, Apr 2015 - Nov 2016) → **Haystack Informatics** (Product & Brand Designer, Jul 2014 - Mar 2015), with bullets and spaced-hyphen dates (no em dashes), a **company logo beside each role** (`/assets/exp-*.png`, extracted from the resume; Freelance is a recreated blue rounded square `#29B2FE`; the two early design roles use small **recreated inline marks**, no image file), + Education + Key Skills. The middle six roles (ServiceNow through LinkedIn) mirror `Standalone Resume (7).pdf`; **Saga is back on the timeline** (2026, using `/assets/exp-saga.png`, the swirl mark) as the current/founding role, restoring the "Founder of Saga" credential now that Saga is framed as one of the built things rather than the headline identity; the **two early design roles (Think Company, Haystack) are added beyond the resume** (sourced from LinkedIn) to establish the design background that anchors the researcher/builder positioning. Headline reads "12 years across design, research, and AI." Keep the resume-mirrored roles in sync with the PDF. **Saga's dates are year-only ("2025 - Present") per the source screenshot** — confirm the exact start month with Jesse if the site's month-level convention should apply here too.
- **Portfolio** (`portfolio.html`): four case cards (**all cream** — Saga was de-greened to match the others) under a "Selected work" kicker (the "Four trust stories" headline was removed by request) + an "Unlock the full portfolio" link. All gated (see Portfolio gate). Card titles mirror the case-study PDF's section headers: Saga "Evaluating the experience of AI at Scale"; Copilot "Helping users guide an AI experience"; LinkedIn "Data backed by transparency and trust"; Treehouse "Earning trust from burned car buyers".
- **Services** (`services.html`): Focus Areas (cream panel) → Research Methods ("What I can run for you", **forest band**, 4×3 cards: the original 9 qualitative/mixed methods plus **Surveys**, **Data Analysis**, and **A/B Testing** added 2026 to represent quant methods) → Engagement Models (Single Study $3–10K / Monthly Retainer $8–14K/mo).
- **Contact** (`contact.html`, forest): Web3Forms form + LinkedIn, with a thin (6px) cream separator before the footer. The email address is **not** displayed anywhere (by request) — the form (delivers to Jesse's inbox) and LinkedIn are the contact channels. The portfolio gate copy and error text reference "get in touch", not the address.
- **Footer (every page):** forest-deep wordmark + "© 2026 · UX Research & Strategy".

## Portfolio gate (case studies)
- The four case cards and the "Unlock" link are password-gated (soft, client-side). Correct password opens the case-study PDF in a new tab and remembers via `localStorage['jl_pf_ok']='1'`.
- PDF: `/assets/jl-portfolio-8fa31c7e.pdf` (unguessable filename). Password: `livingston2026!` (a `const` in the inline script; configurable).
- **SECURITY (important):** this is a **soft deterrent only**. The PDF is a static file in a public repo, reachable at its URL by anyone who has it; the gate hides the link, not the file. For real protection, host the PDF behind server-side auth / a signed link, or keep it out of the public repo.

## Design tokens
- **Color:** page cream `#F4EFE4`, panel `#FBF8F2`, border `#E1D8C6`, divider `#E7DECB`, ink `#122231`, body `#34424B`, secondary `#5E6B63`, forest `#123A33`, forest-deep `#0D2A24`, green accent `#16584A`, mint `#9FD3BF`, coral `#D8553A`, sand label `#9E8A6C`. On forest/green bands, **body text is white (`#fff`)** for legibility — the muted `forest-body #9DB3AB` is retired for body copy; mint `#9FD3BF` stays for small kicker labels only.
- **Type:** Source Serif 4 (900, headings), DM Sans (body), JetBrains Mono (uppercase kickers / labels / data). `text-wrap:balance` on headings.
- **Voice:** plain, measured, first person. **No em dashes.** Say "users"/"participants", not "people". Identity string site-wide is **"UX Researcher & Builder"** (was "UX Researcher & Founder of Saga").

## Preserved from the prior site
- **SEO:** title / description / canonical / Open Graph / Twitter / JSON-LD in `<head>` (updated copy; og:image still `/images/headshot.jpg`).
- **Contact:** Web3Forms (access key `fb8dd8b0-9dd9-4c39-a1e5-51f00ee8fe7d`, delivers to Jesse's configured inbox); AJAX submit with inline status.
- `CNAME` (jesselivingston.com).

## Removed
- The **agent tollbooth** (`agent-detect.js` script tag) is intentionally NOT loaded — it was removed from the live site earlier; the rebuild keeps it out. The `agent-detect.js` file is now orphaned in the repo (unreferenced); safe to delete.

## Assets (`/assets/`)
`jesse-hi.png` (illustrated avatar), `saga-mark.png`, `saga-mark-gradient.png`, `logo-linkedin.png` / `logo-linkedin-navy.png`, `logo-microsoft.png` / `logo-microsoft-navy.png`, `logo-netflix.png`, `logo-servicenow.png`, the experience-timeline logos `exp-saga.png` (**back in active use** on `experience.html` since Saga returned to the timeline) / `exp-servicenow.png` / `exp-microsoft.png` / `exp-velir.png` / `exp-netflix.png` / `exp-linkedin.png` / `exp-freelance.png` (extracted from the resume), `jl-portfolio-8fa31c7e.pdf`. Treehouse mark + the Think Company / Haystack timeline marks are inline (an SVG / recreated shapes).

## Deployment
GitHub Pages on push to `main` (repo `JesseLivingston1/jesselivingston-site`). `CNAME` in root. Cloudflare DNS unchanged.

## Open / to confirm
- **LinkedIn URL:** `/in/jesseliv` (confirmed by Jesse 2026-06-20).
- **Contact email:** **not displayed** anywhere (removed by request 2026-06-20); the Web3Forms form (delivers to Jesse's inbox) + LinkedIn are the only contact channels.
