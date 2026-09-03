# RUNBOOK — Canva agent

Vyrob vizuál na sociální sítě z článku naplněním existující Canva šablony
(`DAHOBdpJ1tk` — ProfiFarmář 4:5 Stacked), stejně jako produkční skill
`.claude/skills/agro-socials-local/SKILL.md`. **Nic nepublikuj** — konči
hotovým Cloudinary URL a texty (přeskoč Krok 6/Buffer z originálního skillu).

Pracovní složka: `experiments/ig-post-comparison/canva-agent/`
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
Stejné mapování kategorií, formát data a zkracování titulku jako v
`html-agent/RUNBOOK.md` Krok 1 (musí to být identický vstup, aby srovnání bylo fér).

## Krok 2 — naplň Canva šablonu (MCP)

Tahle session má jinou verzi Canva MCP než originální skill (žádné
`start-editing-transaction`/`perform-editing-operations`/`commit-editing-transaction`).
Ekvivalentní postup s dostupnými nástroji:

1. `mcp__Canva__copy-design` designId `DAHOBdpJ1tk` → `[COPY_ID]`
2. `mcp__Canva__upload-asset-from-url` url `[cover_image_url]` name `cover_[slug]`
   → `[COVER_ASSET_ID]` (paralelně s krokem 1)
3. `mcp__Canva__read-design` designId `[COPY_ID]` s `open_transaction: true` a
   `filter.fields: ["thumbnails"]` → přečti `locator_id` pro kategorii, datum,
   titulek a cover (viz orientační tabulka element IDs v originálním skillu,
   ale **autorita jsou vždy locator_ids z téhle odpovědi**) a ulož
   `transaction_id` jako `[TX_ID]`
4. `mcp__Canva__edit-design` transaction_id `[TX_ID]` page_index `1`
   finalize `keep_open`, operations:
   - `replace_text` na locator kategorie → `[KATEGORIE]`
   - `replace_text` na locator data → `[DATUM]` (**vždy**, i když vypadá aktuálně)
   - `replace_text` na locator titulku → `[TITULEK]`
   - `update_fill` na locator cover image, asset_type `image`,
     asset_id `[COVER_ASSET_ID]`, alt_text `[TITULEK]`
5. Porovnej before/after thumbnail z odpovědí, pak
   `mcp__Canva__edit-design` transaction_id `[TX_ID]` finalize `commit`
   operations `[]` (IREVERZIBILNÍ)

## Krok 3 — export PNG

```
mcp__Canva__export-design
  designId: [COPY_ID]
  format: { type: png, width: 1080, lossless: true, export_quality: pro, pages: [1] }
```

Stáhni PNG lokálně (`curl` z vrácené URL — platí omezeně, stáhni hned):

```bash
curl -sS -o /tmp/ig_canva_[slug].png "[PNG_URL]"
```

## Krok 4 — nahraj na Cloudinary

```bash
../shared/cloudinary-upload.sh /tmp/ig_canva_[slug].png "social_canva_[YYYY-MM]_[slug]"
```

→ ulož výstupní URL jako `[CLOUDINARY_URL]`.

## Krok 5 — copywriting

Identická pravidla jako `html-agent/RUNBOOK.md` Krok 4 (Instagram: max 150
znaků, přesně 5 hashtagů; Facebook: max 250 znaků, 1–2 hashtagy, odkaz na
článek) — texty musí vzniknout nezávisle, ne kopírovat HTML agenta.

## Krok 6 — shrnutí (BEZ publikace)

```
✅ Canva agent hotov
🖼️  [CLOUDINARY_URL]
📝 IG: "[text]"
📝 FB: "[text]"
⏱️  timing.json — [N] kroků, celkový čas [X]s
```
