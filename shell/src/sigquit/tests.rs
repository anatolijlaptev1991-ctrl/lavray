// SPDX-License-Identifier: GPL-3.0-only

//! Решение «первый сигнал — штатный выход, второй — срочный» без системных
//! вызовов: события обработчиков уходят в канал.

use super::{next_action, Action, Dispatcher, QUIT_BUDGET};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(5);
/// «Никогда»: бюджет, который тест не дождётся.
const LONG: Duration = Duration::from_secs(100);
const QUIET: Duration = Duration::from_millis(150);

/// Раздатчик с записью событий: `quit` и `force:<up>`.
fn rig(budget: Duration) -> (Arc<Dispatcher>, Receiver<String>) {
    let (tx, rx) = channel();
    let tx_force = tx.clone();
    let dispatcher = Dispatcher::with_budget(budget, move |up| {
        let _ = tx_force.send(format!("force:{up}"));
    });
    dispatcher.install(Arc::new(move || {
        let _ = tx.send("quit".to_string());
    }));
    (Arc::new(dispatcher), rx)
}

/// То же без обработчика выхода: приложение ещё не поднялось.
fn rig_before_setup(budget: Duration) -> (Arc<Dispatcher>, Receiver<String>) {
    let (tx, rx) = channel();
    let dispatcher = Dispatcher::with_budget(budget, move |up| {
        let _ = tx.send(format!("force:{up}"));
    });
    (Arc::new(dispatcher), rx)
}

fn quit_handler(tx: std::sync::mpsc::Sender<String>) -> super::Quit {
    Arc::new(move || {
        let _ = tx.send("quit".to_string());
    })
}

#[test]
fn first_signal_is_graceful_every_next_is_force() {
    assert_eq!(next_action(0), Action::Graceful);
    assert_eq!(next_action(1), Action::Force);
    assert_eq!(next_action(2), Action::Force);
    assert_eq!(next_action(u32::MAX), Action::Force);
}

#[test]
fn budget_is_short_enough_for_a_system_shutdown() {
    assert_eq!(QUIT_BUDGET, Duration::from_secs(5));
}

#[test]
fn first_signal_runs_graceful_quit_once_and_does_not_force() {
    let (dispatcher, rx) = rig(LONG);
    assert_eq!(dispatcher.on_signal(), Action::Graceful);
    assert_eq!(rx.recv_timeout(WAIT).unwrap(), "quit");
    assert!(rx.recv_timeout(QUIET).is_err(), "лишних событий нет");
}

#[test]
fn second_signal_forces_exit_with_proxy_release() {
    let (dispatcher, rx) = rig(LONG);
    assert_eq!(dispatcher.on_signal(), Action::Graceful);
    assert_eq!(rx.recv_timeout(WAIT).unwrap(), "quit");
    assert_eq!(dispatcher.on_signal(), Action::Force);
    assert_eq!(
        rx.recv_timeout(WAIT).unwrap(),
        "force:true",
        "приложение поднялось: прокси возвращается по снимку"
    );
}

#[test]
fn hanging_quit_does_not_block_the_second_signal() {
    let (tx, rx) = channel();
    let tx_force = tx.clone();
    let dispatcher = Arc::new(Dispatcher::with_budget(LONG, move |up| {
        let _ = tx_force.send(format!("force:{up}"));
    }));
    dispatcher.install(Arc::new(|| std::thread::sleep(Duration::from_secs(100))));
    dispatcher.on_signal();
    dispatcher.on_signal();
    assert_eq!(rx.recv_timeout(WAIT).unwrap(), "force:true");
}

#[test]
fn budget_expiry_forces_exit_once() {
    let (dispatcher, rx) = rig(Duration::from_millis(50));
    dispatcher.on_signal();
    assert_eq!(rx.recv_timeout(WAIT).unwrap(), "quit");
    assert_eq!(rx.recv_timeout(WAIT).unwrap(), "force:true");
    dispatcher.on_signal(); // второй сигнал после срочного выхода — не повтор
    assert!(rx.recv_timeout(QUIET).is_err(), "срочный выход один");
}

#[test]
fn signal_before_setup_is_not_lost() {
    let (dispatcher, rx) = rig_before_setup(LONG);
    assert_eq!(dispatcher.on_signal(), Action::Graceful);
    assert!(rx.recv_timeout(QUIET).is_err(), "обработчика ещё нет");
    let (tx, quits) = channel();
    dispatcher.install(quit_handler(tx));
    assert_eq!(quits.recv_timeout(WAIT).unwrap(), "quit");
    assert!(
        quits.recv_timeout(QUIET).is_err(),
        "выход запускается один раз"
    );
}

#[test]
fn install_without_a_pending_signal_does_not_quit() {
    let (dispatcher, _rx) = rig_before_setup(LONG);
    let (tx, quits) = channel();
    dispatcher.install(quit_handler(tx));
    assert!(quits.recv_timeout(QUIET).is_err());
}

#[test]
fn force_before_setup_does_not_touch_the_proxy() {
    let (dispatcher, rx) = rig_before_setup(LONG);
    dispatcher.on_signal();
    dispatcher.on_signal();
    assert_eq!(
        rx.recv_timeout(WAIT).unwrap(),
        "force:false",
        "второй экземпляр, не дошедший до setup, чужой прокси не снимает"
    );
}

#[test]
fn budget_expiry_before_setup_forces_without_release() {
    let (dispatcher, rx) = rig_before_setup(Duration::from_millis(50));
    dispatcher.on_signal();
    assert_eq!(rx.recv_timeout(WAIT).unwrap(), "force:false");
}
