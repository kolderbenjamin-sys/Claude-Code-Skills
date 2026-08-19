# Chybí `DELETE` v `aktuality_webhook.php`

**Stav k 19. 8. 2026.** Zakládání aktualit funguje (`POST /api/aktuality_webhook.php`,
ověřeno — HTTP 201). Mazání a editace **nefungují vůbec**:

| Pokus | Odpověď |
|---|---|
| `DELETE /api/aktuality_webhook.php` (id v těle) | `405 Metoda DELETE není povolena` |
| `DELETE /api/aktuality_webhook.php?id=4` | `405` |
| `PUT /api/aktuality_webhook.php` | `405` |
| `POST` s hlavičkou `X-HTTP-Method-Override: DELETE` | `400` — hlavička se ignoruje |
| `POST` s `{"action":"delete"}` | `400` — taková větev tam není |
| `DELETE /api/admin/aktuality.php` se servisním klíčem | `401 Neplatná nebo vypršená session` |
| `DELETE /api/webhook.php` s `{"type":"aktualita"}` | `500` — je to endpoint pro články |

Admin endpoint uznává jedině session token z `/api/admin/auth.php`, tedy přihlášení
jménem a heslem. **Tudy záměrně nejdeme** — automatizace nemá držet heslo do adminu.

Bez mazání nemůže rutina držet rotaci „nejstarší ven, nová dovnitř". Umí jen doplnit
do volných slotů a zbytek nahlásit k ručnímu úklidu.

---

## Co doplnit

Do `api/aktuality_webhook.php` přidej větev pro `DELETE`. Autorizace zůstává
**přesně ta, kterou už soubor dělá pro `POST`** (`Authorization: Bearer <AI_API_KEY>`) —
žádný nový klíč, žádné heslo.

```php
$method = $_SERVER['REQUEST_METHOD'];

// ... stávající autorizace servisním klíčem, společná pro POST i DELETE ...

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

`PUT` není potřeba — přepsat aktualitu jde smazáním a novým vložením, a přesně tak
to rutina dělá.

### Kontrakt, na který se skript spoléhá

| | |
|---|---|
| Metoda a adresa | `DELETE https://profifarmar.cz/api/aktuality_webhook.php` |
| Hlavičky | `Content-Type: application/json`, `Authorization: Bearer <AI_API_KEY>` |
| Tělo | `{"id": 4}` |
| Úspěch | `200 {"success": true, "id": 4}` |
| Neexistující id | `404 {"error": "Aktualita nenalezena"}` |
| Chybí id | `400 {"error": "Chybí povinné pole: id"}` |
| Špatný klíč | `401 {"error": "Neautorizovaný přístup"}` |

---

## Volitelně: strop 5 položek na serveru

Pětku dnes hlídá jen frontend (v adminu zešedne tlačítko „Přidat aktualitu").
Webhook by šestou v klidu vložil. Skript si počet hlídá sám, ale server by na to
spoléhat neměl:

```php
$count = (int) $pdo->query('SELECT COUNT(*) FROM aktuality')->fetchColumn();
if ($count >= 5) {
    http_response_code(409);
    echo json_encode(['error' => 'Pásek je plný (max 5 aktualit)'], JSON_UNESCAPED_UNICODE);
    exit;
}
```

---

## Až to bude nasazené

1. Ověř mazání (`999999` neexistuje, takže se nic nesmaže):

   ```bash
   curl -X DELETE -H "Authorization: Bearer $AI_API_KEY" -H "Content-Type: application/json" \
     -d '{"id":999999}' https://profifarmar.cz/api/aktuality_webhook.php
   ```

   Hotovo = `404 Aktualita nenalezena`. Pořád `405 Metoda DELETE není povolena` = není nasazeno.

2. Ve `scripts/ticker.py` přepni mazání z admin endpointu na webhook — ve funkci
   `mutate()` změň `ADMIN_URL` na `WEBHOOK_URL`. Stejně tak v `can_mutate()`, kde
   se místo `GET` na admin ověří dostupnost přes `DELETE` s neexistujícím id
   (`404` = mazání funguje).

3. `python3 scripts/ticker.py check` musí hlásit obě cesty jako funkční. Od té chvíle
   rutina protáčí pásek úplně sama.
