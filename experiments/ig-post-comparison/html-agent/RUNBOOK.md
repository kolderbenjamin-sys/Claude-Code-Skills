# RUNBOOK — HTML/Chromium agent

Vyrob vizuál na sociální sítě z článku pomocí HTML šablony vyrenderované přes
headless Chromium. **Nic nepublikuj** — konči hotovým Cloudinary URL a texty.

Pracovní složka: `experiments/ig-post-comparison/html-agent/`
Log časování: zapisuj do `timing.json` v této složce, formát:
`{"step":"fetch_article","start":<unix>,"end":<unix>}` (append, jeden řádek = jeden krok).

## Krok 0 — start

```bash
date +%s   # zapiš jako start celého běhu
```

## Krok 1 — načti článek

```bash
../shared/fetch-article.sh "[NÁZEV/TÉMA ČLÁNKU OD UŽIVATELE]"
```

Z JSON vytáhni: `title`, `category_id`, `published_at`, `cover_image_url`, `slug`.

**Mapování `category_id` → kategorie:** 1 ROSTLINNÁ VÝROBA, 2 ŽIVOČIŠNÁ VÝROBA,
3 TECHNIKA, 4 LEGISLATIVA, 5 TRHY & CENY, 6 AGROEKOLOGIE.

**Datum:** měsíc + rok z `published_at`, velkými písmeny, + region (`· ČR` default,
`· EU` pokud jde o celoevropské téma, jinak konkrétní zemi). Formát: `ČERVEN 2026 · ČR`.

**Titulek:** pokud delší než ~75 znaků, smysluplně zkrať (zachovej hlavní číslo/fakt).

## Krok 2 — vyrenderuj PNG

```bash
export NODE_PATH=/opt/node22/lib/node_modules
node render.js '{
  "category": "[KATEGORIE]",
  "date": "[DATUM]",
  "title": "[TITULEK]",
  "coverUrl": "[cover_image_url z článku]",
  "logoUrl": "https://res.cloudinary.com/dxrpsbvx2/image/upload/v1788085090/BRAND/profifarmar-logo-krem.png",
  "outPath": "/tmp/ig_html_[slug].png"
}'
```

Zkontroluj výstup (`Read` na PNG) — titulek čitelný a zalomený, cover na místě,
branding zachovaný (barvy dle `BRAND.md`: krém `#F5F1E7`, terakota `#B5502E`,
zlatá `#AD8A3D`, tmavě zelená `#2C4429`).

## Krok 3 — nahraj na Cloudinary

```bash
../shared/cloudinary-upload.sh /tmp/ig_html_[slug].png "social_html_[YYYY-MM]_[slug]"
```

→ ulož výstupní URL jako `[CLOUDINARY_URL]`.

## Krok 4 — copywriting

Stejná pravidla jako produkční skill `agro-socials-local` (viz
`.claude/skills/agro-socials-local/SKILL.md`, Krok 5):

- **Instagram:** 1–3 věty, max 150 znaků, CTA „Celý článek v biu ↗" nebo
  „Uložte si to 🔖", přesně 5 hashtagů (`#zemedelstvi #agro #ceskezemedelstvi
  #profifarmar` + 1–2 tematické).
- **Facebook:** 2–4 věty, max 250 znaků, CTA „Co na to říkáte? 💬" nebo
  „Sdílejte mezi sousedy", odkaz na článek na konci, 1–2 hashtagy.

## Krok 5 — shrnutí (BEZ publikace)

```
✅ HTML agent hotov
🖼️  [CLOUDINARY_URL]
📝 IG: "[text]"
📝 FB: "[text]"
⏱️  timing.json — [N] kroků, celkový čas [X]s
```
