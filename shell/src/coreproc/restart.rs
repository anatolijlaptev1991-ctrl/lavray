// SPDX-License-Identifier: GPL-3.0-only

//! Перезапуск здорового ядра по запросу (например, после выдачи прав на TUN):
//! остановка и новый запуск без учёта крахов. Отдельная фаза FSM
//! (`RestartRequested`, `RestartSpawn`), а не крах и не выход приложения.

use super::{
    Clock, CoreEvent, CoreProcess, CoreSpawnConfig, CoreState, CoreSupervisor, SupervisorError,
    RESTART_SHUTDOWN_TOTAL,
};

impl<P: CoreProcess, C: Clock> CoreSupervisor<P, C> {
    /// Ready/Connected → Stopping и страховочный kill (как `request_stop`).
    /// Счётчики крахов не трогаются.
    pub fn request_restart(&mut self) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::RestartRequested)?;
        self.process
            .kill_for_restart(RESTART_SHUTDOWN_TOTAL)
            .map_err(SupervisorError::Process)?;
        Ok(self.state)
    }

    /// Новый запуск после [`Self::request_restart`]: Stopping → Spawning. Крахи
    /// и backoff не меняются; ошибка spawn — обычная неудачная попытка.
    pub fn spawn_after_restart(
        &mut self,
        config: &CoreSpawnConfig,
    ) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::RestartSpawn)?;
        if let Err(err) = self.process.spawn(config) {
            self.register_failed_attempt();
            return Err(SupervisorError::Process(err));
        }
        Ok(self.state)
    }

    /// Остановка пришла во время перезапуска: ядро уже остановлено, нового не
    /// будет — Stopping → Stopped (`clean`: сеть подтверждена чистой).
    pub fn finish_restart_as_stopped(&mut self, clean: bool) {
        let _ = if clean {
            self.mark_teardown_verified()
        } else {
            self.mark_stopped()
        };
    }

    /// Перезапуск сорвался до spawn: Stopping → `SpawnErr` без счётчиков
    /// (дальше обычный ретрай запуска).
    pub fn abort_restart(&mut self) {
        let _ = self.apply(CoreEvent::SpawnFailed);
    }
}

#[cfg(test)]
mod tests {
    use super::super::{transition, CoreEvent as E, CoreState as S, MockClock, MockCoreProcess};
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn restart_edges_are_legal_only_where_intended() {
        for (from, event, to) in [
            (S::Ready, E::RestartRequested, S::Stopping),
            (S::Connected, E::RestartRequested, S::Stopping),
            (S::Stopping, E::RestartSpawn, S::Spawning),
            (S::Stopping, E::SpawnFailed, S::SpawnErr),
        ] {
            assert_eq!(transition(from, event).unwrap(), to, "{from} + {event}");
        }
        for (from, event) in [
            (S::Idle, E::RestartRequested),
            (S::Spawning, E::RestartRequested),
            (S::Crashed, E::RestartRequested),
            (S::RateLimited, E::RestartRequested),
            (S::Stopping, E::RestartRequested),
            (S::Idle, E::RestartSpawn),
            (S::Ready, E::RestartSpawn),
            (S::Stopped, E::RestartSpawn),
        ] {
            assert!(transition(from, event).is_err(), "{from} + {event}");
        }
    }

    fn config() -> CoreSpawnConfig {
        CoreSpawnConfig {
            binary: PathBuf::from("lavray-core"),
            listen_socket: PathBuf::from("127.0.0.1:0"),
            data_dir: PathBuf::from("data"),
            auth_token: crate::coreproc::SecretToken::from_base64url("A".repeat(43)).unwrap(),
            agent_token: None,
            extra_args: Vec::new(),
        }
    }

    #[test]
    fn restart_cycle_leaves_crash_counters_alone() {
        let mut sup = CoreSupervisor::new(
            MockCoreProcess::default(),
            MockClock::at(std::time::Instant::now()),
        );
        sup.start(&config()).unwrap();
        sup.wait_ready().unwrap();
        assert_eq!(sup.request_restart().unwrap(), S::Stopping);
        assert_eq!(sup.spawn_after_restart(&config()).unwrap(), S::Spawning);
        sup.wait_ready().unwrap();
        assert_eq!(sup.state(), S::Ready);
        assert_eq!(sup.crashes_in_window(), 0);
        assert_eq!(sup.spawn_failures_hint(), 0);
    }

    #[test]
    fn restart_is_refused_outside_a_healthy_state() {
        let mut sup = CoreSupervisor::new(
            MockCoreProcess::default(),
            MockClock::at(std::time::Instant::now()),
        );
        assert!(sup.request_restart().is_err());
        assert_eq!(sup.state(), S::Idle);
    }
}
