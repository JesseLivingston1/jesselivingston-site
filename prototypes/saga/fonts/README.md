# public/fonts — Saga dashboard display font (Fellix)

The dashboard's display font (page titles, spotlight/issue/theme names) is **Fellix**, loaded via
`@font-face` in `src/admin-ui/tokens.css` from **absolute `/fonts/Fellix-*.otf` URLs** (Next serves
this `public/` folder at the site root).

## Why absolute URLs

A relative `url('../../app/fonts/…')` makes webpack resolve the font as a build asset, so the
production build **hard-fails** when the file is missing (GitHub #5). Absolute `/fonts/…` URLs are
served at runtime instead — a missing file just 404s and the **system-sans fallback renders**, so
the build always succeeds.

## Dropping in the fonts

Place these five files here (exact names — the same family name is reused for licensed weights):

- `Fellix-Regular.otf` (400)
- `Fellix-Medium.otf` (500)
- `Fellix-SemiBold.otf` (600)
- `Fellix-Bold.otf` (700)
- `Fellix-ExtraBold.otf` (800)

The `.otf` files are **git-ignored** and must NOT be committed.

## ⚠️ Licensing

The weights used in dev are **Fellix TRIAL — "Personal Use Only"** and **cannot ship to
production**. Before deploy, either license Fellix (drop the licensed `.otf`s here under the same
names) or accept the system-sans fallback. Nothing in the build forces Fellix — it degrades cleanly.
