# Kam patří API klíče

**Pravidlo č. 1: do skillu se klíč nikdy nepíše.** Tenhle repozitář je **veřejný** —
cokoliv se sem commitne, je veřejné navždy, i když se to později smaže (zůstává to
v git historii). Skilly proto čtou klíče výhradně z **proměnných prostředí**.

---

## Přehled proměnných

| Proměnná | K čemu | Kde ji vzít |
|---|---|---|
| `AI_API_KEY` | Profifarmar.cz API (články, aktuality) — Bearer token | admin Profifarmar.cz |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary — jméno cloudu | cloudinary.com → Dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary — API key | cloudinary.com → Dashboard |
| `CLOUDINARY_API_SECRET` | Cloudinary — API secret | cloudinary.com → Dashboard |
| `BUFFER_API_KEY` | Buffer — publikace na sítě | publish.buffer.com/settings/api |

Který skill co potřebuje:

| Skill | Běží kde | Potřebuje |
|---|---|---|
| `agro-journalist` | lokálně | `AI_API_KEY` |
| `agro-publisher` | lokálně | `AI_API_KEY` |
| `agro-cover-image` | lokálně | `AI_API_KEY`, `CLOUDINARY_*` |
| `agro-cover-image-gemini` | lokálně | `AI_API_KEY`, `CLOUDINARY_*` |
| `agro-socials-local` | lokálně | `AI_API_KEY`, `CLOUDINARY_*`, `BUFFER_API_KEY` |
| `profifarmar-publish` | lokálně | `CLOUDINARY_*`, `BUFFER_API_KEY` |
| `agro-socials-cloud` | cloud Routine | `AI_API_KEY`, `CLOUDINARY_*`, `BUFFER_API_KEY` |
| `agro-stories-cloud` | cloud Routine | `AI_API_KEY`, `CLOUDINARY_*`, `BUFFER_API_KEY` |
| `agro-aktuality` | cloud Routine | `AI_API_KEY` |

---

## A) Lokální skilly — Windows User env proměnné

Lokální skilly běží přes `mcp__Windows-MCP__PowerShell`. Ta session **nedědí** `$env:`,
proto se čte User scope: `[System.Environment]::GetEnvironmentVariable('NÁZEV', 'User')`.

### Nastavení (jednorázově)

Otevři **PowerShell** (stačí běžný, ne admin) a spusť — svoje hodnoty dosaď za `...`:

```powershell
[System.Environment]::SetEnvironmentVariable('AI_API_KEY',              '...', 'User')
[System.Environment]::SetEnvironmentVariable('CLOUDINARY_CLOUD_NAME',   '...', 'User')
[System.Environment]::SetEnvironmentVariable('CLOUDINARY_API_KEY',      '...', 'User')
[System.Environment]::SetEnvironmentVariable('CLOUDINARY_API_SECRET',   '...', 'User')
[System.Environment]::SetEnvironmentVariable('BUFFER_API_KEY',          '...', 'User')
```

Uloží se do registru uživatele (`HKCU\Environment`), přežije restart, nikam se necommitne.

> Klikací varianta: `Win` → „Upravit proměnné prostředí pro tento účet" →
> *Uživatelské proměnné* → **Nová…**

### Ověření

```powershell
'AI_API_KEY','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','BUFFER_API_KEY' |
  ForEach-Object {
    $v = [System.Environment]::GetEnvironmentVariable($_, 'User')
    if ($v) { "{0,-24} OK ({1} znaků)" -f $_, $v.Length } else { "{0,-24} CHYBÍ" -f $_ }
  }
```

Vypíše jen délku, ne hodnotu — klíč se tak neobjeví ve výstupu ani v historii chatu.

> **Po nastavení restartuj Claude Desktop.** Už běžící procesy si nové proměnné
> nenačtou.

---

## B) Cloud skilly — Environment v Claude Code

Skilly s příponou `-cloud` (a `agro-aktuality`) běží jako Routine v cloudu, kde žádné
Windows proměnné nejsou. Klíče se zadávají do **Environment**:

1. [claude.ai/code](https://claude.ai/code) → **Environments**
2. otevři environment, pod kterým Routine běží
3. **Environment variables** → přidej stejné názvy proměnných jako výše
4. ulož a Routine spusť znovu

Cloud skilly si na začátku existenci proměnné ověřují a bez ní rovnou skončí:

```bash
: "${AI_API_KEY:?AI_API_KEY chybí — nastav v Environment routine}"
```

Dokumentace: <https://code.claude.com/docs/en/claude-code-on-the-web>

---

## Co dělat, když klíč přesto unikne

1. **Okamžitě ho zneplatni (rotace)** u poskytovatele — smazání z kódu nestačí,
   klíč je v git historii i v případných forcích a cache.
2. Vygeneruj nový.
3. Ulož ho do env proměnné podle návodu výše — **ne** do souboru ve skillu.

Kde rotovat:

| Klíč | Kde |
|---|---|
| `AI_API_KEY` | admin Profifarmar.cz — vydat nový servisní klíč, starý zneplatnit |
| Cloudinary | cloudinary.com → Settings → Access Keys → *Rotate* |
| Buffer | publish.buffer.com/settings/api → revoke + vytvořit nový |

---

## Pravidla pro psaní skillů

- ✅ `$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')`
- ✅ `: "${AI_API_KEY:?chybí}"` (bash)
- ❌ `$apiKey = "963366..."` — hodnota přímo v souboru
- ❌ čtení tokenů z `claude_desktop_config.json` a podobných konfiguráků
- ❌ `Write-Output $token` / `echo $AI_API_KEY` — klíč se dostane do logu i do chatu
- Pokud proměnná chybí, skill **skončí s jasnou hláškou**, nepokouší se pokračovat

Před commitem projeď kontrolu:

```bash
git diff --cached | grep -nE '(api_?key|secret|token|password)\s*[=:]\s*["'"'"'][A-Za-z0-9_-]{16,}'
```
