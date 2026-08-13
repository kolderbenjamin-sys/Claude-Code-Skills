---
name: skills-sync
description: >
  Porovná lokální Claude skilly s jejich verzí v GitHub repozitáři
  kolderbenjamin-sys/Claude-Code-Skills, najde rozdíly a po odsouhlasení je
  srovná tak, aby byly na obou místech stejné. U každého konfliktu se ptá,
  která verze je ta správná — nikdy nepřepisuje bez potvrzení.
  Použij tento skill vždy, když uživatel chce: zkontrolovat skilly,
  porovnat skilly s GitHubem, srovnat lokální a GitHub skilly, zálohovat
  skilly do repa, zjistit co se v skillech změnilo, nebo nahrát nové skilly
  na GitHub. Trigger keywords: skills sync, sync skilly, zkontroluj skilly,
  porovnej skilly, srovnej skilly, skilly na githubu, aktualizuj repo skilly,
  záloha skillů, rozdíly ve skillech, nahraj skilly na github, stáhni skilly
  z githubu, jsou skilly stejné.
metadata:
  version: "1.0.0"
  author: "Benjamin Kolder"
---

# Skills Sync

Obousměrná synchronizace vlastních skillů mezi tímto strojem a repozitářem
`kolderbenjamin-sys/Claude-Code-Skills` (složka `.claude/skills/`).

## Co skill dělá a co ne

- **Řeší jen vlastní skilly** — ty, které mají v `manifest.json` `source: custom`
  (agro-*, profifarmar-*, calendar-skill a další, co si uživatel vytvořil).
  Vestavěné Anthropic skilly (pdf, docx, xlsx, pptx, skill-creator, morning, …)
  se ignorují. Uživatel je může vynutit pomocí `--all`.
- **Nikdy nepřepisuje bez potvrzení.** U každého rozdílu se ptá, která strana
  je zdroj pravdy.
- **Zálohuje.** Každý zápis nejdřív uloží cílovou složku do
  `~/.claude/skills-sync-backups/<čas>/`.
- Sám sebe (`skills-sync`) neřeší nijak zvlášť — pokud žije jen v repu,
  ohlásí se jako `JEN REPO`, což je v pořádku, dokud si ho uživatel nenainstaluje
  i lokálně.

## Kde skilly leží

| Místo | Cesta | Poznámka |
|---|---|---|
| Lokální (sync z claude.ai) | `~/.claude/skills/synced/<jméno>/` | řízeno appkou, viz varování níže |
| Lokální (ruční) | `~/.claude/skills/<jméno>/` | neřízené, bezpečné pro zápis |
| Repo | `<klon>/.claude/skills/<jméno>/` | zdroj pro GitHub |

**Varování o `synced/`:** tuto složku plní sync z claude.ai. Zápis do ní
(směr repo → local) může být při dalším syncu přepsán. Když se opravuje skill
tímto směrem, řekni uživateli, ať ho **upraví i v nastavení skillů na claude.ai**,
jinak se změna po čase ztratí. Do repa (směr local → repo) se to netýká.

## Postup

### 1. Zajisti klon repozitáře

Skripty repo hledají samy: `--repo`, pak `$SKILLS_REPO_DIR`, pak aktuální
adresář a jeho rodiče (podle `origin` remote), pak obvyklá místa v `~`.
Když nic nenajdou, skončí s kódem 3 — v tom případě naklonuj:

```bash
git clone https://github.com/kolderbenjamin-sys/Claude-Code-Skills.git ~/Claude-Code-Skills
```

Když klon už existuje, natáhni si aktuální stav, ať neporovnáváš proti starým datům:

```bash
cd <klon> && git checkout main && git pull origin main
```

Pokud `main` neexistuje nebo má repo jinou výchozí větev, zjisti ji:
`git symbolic-ref --short refs/remotes/origin/HEAD`.

### 2. Vypiš rozdíly

```bash
python3 .claude/skills/skills-sync/scripts/skills_diff.py --repo <klon>
```

Užitečné přepínače: `--all` (i vestavěné skilly), `--exclude jmeno1 jmeno2`,
`--json` (strojové zpracování).

Stavy ve výpisu:

| Stav | Význam |
|---|---|
| `OK` | shodné, nic se nedělá |
| `LIŠÍ SE` | existuje na obou místech, obsah se liší |
| `JEN LOKÁL` | chybí v repu |
| `JEN REPO` | chybí lokálně |

### 3. Ukaž uživateli přehled

Napiš stručnou tabulku: jméno skillu, stav, u `LIŠÍ SE` i které soubory.
Skilly ve stavu `OK` shrň jedním řádkem („X skillů je shodných"), nevypisuj je
po jednom.

### 4. U každého rozdílu se zeptej

Pro `LIŠÍ SE` **nejdřív ukaž skutečný diff**, ať se dá rozhodnout:

```bash
diff -u <klon>/.claude/skills/<jméno>/SKILL.md ~/.claude/skills/synced/<jméno>/SKILL.md
```

Když je diff dlouhý, shrň ho slovy (co přibylo/ubylo, jestli jde o novější
verzi, nebo o poškozený soubor) a ukaž jen podstatné kusy.

Pak se zeptej pomocí `AskUserQuestion` — jedna otázka na skill, volby:

- **Lokální verze je správná** → `--direction local-to-repo`
- **Verze z GitHubu je správná** → `--direction repo-to-local`
- **Nechat být** → přeskočit

Pro `JEN LOKÁL`: nahrát do repa (`local-to-repo`), nebo smazat lokálně
(`delete-local`), nebo přeskočit.
Pro `JEN REPO`: stáhnout lokálně (`repo-to-local`), nebo smazat z repa
(`delete-repo`), nebo přeskočit.

Když je rozdílů víc a jdou stejným směrem, spoj je do jedné otázky
s možností „vše lokální → repo" místo osmi samostatných dotazů.

Mazání navrhuj až jako druhou možnost — je destruktivní, i když se zálohuje.

### 5. Aplikuj

Jedna akce = jedno spuštění:

```bash
python3 .claude/skills/skills-sync/scripts/apply_sync.py \
  --skill <jméno> --direction local-to-repo --repo <klon>
```

Přidej `--dry-run`, když si chceš ověřit, co se stane, než to uděláš doopravdy.
Skript zrcadlí: zkopíruje soubory ze zdroje a smaže v cíli ty navíc, takže
výsledek je bajt po bajtu shodný.

### 6. Ověř a commitni

```bash
python3 .claude/skills/skills-sync/scripts/skills_diff.py --repo <klon>
```

Všechno vyřešené má být `OK` (kromě toho, co uživatel vědomě přeskočil).
Pak v klonu:

```bash
cd <klon>
git add -A .claude/skills
git commit -m "Sync skills: <stručný seznam změn>"
git push -u origin <větev>
```

Když push selže na síti, zkus znovu s odstupem 2s, 4s, 8s, 16s.

Pull request otevírej **jen když o něj uživatel výslovně požádá**.

### 7. Shrň výsledek

Krátce: co se nahrálo, co stáhlo, co se přeskočilo a proč, kde jsou zálohy.
Když se něco zapsalo do `synced/`, zopakuj varování z úvodu.

## Časté nálezy

- **Zdvojená frontmatter hlavička.** Soubor začíná dvěma bloky `---` za sebou
  (typicky po ručním uploadu přes web). Claude Code čte jen ten první, takže
  skill přijde o `metadata` a část popisu. Poznáš to podle `head -10 SKILL.md`.
  Není to legitimní rozdíl k synchronizaci — je to poškozený soubor, oprav ho
  smazáním duplicitního bloku a ptej se, jestli má opravená verze jít do repa.
- **Skill je ve dvou lokálních kořenech zároveň** (`synced/` i `~/.claude/skills/`).
  Skript to nahlásí v sekci „Pozor" a použije verzi ze `synced/`. Nech uživatele
  jednu z kopií smazat, jinak nebude jasné, která se používá.
- **Změna je jen v datu/verzi v `metadata`.** Ber jako běžný rozdíl, ale zmiň to
  — často stačí vzít novější verzi.
