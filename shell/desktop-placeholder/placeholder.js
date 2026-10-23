// Заглушка UI: проверяет, что Tauri IPC (invoke) живой.
(async () => {
  const set = (id, text) => {
    document.getElementById(id).textContent = text;
  };
  try {
    const core = window.__TAURI__.core;
    set("proto", String(await core.invoke("protocol_version")));
    set("core", String(await core.invoke("core_state")));
  } catch (err) {
    set("proto", "n/a");
    set("core", `ошибка: ${err}`);
  }
})();
