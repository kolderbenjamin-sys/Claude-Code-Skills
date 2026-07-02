---
name: profifarmar-prompt
description: >
  Generuje sadu 3 kopírovatelných promptů pro zemědělský "Before & After" obsah:
  Gemini PŘED, Gemini PO, a Google Labs Flow video prompt.
  Použij tento skill vždy když uživatel chce: vygenerovat agro prompty, spustit ProfiFarmar pipeline,
  připravit before/after zemědělský obsah, nebo začít tvorbu renovačního videa.
  Trigger keywords: profifarmar, agro prompt, before after prompt, gemini agro, renovace stroje prompt,
  kombajn prompt, traktor before after, zemědělský obsah generovat.
  Aktivuj kdykoli uživatel chce začít tvorbu agro vizuálního obsahu — i bez explicitní zmínky o promptech.
---

# ProfiFarmar-prompt

Generuje 3 připravené prompty pro pipeline: Gemini (PŘED) → Gemini (PO) → Google Labs Flow.
Výstup: 3 kopírovatelné bloky textu v angličtině, připravené k přímému vložení.

---

## Vstup

Uživatel může zadat seed (volitelně):
- typ stroje (např. "kombajn", "Zetor", "červená")
- prostředí (např. "noční dílna", "pole")
- stav nebo barva

Pokud **žádný vstup není** → vygeneruj vše autonomně z poolů níže.
Pokud **část vstupu je** → použij zadané (přelož do angličtiny), zbytek doplň z poolů.

---

## Pool proměnných — vždy vyber náhodně, vyhýbej se opakování

### Machines (10+)
- Zetor 7245 tractor
- Case IH Magnum 380 tractor
- Fendt 942 Vario tractor
- John Deere 8R 410 tractor
- Massey Ferguson 8S.265 tractor
- Valtra T254 Versu tractor
- John Deere S790 combine harvester
- Horsch Maestro 12 SW seed drill
- Amazone UX 5200 field sprayer
- New Holland BB 1290 square baler
- Holmer Terra Dos T4-40 sugar beet harvester

### Environments (10+)
- abandoned barn at dusk
- foggy field at sunset
- night industrial workshop with floodlights
- rural farmyard in early morning mist
- metal hangar hall with backlit haze
- open-air repair yard at the edge of a forest
- damp concrete storage with dripping ceiling
- summer field with tall crops in the background
- winter courtyard with light snow cover
- old farmstead with weathered brick wall

### Before — damage types (10+)
- completely seized engine, missing wheels, chassis sunk into overgrown ground — clearly immobile for years
- catastrophic rust perforation through the body, collapsed cab roof, front axle broken and resting on ground
- gutted interior, missing engine hood, all four tires flat and disintegrated, frame visibly bent
- massive collision damage to the front — hood crumpled, radiator destroyed, one wheel torn off completely
- decades of outdoor neglect: thick vegetation growing through the cab, entire undercarriage buried in mud and rust
- fire-damaged cab with melted plastic and blackened metal, engine compartment hollowed out
- severe structural rust — side panels falling off, exhaust system collapsed, rear axle cracked through
- abandoned in a flooded ditch, submerged to the axles, body panels detached, glass completely missing
- rolled-over posture: roof crushed flat, all mirrors gone, hydraulic arms torn from the body
- total drivetrain failure visible from outside — differential exposed and shattered, fuel tank punctured and drained

### After — restoration targets (10+)
- repainted RAL 1023 Traffic Yellow with new LED headlights
- full repaint RAL 3020 Traffic Red with chrome details
- RAL 6018 Yellow Green matte finish with new tires
- RAL 5010 Gentian Blue gloss with polished aluminum rims
- original factory color restored with ceramic protective coat
- RAL 9005 Jet Black matte with orange accents and sport exhaust
- RAL 2004 Pure Orange with fully refurbished cab interior
- two-tone split RAL 7016 anthracite / RAL 1021 yellow
- RAL 6005 Moss Green vintage style with patina effect
- full brushed metal vinyl wrap with new lighting system

---

## Instrukce pro výběr

1. Pokud uživatel zadal seed → respektuj ho (přelož do angličtiny), zbytek vyber z poolů
2. Vyber **jednu kombinaci** — stroj + prostředí + poškození + cíl
3. Kombinace musí být **vizuálně zajímavá a kontrastní** (PŘED vs PO)
4. **Nikdy nevyber kombinaci** kterou jsi v tomto chatu již použil
5. Preferuj méně obvyklé kombinace nad generickými

---

## Výstup — pouze 3 kopírovatelné bloky

### PROMPT 1 — Gemini (BEFORE)

```
Generate an image of a severely wrecked, non-operational machine awaiting restoration. Cinematic photograph, three-quarter perspective of a [MACHINE] in [ENVIRONMENT]. The machine is completely immobile and beyond obvious self-repair: [BEFORE_DAMAGE]. The vehicle looks abandoned, devastated, and unfit for any use. Atmospheric low-key lighting, high-contrast, dusty and decayed environment. 4K, ultra-detailed textures, masterpiece quality. Vertical portrait orientation 9:16.
```

---

### PROMPT 2 — Gemini (AFTER)

```
Create an image of the same machine after complete restoration. The [MACHINE] now shows [AFTER_TARGET]. Brilliant saturated colors, gleaming metallic surface, bright headlights illuminating dusty air. Same [ENVIRONMENT] setting and identical camera angle. 4K, ultra-detailed textures, masterpiece quality. Vertical portrait orientation 9:16.
```

---

### PROMPT 3 — Google Labs Flow

```
Cinematic 8-second restoration timelapse, static camera, three-quarter perspective of a [MACHINE] in [ENVIRONMENT]. The sequence starts with a completely wrecked, immobile machine: [BEFORE_DAMAGE]. The transformation progresses linearly and realistically into [AFTER_TARGET]. Fast-moving workers are seen rebuilding the chassis, replacing destroyed components, and painting in a brilliant, saturated color. The process is physically consistent, focusing on the dramatic contrast between devastated wreck and gleaming restored machine. Atmospheric low-key lighting with high-contrast sparks from metalwork. At the 7-second mark, the restoration is complete, and the machine's bright headlights illuminate the dusty air. 4K, ultra-detailed textures, masterpiece quality.
```
