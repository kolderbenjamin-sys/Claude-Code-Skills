# API pásku Aktuality (Ticker) — ověřený kontrakt

Změřeno 19. 8. 2026 proti ostrému provozu. Všechny čtyři metody fungují.

## Čtení — veřejné, bez tokenu

```
GET https://profifarmar.cz/api/aktuality.php
200 -> {"data":[{"id":4,"label":"AGROTECH","text":"…","created_at":"2026-08-19 12:53:26.224958","updated_at":"…"}]}
```

Vrací všechny položky pásku. Token nechce a ignoruje ho. Na tomhle endpointu
funguje **jen GET** — zápis přes něj nejde (odpoví výpisem, ať pošleš cokoli).

## Zápis — `aktuality_webhook.php`, servisní klíč

Společné pro všechny tři metody:

```
https://profifarmar.cz/api/aktuality_webhook.php
Content-Type: application/json
Authorization: Bearer <AI_API_KEY>
```

| Metoda | Tělo | Úspěch | Chyby |
|---|---|---|---|
| `POST` | `{"label":"SUCHO","text":"…"}` | `201 {"success":true,"data":{…}}` | `400` chybí pole / překročená délka |
| `PUT` | `{"id":4,"label":"…","text":"…"}` | `200 {"success":true,"data":{…}}` | `404` neexistuje, `400` chybí id |
| `DELETE` | `{"id":4}` | `200 {"success":true,"id":4}` | `404` neexistuje, `400` chybí id |

Bez tokenu nebo se špatným tokenem: `401 {"error":"Neautorizovaný přístup"}`.
`GET` na tomhle endpointu vrací `405` — na čtení je veřejný endpoint výše.

### Ověřené chování

- **Délky vynucuje server**: `label` nad 50 znaků a `text` nad 200 znaků
  odmítne `400 {"error":"Pole text nesmí překročit 200 znaků"}`.
- **`PUT` zachovává `created_at`** a posouvá jen `updated_at` — upravená
  položka tedy nepřeskočí v pásku dopředu. Ověřeno na položkách #4 a #6.
- **`PUT` je částečný**: pošli jen `id` a pole, která měníš.
- **Strop 5 položek server nehlídá** — dnes ho drží jen frontend (v adminu
  zešedne tlačítko) a `scripts/ticker.py`. Šestou položku by API vzalo.
  Kdyby se to mělo dořešit na serveru, je to `409` v POST větvi při
  `COUNT(*) >= 5`.
- **Diakritika**: posílej JSON s escapovanými non-ASCII znaky (`\uXXXX`),
  jak to dělá `json.dumps(..., ensure_ascii=True)`. Uloží se správně.

## Admin endpoint — nepoužívat

`/api/admin/aktuality.php` (GET/POST/PUT/DELETE) obsluhuje admin rozhraní pro
člověka a uznává výhradně session token z `POST /api/admin/auth.php`
(`{username, password}`). Servisní klíč tam dostane
`401 {"error":"Neplatná nebo vypršená session"}`. Skript ho záměrně nevolá —
automatizace nemá držet heslo do adminu, a webhook umí totéž.

## Články jako zdroj

```
GET https://profifarmar.cz/api/webhook.php?limit=10000
Authorization: Bearer <AI_API_KEY>
```

Vrací `id`, `title`, `slug`, `category_id`, `status`, `published_at`,
`cover_image_url` — **žádný perex ani body**, a filtr podle `id` ani `slug`
nezná (parametry ignoruje). Text článku se bere z veřejné stránky
`https://profifarmar.cz/clanek/<slug>/`. Bez `limit=10000` vrátí jen 100
záznamů, a ne spolehlivě těch nejnovějších.
