# A14. Зашифрованная резервная копия: круг на пустом каталоге данных

| Поле | Значение |
|---|---|
| ID | A14 |
| Слой | авто |
| Время | 3–4 минуты (шифрование Argon2id 64 МиБ на каждую проверку: десятки вызовов) |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7; ядро выпуска `<TAG>` (по умолчанию `v0.9.0`; на момент написания — `main` на `9b26be6`, в нём уже есть `BackupService`). Группа P |
| Опасность | нет: ядро и каталог данных — отдельные, в `C:\lavray-test\tmp\A14\data`; системный прокси, TUN и реестр не затрагиваются |

## Цель

Проверить T-83 «круг копии» на реальной базе SQLite: заполнить пустой каталог данных (серверы с секретом, группы, подписка с адресом и токеном, свои наборы маршрутов, настройки), выгрузить копию с паролем, испортить состояние, убедиться, что неверный пароль и порченые файлы **не меняют базу**, восстановить, сверить число и содержимое строк **по каждой таблице**, затем удалить `lavray.db` и восстановить в пустую базу. Живая проверка Ф5 п. 1–3: «копия → удалить `lavray.db` → восстановить; всё на месте, включая подписки с URL; серийники обновлений не откатились; неверный пароль и испорченный файл дают разные сообщения; копия от более новой версии отвергается».

## Предусловия

- Python 3.12 (модуль `sqlite3` из стандартной библиотеки читает базу в режиме «только чтение»); ядро с BackupService; Git и Go (для шага 3).
- Свободное место: копия — десятки килобайт.

## Безопасность

Только собственный каталог данных. Тестовые секреты (пароль сервера, токен ссылки подписки) генерируются при каждом запуске и в отчёт не попадают. Пароль копии — тестовое значение из скрипта.

## Шаги

1. Каталоги и ядро.

   ```powershell
   . C:\lavray-test\env.ps1
   $t = 'C:\lavray-test\tmp\A14'
   New-Item -ItemType Directory -Force -Path $t, C:\lavray-test\results\A14 | Out-Null
   $exe = if (Test-Path $env:LAVRAY_CORE_EXE) { $env:LAVRAY_CORE_EXE } else { 'C:\lavray-test\tmp\A03\lavray-core.exe' }
   Test-Path $exe
   ```

2. Сохраните скрипт из раздела «Скрипт `a14_backup.py`» как `C:\lavray-test\tmp\A14\a14_backup.py` и запустите:

   ```powershell
   python -I "$t\a14_backup.py" $exe "$t\run" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A14\run.txt | Select-Object -Last 10
   "a14 exit=$LASTEXITCODE"
   $res = Get-Content "$t\run\a14-result.json" -Raw | ConvertFrom-Json
   "проверок: $($res.total), провалов: $($res.failed), наблюдений: $($res.warnings)"
   $res.checks | Where-Object { -not $_.pass } | Select-Object id, warn, detail | Format-Table -AutoSize -Wrap
   ```

   Ожидается: `a14 exit=0`, `провалов: 0`; допустим один `WARN` (`5.unicode_nfc_vs_nfd_password_equivalent_in_core`). Эталон на `main` `9b26be6` (и на `feat/tails-a`, `775a49b`): 27 проверок.

3. Копия от более новой версии и порча на уровне хранилища (Go-тесты репозитория; создать такой файл из скрипта нельзя: он требует шифрования Argon2id/XChaCha20 с повышенным `schema_version`):

   ```powershell
   Set-Location (Join-Path $env:LAVRAY_SRC 'core')
   go test -count=1 -v -run '^(TestRestoreRejectsNewerSchema|TestRestoreIsAtomicOnCorruptFile|TestRestoreRollbackMidway|TestRestoreKeepsUpdateSerial|TestRestoreCoversEveryTable)$' ./internal/store/ ./internal/backup/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestBackupFromNewerVersionRejected|TestBackupPasswordNeverLogged|TestBackupFileHasNoPlaintextSecrets|TestConcurrentBackupOpsSerialized)$' ./internal/api/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   Set-Location C:\lavray-test
   ```

   Ожидается: для каждого найденного имени `--- PASS`, строки `ok`. Имена берутся из плана T-83; тест, которого нет в выбранном коммите (`testing: warning: no tests to run`), запишите в отклонения и сверьтесь с `go test -list 'Backup|Restore' ./internal/...`. Сообщение для пользователя при такой копии: «Копия сделана более новой версией LAVRay. Обновите приложение и повторите» (`bk.err.newer`), код `FAILED_PRECONDITION` с причиной `backup_from_newer_version`.

4. Что проверяет скрипт:

   | Блок | Проверки |
   |---|---|
   | 0. Начальные данные | три сервера (в том числе с секретным паролем), группы, подписка `https://sub.a14.example/feed?token=…`, два свой набора маршрутов, настройки `inbound.port`, `ui.max_log_lines`, `update.channel = beta`; все таблицы SQLite непусты |
   | 1. Выгрузка | заголовок `LAVBK1`, размер до 64 МиБ; сводка (серверы, 2 набора, 1 подписка); **в файле нет** пароля сервера, токена подписки и строки «SQLite format»; два экспорта разных файлов (соль и nonce уникальны) |
   | 2–3. Порча и пароль | состояние испорчено (удалён сервер, лишняя группа, новые значения); неверный пароль → `403 permission_denied`; изменение одного бита в позициях 0, 3, 8, 20, 40, 60, 100, середина, последний байт → **все** отвергнуты; обрезанный файл отвергнут; после каждой неудачи содержимое базы **не изменилось** (все таблицы построчно) |
   | 4. Восстановление поверх | `PreviewBackup` равен сводке экспорта; `ImportBackup` → `200`; число строк в каждой таблице равно исходному; строки совпадают, кроме служебных таблиц `meta` и `sessions`; `inbound.port` вернулся; **`update.*` остались текущими** (`update.channel` = `stable`, а не `beta` из копии); профиль с секретом и адрес подписки вернулись; `PRAGMA integrity_check` = `ok`, `foreign_key_check` пуст |
   | 5. Повтор | повторное восстановление того же файла идемпотентно |
   | 6. Пустая база | после остановки ядра удалены `lavray.db`, `-wal`, `-shm`; новое ядро видит 0 серверов; `ImportBackup` восстанавливает; число строк равно исходному; ещё один запуск ядра на восстановленных данных видит те же серверы |

## Критерии PASS/FAIL

| № | Критерий | Шаг |
|---|---|---|
| К1 | `a14 exit=0`, провалов 0 | 2 |
| К2 | Файл копии без открытых секретов и каждый проверенный бит заголовка/тела ломает расшифровку | 2 (блоки 1, 3) |
| К3 | Любой отказ (пароль, порча, обрезка) оставляет базу побайтно прежней по таблицам | 2 (блок 3) |
| К4 | После восстановления число и содержимое строк по каждой таблице равны исходным; `update.*` не откатились | 2 (блок 4) |
| К5 | Восстановление в пустую базу даёт то же число строк | 2 (блок 6) |
| К6 | Go-тесты шага 3 проходят | 3 |

## Что собрать

`results\A14\run.txt`, копия `a14-result.json`, вывод шага 3. Файл копии `a14.lavbk` и `data\` **не** копировать.

## Откат / уборка

```powershell
Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Remove-Item -Recurse -Force C:\lavray-test\tmp\A14
Test-Path C:\lavray-test\tmp\A14
```

Ожидается `False`.

## Отчёт

`results/A14.md` по `templates/REPORT.md`: шаги 1–3, К1–К6. Провал К2 (секрет в файле, порча принята) — `critical`; К3 (отказ изменил базу) и К4 — `critical` (потеря данных); К5 — `major`.

## Скрипт `a14_backup.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A14: круг резервной копии на пустом каталоге данных: заполнить, выгрузить, испортить, восстановить, сверить
число строк по таблицам SQLite, пароль, порча файла, повторное восстановление, восстановление в пустую базу.

Запуск: python -I a14_backup.py <lavray-core.exe> <каталог результатов>
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a14-result.json.
Чтение базы идёт только при остановленном ядре или в режиме «только чтение».
"""
import base64
import json
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
EXE, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
DATA = os.path.join(OUT, "data")
RESULTS = []
PW = "пароль-копии-A14-12345"
SECRET = "A14-SECRET-" + secrets.token_hex(8)
SUBTOKEN = "A14-SUBTOKEN-" + secrets.token_hex(8)


def check(cid, ok, detail="", warn=False):
    RESULTS.append({"id": cid, "pass": bool(ok), "warn": bool(warn and not ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else ("WARN " if warn else "FAIL ")) + cid + ("" if ok else " :: " + str(detail)[:220]), flush=True)


class Core:
    def __init__(self):
        self.tok = secrets.token_urlsafe(32)
        self.p = subprocess.Popen([EXE, "serve", "--listen-socket", "127.0.0.1:0", "--data", DATA], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, "core-stderr.log"), "ab"))
        self.p.stdin.write((self.tok + "\n").encode())
        self.p.stdin.flush()
        self.base = "http://" + self.p.stdout.readline().decode().split()[1].replace("tcp://", "")

    def rpc(self, svc, m, body=None):
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{m}", data=json.dumps(body or {}).encode(),
                                     headers={"Authorization": "Bearer " + self.tok, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    def stop(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=20)
        except Exception:  # noqa: BLE001
            self.p.kill()


def code(r):
    return r[1].get("code") if isinstance(r[1], dict) else None


def b64(b):
    return base64.b64encode(b).decode()


def snapshot():
    """Содержимое базы: {таблица: отсортированные строки}; settings без update.* и служебных записей meta."""
    con = sqlite3.connect("file:" + os.path.join(DATA, "lavray.db").replace(os.sep, "/") + "?mode=ro", uri=True)
    out = {}
    try:
        for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            rows = con.execute(f'SELECT * FROM "{name}"').fetchall()
            if name == "settings":
                rows = [r for r in rows if not str(r[0]).startswith("update.")]
            out[name] = sorted(json.dumps(r, default=str, ensure_ascii=False) for r in rows)
    finally:
        con.close()
    return out


def integrity():
    con = sqlite3.connect("file:" + os.path.join(DATA, "lavray.db").replace(os.sep, "/") + "?mode=ro", uri=True)
    try:
        return con.execute("PRAGMA integrity_check").fetchone()[0], con.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        con.close()


def counts(s):
    return {k: len(v) for k, v in s.items()}


def main():
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA)
    c = Core()
    try:
        gid = c.rpc("ProfileService", "ListGroups")[1]["groups"][0]["id"]
        mk = lambda name, port, **extra: c.rpc("ProfileService", "CreateProfile", {"profile": {"groupId": gid, "type": "PROFILE_TYPE_SOCKS", "name": name, "address": "127.0.0.1", "port": port, "socksHttp": {"proto": "PROTO_SOCKS5"}, **extra}})[1]
        mk("a14-one", 1081)
        mk("a14-two", 1082)
        st, tr = c.rpc("ProfileService", "CreateProfile", {"profile": {"groupId": gid, "type": "PROFILE_TYPE_TROJAN", "name": "a14-secret", "address": "secret.a14.example", "port": 443, "trojanVless": {"password": SECRET}}})
        check("0.seed.profiles", st == 200, (st, tr))
        st, g = c.rpc("ProfileService", "CreateGroup", {"group": {"name": "a14-group"}})
        st, sub = c.rpc("SubscriptionService", "CreateSubscription", {"url": f"https://sub.a14.example/feed?token={SUBTOKEN}", "name": "a14-sub"})
        check("0.seed.subscription_created", st == 200, (st, str(sub)[:200]))
        for i in (1, 2):
            c.rpc("RoutingService", "CreatePreset", {"preset": {"displayName": f"a14-preset-{i}", "proxyDomain": [f"example{i}.org"]}})
        c.rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": "2088"}, "ui.max_log_lines": {"intValue": "2500"}, "update.channel": {"stringValue": "beta"}}})
        before = snapshot()
        cb = counts(before)
        check("0.seed.tables_have_rows", cb.get("profiles", 0) >= 3 and cb.get("groups", 0) >= 3 and cb.get("settings", 0) >= 2, cb)
        # --- выгрузка ---
        st, ex = c.rpc("BackupService", "ExportBackup", {"password": PW})
        data = base64.b64decode(ex["data"]) if st == 200 else b""
        sm = ex.get("summary", {}) if st == 200 else {}
        check("1.export.magic_and_size", st == 200 and data[:6] == b"LAVBK1" and 100 < len(data) < 64 << 20, (st, len(data)))
        check("1.export.summary_counts", int(sm.get("profiles", 0)) == cb["profiles"] and int(sm.get("presets", 0)) == 2 and int(sm.get("subscriptions", 0)) == 1, sm)
        check("1.export.no_plaintext", SECRET.encode() not in data and SUBTOKEN.encode() not in data and b"a14-secret" not in data, "секрет виден в файле")
        with open(os.path.join(OUT, "a14.lavbk"), "wb") as f:
            f.write(data)
        st, ex2 = c.rpc("BackupService", "ExportBackup", {"password": PW})
        data2 = base64.b64decode(ex2["data"]) if st == 200 else b""
        check("1.export.two_exports_differ_nonce_unique", data2 and data2 != data and data2[6:60] != data[6:60], "одинаковые файлы: nonce/salt не меняются")
        # --- портим состояние ---
        c.rpc("ProfileService", "DeleteProfile", {"ids": [tr["id"]]})
        c.rpc("ProfileService", "CreateGroup", {"group": {"name": "a14-junk"}})
        c.rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": "2099"}, "update.channel": {"stringValue": "stable"}}})
        broken = snapshot()
        check("2.state_changed", broken != before, "состояние не изменилось")
        # --- пароль и порча: база не меняется ---
        st, r = c.rpc("BackupService", "ImportBackup", {"data": b64(data), "password": "другой-пароль-123456", "confirmReplace": True})
        check("3.wrong_password.permission_denied", st == 403 and code((st, r)) == "permission_denied", (st, str(r)[:100]))
        check("3.wrong_password.db_unchanged", snapshot() == broken, "база изменилась после неверного пароля")
        positions = [0, 3, 8, 20, 40, 60, 100, len(data) // 2, len(data) - 1]
        bad = []
        for pos in positions:
            t = bytearray(data)
            t[pos] ^= 0x01
            st, r = c.rpc("BackupService", "ImportBackup", {"data": b64(bytes(t)), "password": PW, "confirmReplace": True})
            if st == 200:
                bad.append(pos)
        check("3.tamper.every_probed_byte_rejected", not bad, f"принят файл с изменённым байтом {bad}")
        check("3.tamper.db_unchanged", snapshot() == broken, "база изменилась после порченого файла")
        st, r = c.rpc("BackupService", "ImportBackup", {"data": b64(data[:-1]), "password": PW, "confirmReplace": True})
        check("3.truncated.rejected", st != 200 and snapshot() == broken, (st, str(r)[:80]))
        # --- восстановление поверх ---
        st, pv = c.rpc("BackupService", "PreviewBackup", {"data": b64(data), "password": PW})
        check("4.preview.equals_export_summary", st == 200 and all(str(pv.get(k)) == str(sm.get(k)) for k in ("groups", "profiles", "subscriptions", "presets", "settings", "schemaVersion")), (pv, sm))
        st, r = c.rpc("BackupService", "ImportBackup", {"data": b64(data), "password": PW, "confirmReplace": True})
        check("4.import.ok", st == 200 and str(r["restored"]["profiles"]) == str(sm["profiles"]), (st, str(r)[:150]))
        after = snapshot()
        check("4.import.row_counts_equal_before", counts(after) == cb, {k: (cb.get(k), counts(after).get(k)) for k in cb if counts(after).get(k) != cb.get(k)})
        diff = [k for k in before if before[k] != after.get(k)]
        check("4.import.rows_identical_except_volatile", not diff or set(diff) <= {"meta", "sessions"}, diff)
        st, v = c.rpc("SettingsService", "GetSettings", {"keys": ["inbound.port", "update.channel"]})
        check("4.import.settings_restored_update_keys_kept", "2088" in json.dumps(v) and "stable" in json.dumps(v) and "beta" not in json.dumps(v), v)
        st, p = c.rpc("ProfileService", "GetProfile", {"id": tr["id"]})
        check("4.import.secret_profile_back", st == 200 and SECRET in json.dumps(p), (st, str(p)[:80]))
        st, ls = c.rpc("SubscriptionService", "ListSubscriptions")
        check("4.import.subscription_url_back", SUBTOKEN in json.dumps(ls), str(ls)[:100])
        verdict, fk = integrity()
        check("4.import.integrity_and_foreign_keys", verdict == "ok" and not fk, (verdict, fk[:3]))
        st, r = c.rpc("BackupService", "ImportBackup", {"data": b64(data), "password": PW, "confirmReplace": True})
        check("5.second_import_is_idempotent", st == 200 and counts(snapshot()) == cb, (st, str(r)[:100]))
        # --- Unicode-пароль: нормализация ---
        decomposed = unicodedata.normalize("NFD", "пароль-é-копии-12345")
        composed = unicodedata.normalize("NFC", decomposed)
        st, e3 = c.rpc("BackupService", "ExportBackup", {"password": composed})
        st2, r3 = c.rpc("BackupService", "PreviewBackup", {"data": e3["data"], "password": decomposed})
        check("5.unicode_nfc_vs_nfd_password_equivalent_in_core", st2 == 200, (st2, str(r3)[:80]), warn=True)
    finally:
        c.stop()
    # --- восстановление в пустую базу (потерян lavray.db) ---
    for name in ("lavray.db", "lavray.db-wal", "lavray.db-shm"):
        try:
            os.remove(os.path.join(DATA, name))
        except FileNotFoundError:
            pass
    c2 = Core()
    try:
        st, lp = c2.rpc("ProfileService", "ListProfiles")
        check("6.fresh_db.is_empty", st == 200 and lp.get("total") in ("0", 0, None), lp.get("total"))
        st, r = c2.rpc("BackupService", "ImportBackup", {"data": b64(data), "password": PW, "confirmReplace": True})
        check("6.fresh_db.import_ok", st == 200, (st, str(r)[:150]))
    finally:
        c2.stop()
    fresh = snapshot()
    check("6.fresh_db.row_counts_equal_original", all(counts(fresh).get(k) == v for k, v in cb.items() if k not in ("meta", "sessions")), {k: (cb[k], counts(fresh).get(k)) for k in cb if counts(fresh).get(k) != cb[k]})
    c3 = Core()
    try:
        st, lp = c3.rpc("ProfileService", "ListProfiles")
        check("6.fresh_db.core_restarts_on_restored_data", st == 200 and int(lp["total"]) == cb["profiles"], lp.get("total"))
    finally:
        c3.stop()
    failed = [r for r in RESULTS if not r["pass"] and not r["warn"]]
    warns = [r for r in RESULTS if r["warn"]]
    with open(os.path.join(OUT, "a14-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "warnings": len(warns), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A14: проверок {len(RESULTS)}, провалов {len(failed)}, наблюдений WARN {len(warns)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
