---
name: calendar-skill
description: >-
  Zachytí Benovy nápady a úkoly (pro Profifarmář nebo jakýkoli jiný projekt) vyřčené volně v chatu
  a uloží je jako celodenní událost do jeho Google kalendáře AI Work. Použij tento skill VŽDY, když
  Ben v konverzaci zmíní, že chce něco udělat, vyřešit, opravit, doplnit nebo naprogramovat
  v budoucnu — i bez explicitní žádosti typu přidej do kalendáře nebo naplánuj úkol. Trigger fráze
  jako chci ještě udělat X, potřebuju vyřešit Y, napadlo mě Z, musím opravit, měl bych se na to
  podívat, to bychom měli někdy udělat, TODO, nebo jakákoliv zmínka o budoucím technickém či
  produktovém úkolu, který není potřeba řešit hned v této konverzaci. NEPOUŽÍVEJ tento skill, pokud
  Ben chce úkol vyřešit HNED v aktuální konverzaci (v tom případě ho prostě vyřeš) — skill je jen
  pro věci odložené na později.
---

# AI Work — zachycení úkolu do kalendáře

Ben si takhle buduje externí paměť na nápady: cokoliv, co chce udělat později (u Profifarmáře i jinde), se místo držení v hlavě rovnou zapíše jako celodenní událost do jeho Google kalendáře **"AI Work"**. Večer mu běží samostatný scheduled task (`ai-work-evening-checkin`), který kalendář projde, zeptá se co je hotové, a nedokončené položky přeskládá. Tenhle skill řeší jen tu první část — zachycení nového nápadu v okamžiku, kdy ho Ben vysloví, v jakémkoli chatu.

## Kdy zasáhnout

Ben typicky nemluví v imperativech pro tebe ("přidej úkol") — spíš jen přemýšlí nahlas o tom, co by chtěl udělat. Pokud z kontextu je jasné, že jde o něco, co se má udělat POZDĚJI (ne v této konverzaci hned), zachyť to. Pokud chce věc vyřešit rovnou teď, nezasahuj tímto skillem — udělej tu práci.

## Kalendář

- Název: **AI Work**
- Calendar ID: `647df95e6a854feaa9f989727d7cdf6b596076eedf86e1359b42262d6666c42d@group.calendar.google.com`
- Google Calendar MCP nástroje bývají deferred — najdi je přes `ToolSearch` s dotazem `"calendar"` (potřebuješ `list_events` a `create_event`).

## Co NEPATŘÍ do tohoto kalendáře

Nezapisuj sem věci, které už běží jako plně autonomní pipeline a nepotřebují ruční dohled: psaní agro článků (skill `agro-journalist`) a publikování na sociální sítě (skilly `agro-socials-local`, `agro-socials-cloud`). Pokud Ben zmíní něco v této oblasti, zvaž jestli nejde spíš o spuštění existující pipeline než o nový úkol k naplánování.

## Postup

1. **Zjisti volný den.** Zavolej `list_events` na kalendáři AI Work pro dnešek + následující 2-3 dny (zjisti dnešní datum přes `date` v bashi). Vyber nejbližší den, který ještě není přeplněný (orientačně do ~3-4 položek na den) — necháváš tím Benovi prostor, protože neví dopředu, kdy přes den bude mít čas. Nemusíš se ptát, na který den — vyber sám podle vytíženosti, ledaže Ben sám řekne konkrétní den ("v pátek", "příští týden").

2. **Vytvoř celodenní událost** (`allDay: true`, žádný pevný čas — Ben si čas rozvrhuje sám během dne):
   - `summary`: krátký název úkolu + odhad trvání v závorce, např. "Vyřešit X (~1h)". Odhadni trvání podle povahy úkolu (rychlá oprava ~15-30 min, menší feature/skill úprava ~1-2h, něco většího ~půl dne) — je to jen orientační pomůcka pro Bena, ne závazek.
   - `description`: musí obsahovat **solution-kit** (viz níže) — to je hlavní hodnota tohoto skillu, ne jen holý zápis do kalendáře.

3. **Solution-kit v popisu** — přesně v tomto formátu:
   ```
   Doporučeno: <platforma> — <jedna věta proč>

   Prompt:
   <text promptu>
   ```

   **Volba platformy** (vyber jednu, zdůvodni stručně):
   - **Claude Code** — úkol je o kódu, repu, gitu, CLI skriptech, buildu/deployi, nebo věcech mimo Cowork ekosystém.
   - **Cowork** — úkol se týká souborů (docx/xlsx/pptx/pdf), existujících agro skillů, connectorů (Gmail, Calendar, Cloudinary...), automatizací, úpravy skillů přes `skill-creator`, nebo browsing/computer-use. Většina Profifarmář úkolů sem spadá, protože celá ta pipeline žije jako sada Cowork skillů.
   - **Claude chat** — čisté psaní, brainstorming, výzkum nebo rozhodování, kde nejsou potřeba žádné soubory ani nástroje.

   **Prompt musí VŽDY začínat instrukcí, ať se Claude nejdřív doptá na chybějící detaily**, než se pustí do práce — protože Ben zadání zapisuje ve spěchu / narychlo a chybí mu čas rozepsat scope do detailu. Cíl je, aby si to Claude v okamžiku spuštění promptu doplnil interaktivně, místo aby si scope domýšlel a minul se cílem. Např.:
   > "Než začneš cokoliv dělat, doptej se mě na [2-4 konkrétní otevřené otázky relevantní k tomuto úkolu], abychom se dobrali k nejlepšímu řešení. Teprve pak pokračuj."

   Otázky v promptu piš konkrétně k danému úkolu (ne obecně "jaké máš požadavky") — vycházej z toho, co už o úkolu víš z kontextu konverzace, a ptej se na to, co chybí (rozsah, edge cases, kam přesně to má zapadat, priority).

4. **Potvrď stručně.** Po vytvoření události napiš Benovi jednu větu, na který den jsi úkol zařadil — bez zbytečného rozvádění, on si detail může kdykoliv otevřít v kalendáři.

## Příklad

**Ben napíše:** "jo a měl bych taky přidat retry logiku do toho publish skriptu, občas Buffer spadne a post se ztratí"

**Ty vytvoříš** celodenní událost na nejbližší volný den, summary: "Přidat retry logiku do Buffer publish skriptu (~1h)", description:
```
Doporučeno: Cowork (skill-creator) — jde o úpravu existujícího agro-publisher/agro-socials skillu, ne o samostatný repo projekt.

Prompt:
Chci přidat retry logiku do publish kroku mé agro pipeline (Buffer API volání v agro-socials/agro-publisher skillu) — občas Buffer spadne/timeoutne a post se ztratí. Než začneš upravovat, doptej se mě na:
1. Kolik pokusů o retry a jaký interval mezi nimi (fixní, nebo exponenciální backoff)?
2. Jak poznat, že Buffer volání selhalo vs. jen pomalu odpovědělo (timeout hranice)?
3. Co se má stát, když selžou i všechny retry — má se mi to nahlásit, uložit jako draft, nebo zkusit jinou cestu?
4. Má se retry logika týkat jen tohoto jednoho skillu, nebo všech míst, kde se volá Buffer?
Podle odpovědí uprav příslušný skill přes skill-creator.
```

Odpověz Benovi: "Přidáno na [den] — retry logika do Buffer publish."
