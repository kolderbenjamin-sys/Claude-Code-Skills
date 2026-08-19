# Co ještě chybí na straně webu

Zakládání aktualit funguje (`/api/aktuality_webhook.php`, ověřeno 19. 8. 2026 — HTTP 201).
**Mazání a editace programově nejdou** — jediná cesta k `DELETE`/`PUT` vede přes
`/api/admin/aktuality.php`, který uznává výhradně session token z přihlášení
v adminu (`/api/admin/auth.php`). Servisní klíč `AI_API_KEY` tam dostane 401
`{"error":"Neplatná nebo vypršená session"}`.

Bez mazání nemůže rutina držet slíbenou rotaci „nejstarší ven, nová dovnitř" —
umí jen doplňovat do volných slotů a zbytek nahlásit k ručnímu úklidu.

Stačí jedna z variant níže. **Doporučená je A** — je menší a drží veškerou
automatizaci na jednom endpointu s jedním klíčem.

---

## Varianta A — doplnit DELETE do `aktuality_webhook.php`

Endpoint dnes odpovídá `405 {"error":"Metoda … není povolena"}` na všechno
kromě `POST`. Přidat k němu větev pro `DELETE` s tělem `{"id": 4}`:

```php
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'DELETE') {
    $input = json_decode(file_get_contents('php://input'), true);
    $id    = isset($input['id']) ? (int) $input['id'] : 0;

    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Chybí povinné pole: id'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $stmt = $pdo->prepare('DELETE FROM aktuality WHERE id = :id');
    $stmt->execute([':id' => $id]);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['error' => 'Aktualita nenalezena'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    echo json_encode(['success' => true, 'id' => $id], JSON_UNESCAPED_UNICODE);
    exit;
}
```

Autorizace se nemění — použij tu, kterou už endpoint dělá pro `POST`
(`Authorization: Bearer <AI_API_KEY>`). `PUT` není potřeba: přepsat aktualitu
jde smazáním a novým vložením.

Po nasazení stačí ve skriptu přehodit mazání z admin endpointu na webhook —
v `scripts/ticker.py` funkce `mutate()`, konstanta `ADMIN_URL` → `WEBHOOK_URL`.

### Volitelně: strop 5 položek na serveru

Frontend dnes hlídá pětku jen tím, že v adminu zešedne tlačítko „Přidat
aktualitu". Webhook si přes to v klidu vloží šestou. Buď to server odmítne:

```php
$count = (int) $pdo->query('SELECT COUNT(*) FROM aktuality')->fetchColumn();
if ($count >= 5) {
    http_response_code(409);
    echo json_encode(['error' => 'Pásek je plný (max 5 aktualit)'], JSON_UNESCAPED_UNICODE);
    exit;
}
```

…nebo ať si při vkládání sám odmaže nejstarší (pak rutina nepotřebuje `DELETE`
vůbec a varianta A je zbytečná):

```php
$pdo->exec(
    'DELETE FROM aktuality WHERE id NOT IN (
        SELECT id FROM (SELECT id FROM aktuality ORDER BY created_at DESC LIMIT 5) AS keep
    )'
);
```

---

## Varianta B — uznat servisní klíč i na `/api/admin/aktuality.php`

Menší zásah do kódu, ale otevírá celý admin endpoint (GET/POST/PUT/DELETE)
servisnímu klíči. V místě, kde se dnes ověřuje session, přidat větev před ni:

```php
$header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$bearer = preg_match('/Bearer\s+(\S+)/i', $header, $m) ? $m[1] : '';

$serviceKey = getenv('AI_API_KEY');   // stejný klíč, jaký ověřuje webhook.php
$isService  = $serviceKey !== false && $bearer !== '' && hash_equals($serviceKey, $bearer);

if (!$isService) {
    requireAdminSession($bearer);     // stávající kontrola session
}
```

`hash_equals()` místo `===` schválně — porovnání odolné vůči timing útoku.

Po nasazení projde `python3 scripts/ticker.py check` beze změny kódu a rutina
umí plnou rotaci.

---

## Jak ověřit, že je hotovo

```bash
python3 .claude/skills/agro-ticker/scripts/ticker.py check
```

Hotovo vypadá takto:

```
[TICKER] zakládání funguje — webhook klíč uznal (vrátil jen chybu validace).
[TICKER] mazání i editace fungují — admin endpoint uznává AI_API_KEY.
```

U varianty A zůstane druhý řádek negativní — tam se místo `check` ověří mazání
přímo:

```bash
curl -X DELETE -H "Authorization: Bearer $AI_API_KEY" -H "Content-Type: application/json" \
  -d '{"id":999999}' https://profifarmar.cz/api/aktuality_webhook.php
# hotovo = HTTP 404 „Aktualita nenalezena“ (ne 405 „Metoda DELETE není povolena“)
```
