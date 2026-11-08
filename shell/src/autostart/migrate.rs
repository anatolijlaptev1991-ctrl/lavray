// SPDX-License-Identifier: GPL-3.0-only

//! Миграция автозапуска `Run` → задача планировщика. Автозапуск, включённый
//! обычным процессом, остаётся значением `HKCU\...\Run`: после перезапуска от
//! администратора оно само в задачу `LAVRay-<SID>` не превращалось, и TUN при
//! следующем входе снова требовал ручного повышения. Миграция делается один
//! раз при старте повышенного экземпляра установленной копии и не входит в
//! [`read_state`](super::read_state): чтение состояния остаётся без побочных
//! эффектов.

use super::{enable, presence, Env, Exec, Seen, System};

/// Перевести `Run` в задачу, если для этого есть все условия: процесс повышен,
/// копия установлена, значение `LAVRay` в `Run` есть, а задачи нет (её
/// отсутствие подтверждено, а не «неизвестно»). Выключенный автозапуск и
/// portable-копия не трогаются. `Ok(true)` — миграция выполнена; при ошибке
/// создания задачи `Run` остаётся нетронутым (`enable` удаляет его только
/// после успешного создания).
pub fn migrate_run_to_task(exec: &impl Exec, env: &Env) -> Result<bool, String> {
    if !env.can_task() {
        return Ok(false);
    }
    let before = presence(exec, env)?;
    if !before.run || before.task != Seen::No {
        return Ok(false);
    }
    enable(exec, env, before)?;
    Ok(true)
}

/// Единственный вызов при старте оболочки: в отдельном потоке (внешние
/// `reg`/`schtasks` не должны задерживать окно), результат — в stderr.
pub fn spawn_at_startup() {
    if !super::supported() {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("lavray-autostart-migrate".to_owned())
        .spawn(|| match Env::detect() {
            Ok(env) => match migrate_run_to_task(&System, &env) {
                Ok(true) => eprintln!("LAVRay: автозапуск переведён из Run в задачу с правами"),
                Ok(false) => {}
                Err(e) => eprintln!("LAVRay: миграция автозапуска Run → задача не удалась: {e}"),
            },
            Err(e) => eprintln!("LAVRay: миграция автозапуска: {e}"),
        });
    if let Err(e) = spawned {
        eprintln!("LAVRay: поток миграции автозапуска не создан: {e}");
    }
}
