# IG post comparison test — HTML/Chromium vs Canva

Srovnávací test: ze stejného článku vyrobit vizuál na Instagram/Facebook dvěma
různými způsoby a porovnat čas a (odhad) tokenů.

- **`html-agent/`** — vizuál vyrenderovaný z HTML šablony přes headless Chromium (Playwright).
- **`canva-agent/`** — vizuál vyrobený naplněním existující Canva šablony (`DAHOBdpJ1tk`,
  stejná jako produkční `agro-socials-local`).
- **`shared/`** — společné nástroje, které používají oba agenti, aby startovali
  ze stejných dat:
  - `fetch-article.sh "část titulku"` — načte článek z Profifarmar API
  - `cloudinary-upload.sh <png> <public_id>` — nahraje PNG na Cloudinary

## Rozsah testu

**Test se zastavuje před publikací.** Oba agenti dojedou k hotovému PNG na
Cloudinary + textům pro IG/FB (stejná pravidla copywritingu jako
`agro-socials-local` Krok 5). Nic se nepostuje na Buffer/Instagram/Facebook —
srovnává se jen výroba vizuálu.

## Průběh

1. Uživatel zadá název/téma článku.
2. Oba agenti (Canva, HTML) dostanou **identický vstupní prompt** lišící se jen
   metodou výroby vizuálu — spouští se paralelně jedním tool-call blokem.
3. Každý agent si zapisuje časová razítka kroků do `timing.json` ve své
   pracovní složce (`date +%s` před/po každém kroku).
4. Po dokončení obou se sestaví srovnávací report: čas od startu do hotového
   Cloudinary URL u obou, počet a typ nástrojových volání (proxy pro cenu),
   a pokud runtime vrátí usage/token metadata, i ta.

## Poznámka k měření tokenů

Claude Code (Agent tool) nevrací přesný token counter pro subagenta zpět do
rodičovské konverzace jako strukturovaná data. Reálný čas měříme přesně
(timestamp před spuštěním / po dokončení). Tokeny odhadujeme nepřímo — počet
tool-call kroků, počet API volání a délka promptů/výstupů každého agenta —
a řekneme to takhle uživateli, ne jako přesné číslo, pokud runtime žádné
přesné číslo nevrátí.
