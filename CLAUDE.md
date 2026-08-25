# Pravidla pro práci se skilly v tomhle repu

Sbírka vlastních Claude skillů (`agro-*`, `profifarmar-*`, `calendar-skill`,
`skills-sync`). **Repozitář je veřejný.**

## 1. Žádné klíče ve skillech — nikdy

V červenci 2026 tu ležel Cloudinary API secret a Profifarmar token natvrdo ve
čtyřech skillech. Veřejně, v git historii. Oba se musely rotovat.

Klíče se čtou **výhradně z proměnných prostředí**. Kam patří a jak se nastavují,
popisuje [`SECRETS.md`](SECRETS.md).

```powershell
# lokální skilly (Windows) — MCP PowerShell session NEDĚDÍ $env:, čti User scope
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
if (-not $token) { Write-Output "[SKILL] CHYBA — AI_API_KEY není nastavena. Viz SECRETS.md."; exit 1 }
```

```bash
# cloud Routine
: "${AI_API_KEY:?AI_API_KEY chybí — nastav v Environment routine}"
```

Nikdy:

- hodnota klíče přímo v souboru, ani „dočasně, než to rozjedu"
- čtení tokenů z `claude_desktop_config.json` a podobných konfiguráků
- `echo $AI_API_KEY` / `Write-Output $token` — klíč skončí v logu Routine i v chatu
- diktování klíče do PowerShellu jako literál — uloží se do historie na disku;
  použij `Read-Host`

Když proměnná chybí, skill **skončí s jasnou hláškou**. Nepokouší se pokračovat.

Před commitem:

```bash
./scripts/check-secrets.sh
```

## 2. Limity pro upload na claude.ai

Upload odmítne skill tvrdou chybou, když:

| Limit | Hodnota |
|---|---|
| `description` | max **1024 znaků** |
| povolená pole ve frontmatteru | `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` — nic jiného |
| balíček | `.zip` nebo `.skill`, musí obsahovat `SKILL.md` |

Do `description` patří jen to, podle čeho se pozná, **kdy skill spustit** — co dělá,
čím se liší od podobných skillů, a trigger keywords. Implementační detaily
(přesné časy, endpointy, postupy) patří do těla `SKILL.md`, ne do description.

Kontrola před balením:

```bash
python3 -c "
import pathlib,re,yaml
for p in sorted(pathlib.Path('.claude/skills').glob('*/SKILL.md')):
    fm=yaml.safe_load(re.match(r'^---\n(.*?)\n---\n',p.read_text(encoding='utf-8'),re.S).group(1))
    n=len((fm.get('description') or '').strip())
    extra=set(fm)-{'name','description','license','compatibility','metadata','allowed-tools'}
    print(f\"{p.parent.name:26} {n:>5} {'❌' if n>1024 or extra else '✅'} {extra or ''}\")"
```

Při balení vynech `__pycache__` a `*.pyc`.

## 3. Synchronizace repo ↔ claude.ai

Skilly žijí na dvou místech a **zdroj pravdy je claude.ai**:

| Místo | Cesta | Kdo to plní |
|---|---|---|
| účet | Customize → Skills | uživatel ručně (upload zipu) |
| lokální kopie | `~/.claude/skills/synced/` | sync z claude.ai — **přepisuje se** |
| repo | `.claude/skills/` | git |

Oprava jen v `synced/` je k ničemu — příští sync ji přepíše. Když se skill mění,
musí se nahrát i na claude.ai, jinak se změna ztratí.

Cloud Routines skilly z účtu neberou stejně: čtou je i z naklonovaného repa, takže
po opravě je potřeba **sloučit do `main`**, ne to nechat na větvi.

Porovnání: `python3 .claude/skills/skills-sync/scripts/skills_diff.py --repo .`

**Konce řádků:** kopie ze syncu chodí s CRLF, repo má LF. Není to rozdíl v obsahu —
`skills_diff.py` to normalizuje. Nediv se, když `diff` ukáže celý soubor jako změněný.

## 4. Co v repu není

`agro-aktuality` a `agro-stories-cloud` si vedou logy v kořeni repa
(`posted-ticker-log.json`, `posted-stories-log.json`) — paměť proti duplicitám.
Ty logy se commitují; bez nich si běh v čerstvém kontejneru nic nepamatuje.
