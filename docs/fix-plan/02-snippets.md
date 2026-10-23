# 02. Готовый код для задач A1–A22

Каждый фрагмент рассчитан на вставку в `design/prototype.html` и опирается на функции прототипа (`t`, `tf`, `esc`, `ic`, `S`, `save`, `toast`, `openDlg`, `closeDlg`, `openMenu`, `renderAll`…). CSS-фрагменты вставлять в конец `<style>` перед `@media (prefers-reduced-motion: reduce)`, если не сказано иное. JS-фрагменты — в основной `<script>` рядом с одноимённым разделом (комментарии `/* ===== раздел ===== */`), заменяя старую версию функции, если она указана. Новые иконки, которых нет в `IC` (`menu`, `lock`, `activity`, `arrright`, `shield`, `stethoscope` не нужен), добавить в объект `IC` в стиле Lucide.

Новые поля состояния `S`, которые используют фрагменты (добавить в объявление `S` и в `save()`, кроме помеченных «не сохранять»): `os`, `grpLast` (объект), `density` (`'normal'`), `bgAnim` (`null` = по умолчанию режима), `tunService` (`false`), `gw` (`'tproxy'`), `statusFilter` (`'all'`), `subFilter` (`'all'`), `scenario` (`'demo'`, не сохранять), `coreError` (`null`, не сохранять), `coreStarting` (`false`, не сохранять), `leakAt` (`null`, не сохранять), `webAuthed` (`false`, не сохранять), `nekoFound` (`true`), `clipDemo` (`true`).

---

## S1. Базовый CSS (задача A1)

```css
/* ---------- S1 · переключатель ---------- */
.sw{position:relative;width:44px;height:26px;border-radius:var(--r-full);background:var(--surface2);border:1.5px solid var(--b-control);flex:none;
  transition:background var(--t-std) var(--ease),border-color var(--t-std) var(--ease)}
.sw::after{content:"";position:absolute;top:3px;inset-inline-start:3px;width:17px;height:17px;border-radius:50%;background:var(--t2);box-shadow:none;
  transition:transform var(--t-emph) var(--e-spring,var(--ease)),background var(--t-std) var(--ease)}
.sw[aria-checked="true"]{background:var(--accent);border-color:var(--accent)}
.sw[aria-checked="true"]::after{transform:translateX(18px);background:var(--accent-contrast)}

/* ---------- S1 · размеры целей (DS §12: не меньше 32 px) ---------- */
.btn-sm{height:32px;padding-inline:12px}
.btn-ic.btn-sm{width:32px;height:32px}
.chip{height:32px;padding-inline:12px}
.fav-btn{width:32px;height:32px}
.seg button{min-height:32px}
.tb-ic{width:32px;height:32px}
.accdot{width:28px;height:28px}
.sb-card{min-height:44px}
.btn.loading .ic:not(.ic-spin){display:none}

/* ---------- S1 · фокус: одно кольцо для всего интерактивного ---------- */
:where(button,a,select,summary,[tabindex],[role="button"],[role="tab"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[role="switch"]):focus-visible{
  outline:2px solid var(--accent)!important;outline-offset:2px!important}
.input:focus-visible,.textarea:focus-visible{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}

/* ---------- S1 · бейджи протоколов: нейтральные (цвет только у статусов) ---------- */
.badge[class*="bt-"]{background:var(--surface2);color:var(--t2);border:1px solid var(--b-subtle)}

/* ---------- S1 · шрифты: системный шрифт ОС в приложении, Inter в веб-режиме ---------- */
html[data-shell="native"][data-os="win"]{--font-sans:"Segoe UI Variable Text","Segoe UI",system-ui,var(--font-cjk),sans-serif}
html[data-shell="native"][data-os="mac"]{--font-sans:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,var(--font-cjk),sans-serif}
html[data-shell="native"][data-os="linux"]{--font-sans:Cantarell,"Noto Sans",Ubuntu,system-ui,var(--font-cjk),sans-serif}
html[data-shell="browser"]{--font-sans:Inter,system-ui,-apple-system,"Segoe UI",Roboto,var(--font-cjk),sans-serif}

/* ---------- S1 · служебное ---------- */
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ---------- S1 · режим высокой контрастности Windows ---------- */
@media (forced-colors: active){
  .btn,.chip,.seg,.seg button,.tab,.subtab,.sb-item,.input,.select,.textarea,.card,.prow,.preset,.dns-card,.tg-opt,.onb-lang,
  .sb-card,.badge,.menu,.dlg,#drawer,.srv-pick,.cap-btn,.tb-ic{border:1px solid CanvasText}
  .sw{border:2px solid CanvasText;background:Canvas}
  .sw::after{background:CanvasText}
  .sw[aria-checked="true"]{background:Highlight;border-color:Highlight}
  .sw[aria-checked="true"]::after{background:HighlightText}
  .sb-item.on,.chip.on,.seg button.on,.seg button[aria-checked="true"],.tab.on,.subtab[aria-selected="true"],.preset.on,.dns-card.on,
  .tg-opt.on,.tg-opt[aria-checked="true"],.prow.active{outline:2px solid Highlight;outline-offset:-2px}
  .dot{forced-color-adjust:none;border:1px solid CanvasText}
  :focus-visible{outline:2px solid Highlight!important}
  .sb-ind,.subtab-ind,#bgField,.graph-empty::before{display:none}
}
```

---

## S2. Знак «Отражение» (задача A2)

В скрытый глобальный `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>…</defs></svg>` в начале `<body>` добавить:

```html
<linearGradient id="lavRay" gradientUnits="userSpaceOnUse" x1="23" y1="9" x2="49" y2="43">
  <stop offset="0" class="lr-a" stop-opacity=".3"/><stop offset=".5" class="lr-a"/><stop offset="1" class="lr-b"/>
</linearGradient>
<linearGradient id="lavRaySolid" gradientUnits="userSpaceOnUse" x1="23" y1="9" x2="49" y2="43">
  <stop offset="0" class="lr-a"/><stop offset="1" class="lr-b"/>
</linearGradient>
```

Малый знак (шапка 16 px, сайдбар 24 px, полоса меню macOS):

```html
<svg class="lgA lgA-sm" viewBox="0 0 64 64" width="16" height="16" aria-hidden="true">
  <g transform="translate(-4.5 1.5)"><path class="a-beam" d="M23 13V43H45" stroke-width="10"/><circle class="a-photon" cx="56.5" cy="43" r="5"/></g>
</svg>
```

Полный знак (карточка состояния; внутри `<div class="ray" aria-hidden="true">`):

```html
<svg class="lgA" viewBox="0 0 64 64" aria-hidden="true">
  <g transform="translate(-4.5 1.5)">
    <path class="a-beam" pathLength="100" d="M23 13V43H45" stroke-width="8"/>
    <path class="a-mirror" d="M14.5 43L23 51.5"/>
    <circle class="a-photon" cx="55.5" cy="43" r="3.6"/>
  </g>
</svg>
```

CSS (старые правила `.ray`, `.ray-box`, `.ray-chev`, `.ray-beam`, `@keyframes rayPulse/beamFlow/rayBreath`, `#stateCard[data-conn=…] .ray*` удалить):

```css
:root{--e-in:cubic-bezier(.05,.7,.1,1);--e-out:cubic-bezier(.3,0,.8,.15);--t-chor:700ms;
  --e-spring:linear(0,.006,.025 2.8%,.101 6.1%,.539 18.9%,.721 25.3%,.849 31.5%,.937 38.1%,.968 41.8%,.991 45.7%,1.006 50.1%,1.015 55%,1.017 63.9%,1.001 85.9%,1)}
.lr-a{stop-color:var(--ray-a)} .lr-b{stop-color:var(--ray-b)}
.lgA{display:block;overflow:visible}
.lgA .a-beam{fill:none;stroke:url(#lavRay);stroke-linecap:round;stroke-linejoin:bevel}
.lgA-sm .a-beam{stroke:url(#lavRaySolid)}
.lgA .a-mirror{fill:none;stroke:var(--t1);stroke-width:2.6;stroke-linecap:round;opacity:.92}
.lgA .a-photon{fill:var(--ray-b);transform-box:fill-box;transform-origin:center}
.lgA-mono .a-beam{stroke:currentColor} .lgA-mono .a-photon{fill:currentColor}

#stateCard .ray{width:88px;height:88px;flex:none;margin:0}
#stateCard .ray .lgA{width:100%;height:100%}
#stateCard .a-beam{stroke-dasharray:100;stroke-dashoffset:0;transition:opacity var(--t-std) var(--ease)}
#stateCard[data-conn="off"] .a-beam{opacity:.38}
#stateCard[data-conn="off"] .a-photon{opacity:0;transform:scale(.3);transition:transform var(--t-std) var(--e-out),opacity var(--t-std)}
#stateCard[data-conn="mid"] .a-beam{stroke-dasharray:12 9;opacity:.8;animation:lgFlow .8s linear infinite}
#stateCard[data-conn="mid"] .a-photon{fill:none;stroke:var(--ray-b);stroke-width:2.4;opacity:.85;animation:blink 1s var(--ease) infinite}
#stateCard[data-conn="on"] .a-beam{animation:lgDraw var(--t-chor) var(--e-in) both}
#stateCard[data-conn="on"] .a-mirror{animation:lgFlash var(--t-chor) linear both}
#stateCard[data-conn="on"] .a-photon{animation:lgPop .32s .56s var(--e-spring) both,lgBreathe 3.2s 1.2s ease-in-out infinite}
#stateCard[data-conn="err"] .a-beam{stroke-dasharray:58 9 100;opacity:.75}
#stateCard[data-conn="err"] .a-photon{fill:var(--err)}
@keyframes lgFlow{to{stroke-dashoffset:-21}}
@keyframes lgDraw{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
@keyframes lgFlash{0%,50%{opacity:.25}60%{opacity:1;stroke:var(--ray-a)}100%{opacity:.92}}
@keyframes lgPop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes lgBreathe{50%{opacity:.72}}
```

Значок трея в полосе меню macOS (A3) — малый знак с классом `lgA-mono`; состояние трея: отключено — без фотона и `opacity:.45` у луча; подключение — фотон кольцом; ошибка — луч с `stroke-dasharray="58 9 100"`. Эталонные SVG трея: `design/concepts/logo/tray/`.

---

## S3. Шапка окна по ОС (задача A3)

Разметка — заменить весь `<header id="titlebar">…</header>`. Полосу `#macbar` вставить первым элементом `<body>` после скрытого `<svg>` с градиентами.

```html
<div id="macbar" role="menubar" data-i18n-aria="aria.menu">
  <span class="mb-logo" aria-hidden="true"></span>
  <button class="mb-item mb-app" role="menuitem" data-mac-menu="app">LAVRay</button>
  <button class="mb-item" role="menuitem" data-mac-menu="edit" data-i18n="menu.edit">Правка</button>
  <button class="mb-item" role="menuitem" data-mac-menu="view" data-i18n="tb.view">Вид</button>
  <button class="mb-item" role="menuitem" data-mac-menu="window" data-i18n="menu.window">Окно</button>
  <button class="mb-item" role="menuitem" data-mac-menu="help" data-i18n="tb.help">Справка</button>
  <span class="tb-flex"></span>
  <span class="mb-tray" id="mbTray" data-i18n-title="mb.tray"><!-- малый знак lgA lgA-mono 16 px --></span>
</div>
```

```html
<header id="titlebar">
  <div class="tl-mac" aria-hidden="true"><span class="tl r"></span><span class="tl y"></span><span class="tl g"></span></div>
  <div class="tb-brand" id="appTitle" tabindex="-1"><!-- малый знак 16 px --><span>LAVRay</span></div>
  <button class="tb-ic" id="tbMenu" aria-haspopup="menu" aria-expanded="false" data-i18n-aria="aria.menu" data-i18n-title="aria.menu"><span class="ic" data-icon="menu"></span></button>
  <div id="addrbar">
    <button class="addr-btn" tabindex="-1" data-i18n-aria="web.back" data-i18n-title="web.back"><span class="ic ic-16" data-icon="arrleft"></span></button>
    <button class="addr-btn" tabindex="-1" disabled data-i18n-aria="web.fwd" data-i18n-title="web.fwd"><span class="ic ic-16" data-icon="arrright"></span></button>
    <div class="addr-pill"><span class="addr-warn"><span class="ic ic-16" data-icon="alert"></span><span data-i18n="web.insecure">Не защищено</span></span><span class="mono">http://192.168.1.1:9090/</span></div>
  </div>
  <span class="tb-flex"></span>
  <div class="caps-win">
    <button class="cap-btn" id="wbMin" tabindex="-1" data-i18n-aria="tb.min" data-i18n-title="tb.min"><span class="ic ic-16" data-icon="minimize"></span></button>
    <button class="cap-btn" id="wbMax" tabindex="-1" data-i18n-aria="tb.max" data-i18n-title="tb.max"><span class="ic ic-16" data-icon="maximize"></span></button>
    <button class="cap-btn cap-close" id="wbClose" tabindex="-1" data-i18n-aria="tb.close" data-i18n-title="tb.close"><span class="ic ic-16" data-icon="x"></span></button>
  </div>
  <div class="caps-linux">
    <button class="cap-btn cap-round" id="wbCloseL" tabindex="-1" data-i18n-aria="tb.close" data-i18n-title="tb.close"><span class="ic ic-16" data-icon="x"></span></button>
  </div>
</header>
```

CSS (старые правила `#winbtns`, `.winbtn*`, `.menubar`, `.mn-trigger*`, `#appTitle{…}`, `#globalCtl`, `#langSel{…}` (стили селекта переедут в стенд), `#app[data-mode="browser"] #winbtns…` удалить):

```css
#titlebar{position:relative;display:flex;align-items:center;gap:6px;height:var(--tb-h);padding-inline-start:10px;background:var(--surface);
  border-bottom:1px solid var(--b-subtle);user-select:none}
.tl-mac,.caps-win,.caps-linux,#addrbar,#macbar{display:none}
.tb-brand{display:flex;align-items:center;gap:8px;font-size:.8125rem;font-weight:600;color:var(--t2)}
.tb-flex{flex:1}
.cap-btn{display:inline-flex;align-items:center;justify-content:center;color:var(--t2);background:none;border:0}
html[data-shell="native"][data-os="win"] .caps-win{display:flex;align-self:stretch}
html[data-os="win"] .caps-win .cap-btn{width:46px;height:100%}
html[data-os="win"] .caps-win .cap-btn:hover{background:var(--hover);color:var(--t1)}
html[data-os="win"] .caps-win .cap-close:hover{background:#C42B1C;color:#fff}
html[data-shell="native"][data-os="mac"] .tl-mac{display:flex;gap:8px;padding-inline:4px 8px}
.tl{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.25)}
.tl.r{background:#FF5F57}.tl.y{background:#FEBC2E}.tl.g{background:#28C840}
html[data-shell="native"][data-os="mac"] .tb-brand,html[data-shell="native"][data-os="linux"] .tb-brand{position:absolute;left:50%;transform:translateX(-50%)}
html[data-shell="native"][data-os="mac"] #tbMenu{display:none}
html[data-shell="native"][data-os="mac"] #macbar{display:flex;align-items:center;gap:2px;height:24px;padding-inline:10px;
  background:color-mix(in srgb,var(--surface) 80%,#888);color:var(--t1);font-size:.8125rem}
.mb-item{height:22px;padding-inline:8px;border-radius:4px;background:none;border:0;color:inherit}
.mb-item:hover,.mb-item[aria-expanded="true"]{background:var(--hover)}
.mb-app{font-weight:700}
.mb-logo{width:14px;height:14px;border-radius:4px;background:var(--t2);margin-inline-end:6px}
.mb-tray{display:inline-flex;color:var(--t1)}
html[data-shell="native"][data-os="mac"] #app{height:calc(100vh - 24px)}
html[data-shell="native"][data-os="linux"] .caps-linux{display:flex;padding-inline-end:8px}
html[data-shell="native"][data-os="linux"] #tbMenu{order:3}
html[data-shell="native"][data-os="linux"] .caps-linux{order:4}
html[data-os="linux"] .cap-round{width:32px;height:32px;border-radius:50%}
html[data-os="linux"] .cap-round:hover{background:var(--hover);color:var(--t1)}
html[data-shell="browser"] #addrbar{display:flex;flex:1;align-items:center;gap:6px;min-width:0;padding-inline-end:10px}
html[data-shell="browser"] .tb-brand,html[data-shell="browser"] #tbMenu{display:none}
.addr-pill{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:30px;padding-inline:12px;border-radius:var(--r-full);
  background:var(--surface2);border:1px solid var(--b-subtle);color:var(--t2);font-size:.75rem;overflow:hidden}
.addr-warn{display:inline-flex;align-items:center;gap:4px;color:var(--warn-text);font-weight:600;white-space:nowrap}
```

JS (новый раздел `/* ===== OS chrome ===== */`; `menubarItems` и обработчики `.mn-trigger` удалить; в `applyMode()` добавить строку `document.documentElement.dataset.shell=S.mode==='browser'?'browser':'native';`):

```js
function detectOS(){const u=navigator.userAgent;return /Mac/.test(u)?'mac':(/Linux|X11/.test(u)&&!/Android/.test(u)?'linux':'win');}
function modKey(){return S.os==='mac'?'⌘':(S.lang==='de'?'Strg':'Ctrl');}
function kbdLabel(k){return S.os==='mac'?'⌘'+k:modKey()+'+'+k;}
function renderKbd(){document.querySelectorAll('[data-kbd]').forEach(el=>{el.textContent=el.dataset.kbd==='Esc'?'Esc':kbdLabel(el.dataset.kbd);});}
function applyOS(os){
S.os=os||S.os||detectOS();
document.documentElement.dataset.os=S.os;
document.querySelectorAll('[data-os-btn]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.osBtn===S.os)));
renderKbd();save();
}
function tbMenuItems(){
const on=S.conn==='on';
return[
{ic:'download',label:t('menu.file.import'),fn:()=>openDlg('dlgImport')},
{ic:on?'power':'zap',label:t(on?'conn.disconnect':'conn.connect'),kbd:kbdLabel('D'),fn:toggleConn},
'sep',
{ic:'zap',label:t('menu.help.onb'),fn:openOnboarding},
{ic:'keyboard',label:t('menu.help.hotkeys'),fn:()=>openDlg('dlgHotkeys')},
{ic:'info',label:t('menu.help.about'),fn:()=>gotoSettingsSection('about')},
'sep',
{ic:'x',label:t('menu.file.quit'),fn:()=>toast('toast.window')},
];
}
function macMenuItems(which){
const ex=cmd=>()=>{try{document.execCommand(cmd);}catch(e){}};
if(which==='app')return[{ic:'info',label:t('menu.help.about'),fn:()=>gotoSettingsSection('about')},{ic:'settings',label:t('nav.settings'),kbd:'⌘,',fn:()=>switchScreen('settings')},'sep',{ic:'x',label:t('menu.file.quit'),kbd:'⌘Q',fn:()=>toast('toast.window')}];
if(which==='edit')return[{label:t('menu.edit.undo'),kbd:'⌘Z',fn:ex('undo')},{label:t('menu.edit.redo'),kbd:'⇧⌘Z',fn:ex('redo')},'sep',{label:t('menu.edit.cut'),kbd:'⌘X',fn:ex('cut')},{label:t('menu.edit.copy'),kbd:'⌘C',fn:ex('copy')},{label:t('menu.edit.paste'),kbd:'⌘V',fn:()=>toast('toast.window')},{label:t('menu.edit.all'),kbd:'⌘A',fn:ex('selectAll')}];
if(which==='view')return[{ic:'moon',label:t('theme.dark'),check:S.theme==='dark',fn:()=>setTheme('dark')},{ic:'sun',label:t('theme.light'),check:S.theme==='light',fn:()=>setTheme('light')},{ic:'monitor',label:t('theme.system'),check:S.theme==='system',fn:()=>setTheme('system')}];
if(which==='window')return[{label:t('tb.min'),kbd:'⌘M',fn:()=>toast('toast.window')}];
return[{ic:'zap',label:t('menu.help.onb'),fn:openOnboarding},{ic:'keyboard',label:t('menu.help.hotkeys'),fn:()=>openDlg('dlgHotkeys')}];
}
function gotoSettingsSection(sec){switchScreen('settings');setTimeout(()=>{const el=document.querySelector('[data-sec="'+sec+'"]');if(el){el.scrollIntoView({block:'start'});const h=el.querySelector('h2');if(h){h.tabIndex=-1;h.focus();}}},60);}
document.getElementById('tbMenu').addEventListener('click',function(){const r=this.getBoundingClientRect();openMenu(tbMenuItems(),r.left,r.bottom+4,null,this);});
document.querySelectorAll('[data-mac-menu]').forEach(b=>b.addEventListener('click',function(){const r=this.getBoundingClientRect();openMenu(macMenuItems(this.dataset.macMenu),r.left,r.bottom+2,null,this);}));
['wbMin','wbMax','wbClose','wbCloseL'].forEach(id=>{const b=document.getElementById(id);b&&b.addEventListener('click',()=>toast('toast.window'));});
```

Подписи клавиш в разметке: каждое `<span class="kbd"><kbd>Ctrl</kbd><kbd>K</kbd></span>` заменить на `<kbd class="kbd" data-kbd="K"></kbd>` (аналогично `D`, `,`; для `Esc` — `data-kbd="Esc"`). `renderKbd()` вызывать из `applyLang` и `applyOS`. В `init` до первого рендера: `applyOS(new URLSearchParams(location.hash.slice(1)).get('os')||S.os||detectOS());`.

---

## S4. Стенд прототипа (задача A4)

Разметка — после закрывающего `</div>` элемента `#app`:

```html
<button id="standBtn" aria-expanded="false" aria-controls="standPanel" data-a11y-ignore><span class="ic" data-icon="sliders"></span><span data-i18n="stand.title">Стенд</span></button>
<section id="standPanel" role="dialog" aria-modal="false" aria-labelledby="standTitle" hidden inert data-a11y-ignore>
  <h2 id="standTitle" data-i18n="stand.title">Стенд</h2>
  <div class="st-grp"><label class="st-l" for="langSel" data-i18n="stand.lang">Язык</label>
    <select class="select" id="langSel"><option value="ru">Русский</option><option value="zh">简体中文</option><option value="en">English</option><option value="es">Español</option><option value="de">Deutsch</option></select></div>
  <div class="st-grp"><span class="st-l" id="stThemeL" data-i18n="stand.theme">Тема</span>
    <div class="seg" role="radiogroup" aria-labelledby="stThemeL"><button role="radio" data-theme-btn="dark" data-i18n="theme.dark">Тёмная</button><button role="radio" data-theme-btn="light" data-i18n="theme.light">Светлая</button><button role="radio" data-theme-btn="system" data-i18n="theme.system">Как в системе</button></div></div>
  <div class="st-grp"><span class="st-l" id="stOsL" data-i18n="stand.os">ОС</span>
    <div class="seg" role="radiogroup" aria-labelledby="stOsL"><button role="radio" data-os-btn="win">Windows</button><button role="radio" data-os-btn="mac">macOS</button><button role="radio" data-os-btn="linux">Linux</button></div></div>
  <div class="st-grp"><span class="st-l" id="stModeL" data-i18n="stand.mode">Режим</span>
    <div class="seg" id="modeSeg" role="radiogroup" aria-labelledby="stModeL"><button role="radio" data-mode-btn="native" data-i18n="mode.app">Приложение</button><button role="radio" data-mode-btn="browser" data-i18n="mode.browser">Браузер</button></div></div>
  <div class="st-grp"><span class="st-l" id="stDevL" data-i18n="stand.dev">Устройство</span>
    <div class="seg" role="radiogroup" aria-labelledby="stDevL"><button role="radio" data-dev-btn="window" data-i18n="stand.dev.window">Окно</button><button role="radio" data-dev-btn="tablet" data-i18n="stand.dev.tablet">Планшет</button><button role="radio" data-dev-btn="phone" data-i18n="stand.dev.phone">Телефон</button></div></div>
  <div class="st-grp"><span class="st-l" id="stScnL" data-i18n="stand.data">Данные</span>
    <div class="seg" role="radiogroup" aria-labelledby="stScnL"><button role="radio" data-scn-btn="demo" data-i18n="stand.scn.demo">Демо</button><button role="radio" data-scn-btn="empty" data-i18n="stand.scn.empty">Первый запуск</button><button role="radio" data-scn-btn="error" data-i18n="stand.scn.error">Ошибки</button><button role="radio" data-scn-btn="loading" data-i18n="stand.scn.loading">Загрузка</button></div></div>
  <div class="st-grp st-row"><span class="st-l" id="stNekoL" data-i18n="stand.neko">Найдена конфигурация NekoBox</span><button class="sw" role="switch" aria-checked="true" id="stNeko" aria-labelledby="stNekoL"></button></div>
  <div class="st-acts"><button class="btn btn-sec btn-sm" id="stOnb" data-i18n="menu.help.onb">Онбординг</button><button class="btn btn-sec btn-sm" id="stLogin" data-i18n="stand.login">Вход в веб-панель</button><button class="btn btn-sec btn-sm" id="stA11y" data-i18n="stand.a11y">Проверить доступность</button></div>
</section>
```

```css
#standBtn{position:fixed;inset-inline-start:12px;bottom:12px;z-index:700;display:inline-flex;align-items:center;gap:6px;height:36px;padding-inline:12px;
  border-radius:var(--r-full);background:var(--surface);border:1px solid var(--b-strong);color:var(--t1);font-size:.8125rem;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.25)}
#standPanel{position:fixed;inset-inline-start:12px;bottom:56px;z-index:700;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;
  padding:14px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--b-strong);box-shadow:0 18px 48px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:12px}
#standPanel h2{font-size:.875rem}
.st-grp{display:flex;flex-direction:column;gap:6px}
.st-grp.st-row{flex-direction:row;align-items:center;justify-content:space-between;gap:12px}
.st-l{font-size:.75rem;color:var(--t2);font-weight:600}
.st-acts{display:flex;flex-wrap:wrap;gap:6px}
body.dev-tablet,body.dev-phone{display:grid;place-items:center;min-height:100vh;background:#0B0B0D}
body.dev-tablet #app{width:768px;height:min(1024px,calc(100vh - 32px))}
body.dev-phone #app{width:390px;height:min(844px,calc(100vh - 32px))}
body.dev-tablet #app,body.dev-phone #app{border:1px solid var(--b-strong);border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45)}
```

```js
/* ===== stand ===== */
const DEMO_PROFILES=clone(PROFILES),DEMO_SUBS=clone(SUBS);
function setScenario(s){
S.scenario=s;
PROFILES.length=0;SUBS.length=0;
if(s!=='empty'){clone(DEMO_PROFILES).forEach(p=>PROFILES.push(p));clone(DEMO_SUBS).forEach(x=>SUBS.push(x));}
S.profileId=PROFILES[0]?(PROFILES.find(p=>p.id===S.profileId)?S.profileId:PROFILES[0].id):null;
if(s==='empty'){LOGS.length=0;S.conn='off';}
S.coreError=s==='error'?'port':null;S.coreStarting=s==='loading';
if(s==='error'){S.conn='off';const b=SUBS.find(x=>x.id==='sub3');if(b)b.error='401';}
document.querySelectorAll('[data-scn-btn]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.scnBtn===s)));
renderAll();
}
function setDevice(d){
document.body.classList.toggle('dev-tablet',d==='tablet');document.body.classList.toggle('dev-phone',d==='phone');
if(d!=='window'&&S.mode!=='browser'){S.mode='browser';applyMode();}
document.querySelectorAll('[data-dev-btn]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.devBtn===d)));
setTimeout(()=>{placeInd();drawGraph();},50);
}
function toggleStand(open){
const p=document.getElementById('standPanel'),b=document.getElementById('standBtn');
open=open===undefined?p.hidden:open;
p.hidden=!open;p.inert=!open;b.setAttribute('aria-expanded',String(open));
if(open)setTimeout(()=>p.querySelector('select,button').focus(),20);else b.focus();
}
document.getElementById('standBtn').addEventListener('click',()=>toggleStand());
document.getElementById('standPanel').addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();toggleStand(false);}});
document.getElementById('standPanel').addEventListener('click',e=>{
const os=e.target.closest('[data-os-btn]');if(os){applyOS(os.dataset.osBtn);return;}
const dv=e.target.closest('[data-dev-btn]');if(dv){setDevice(dv.dataset.devBtn);return;}
const sc=e.target.closest('[data-scn-btn]');if(sc){setScenario(sc.dataset.scnBtn);return;}
});
document.getElementById('stNeko').addEventListener('click',function(){S.nekoFound=this.getAttribute('aria-checked')!=='true';this.setAttribute('aria-checked',String(S.nekoFound));save();});
document.getElementById('stOnb').addEventListener('click',()=>openOnboarding());
document.getElementById('stLogin').addEventListener('click',()=>{S.webAuthed=false;if(S.mode!=='browser'){S.mode='browser';applyMode();}renderWebLogin();});
document.getElementById('stA11y').addEventListener('click',()=>runA11yCheck());
```

Существующий обработчик кликов по `[data-theme-btn]` и `[data-mode-btn]` (раздел settings) работает и для стенда; `applyTheme` и `applyMode` дополнительно ставят `aria-checked` своим кнопкам. Хеш-параметры `data=` и `dev=` в `init`: `if(h.has('data'))setScenario(h.get('data')); if(h.has('dev'))setDevice(h.get('dev'));`.

---

## S5. Пять разделов, вкладки, индикатор, горячие клавиши (задача A5)

Разметка навигации (заменить содержимое `<nav class="sb-nav">`):

```html
<nav class="sb-nav" data-i18n-aria="aria.nav">
  <span class="sb-ind" aria-hidden="true"></span>
  <button class="sb-item on" data-grp="connection" aria-current="page" data-i18n-title="nav.connection"><span class="ic" data-icon="zap"></span><span class="sb-l" data-i18n="nav.connection">Подключение</span></button>
  <button class="sb-item" data-grp="servers" data-i18n-title="nav.servers"><span class="ic" data-icon="layers"></span><span class="sb-l" data-i18n="nav.servers">Серверы</span></button>
  <button class="sb-item" data-grp="rules" data-i18n-title="nav.rules"><span class="ic" data-icon="route"></span><span class="sb-l" data-i18n="nav.rules">Правила</span></button>
  <button class="sb-item" data-grp="diag" data-i18n-title="nav.diag"><span class="ic" data-icon="activity"></span><span class="sb-l" data-i18n="nav.diag">Диагностика</span></button>
  <button class="sb-item" data-grp="settings" data-i18n-title="nav.settings"><span class="ic" data-icon="settings"></span><span class="sb-l" data-i18n="nav.settings">Настройки</span></button>
</nav>
```

Подсказки `data-tip` у пунктов показывать только при свёрнутом сайдбаре: в `showTip(target)` первой строкой добавить `if(target.classList.contains('sb-item')&&!document.body.classList.contains('w-md'))return;`.

Заголовок группы — первым элементом внутри `<main id="main" tabindex="-1">`:

```html
<div id="grpHead"><h1 id="ghTitle"></h1><p class="sub" id="ghSub"></p><div class="subtabs" id="ghTabs" role="tablist" data-i18n-aria="aria.tabs"></div></div>
```

```css
#grpHead{max-width:1180px;margin-inline:auto;padding:24px 28px 0}
#grpHead h1{font-size:1.25rem;font-weight:650;letter-spacing:-.01em}
#grpHead .sub{margin-top:2px;font-size:.8125rem;color:var(--t2)}
.subtabs{position:relative;display:flex;gap:4px;margin-top:14px;border-bottom:1px solid var(--b-subtle)}
.subtab{position:relative;z-index:1;min-height:36px;padding:8px 14px;font-size:.8125rem;font-weight:500;color:var(--t2);background:none;border:0}
.subtab:hover{color:var(--t1)}
.subtab[aria-selected="true"]{color:var(--t1);font-weight:650}
.subtab-ind{position:absolute;bottom:-1px;left:0;height:2px;border-radius:2px;background:var(--accent);transition:transform var(--t-emph) var(--e-in),width var(--t-emph) var(--e-in)}
.screen{padding-top:16px}
.scr-head{justify-content:flex-end}
.scr-head>div:first-child:not(.scr-actions){display:none}
.sb-nav{position:relative}
.sb-ind{position:absolute;left:0;top:0;border-radius:var(--r-md);background:var(--accent-soft);pointer-events:none;
  transition:transform var(--t-emph) var(--e-in),width var(--t-emph) var(--e-in),height var(--t-emph) var(--e-in)}
.sb-item{position:relative;z-index:1}
.sb-item.on{background:transparent;color:var(--accent);font-weight:600}
.screen.active{animation:scrFade var(--t-std) linear both}
.screen.active>*{animation:scrChild var(--t-emph) var(--e-in) both}
.screen.active>*:nth-child(2){animation-delay:32ms}.screen.active>*:nth-child(3){animation-delay:64ms}
.screen.active>*:nth-child(4){animation-delay:96ms}.screen.active>*:nth-child(5){animation-delay:128ms}.screen.active>*:nth-child(n+6){animation-delay:160ms}
#main[data-axis="y"]{--ax:0;--ay:1} #main[data-axis="x"]{--ax:1;--ay:0}
@keyframes scrFade{from{opacity:0}}
@keyframes scrChild{from{opacity:0;transform:translate(calc(var(--ax,0) * 12px * var(--dir,1)),calc(var(--ay,1) * 10px * var(--dir,1)))}}
```

JS — заменить раздел `/* ===== navigation ===== */` (старую `switchScreen` и `let CUR_SCREEN`) и обработчик `.sb-item` в разделе titlebar misc:

```js
const GROUPS=[
{id:'connection',key:'nav.connection',tabs:[['connection',null]]},
{id:'servers',key:'nav.servers',tabs:[['profiles','tab.servers'],['subscriptions','nav.subscriptions']]},
{id:'rules',key:'nav.rules',tabs:[['routing','nav.routing'],['dns','']]},
{id:'diag',key:'nav.diag',tabs:[['checks','tab.checks'],['conns','tab.conns'],['log','nav.log']]},
{id:'settings',key:'nav.settings',tabs:[['settings','tab.params'],['updates','nav.updates']]},
];
const SUBKEY={connection:'scr.connection.sub',profiles:'scr.profiles.sub',subscriptions:'scr.subs.sub',routing:'scr.routing.sub',dns:'scr.dns.sub',
checks:'scr.checks.sub',conns:'scr.conns.sub',log:'scr.log.sub',settings:'scr.settings.sub',updates:'scr.updates.sub'};
let CUR_SCREEN='connection',CUR_GRP='connection';
function grpOf(id){return GROUPS.find(g=>g.id===id||g.tabs.some(([s])=>s===id));}
function switchScreen(id){
const g=grpOf(id)||GROUPS[0];
S.grpLast=S.grpLast||{};
const scr=g.id===id?(S.grpLast[g.id]||g.tabs[0][0]):id;
const same=g.id===CUR_GRP;
const gi=GROUPS.indexOf(g),pgi=GROUPS.findIndex(x=>x.id===CUR_GRP);
const ti=g.tabs.findIndex(([s])=>s===scr),pti=g.tabs.findIndex(([s])=>s===CUR_SCREEN);
const main=document.getElementById('main');
main.style.setProperty('--dir',same?(ti>=pti?1:-1):(gi>=pgi?1:-1));
main.dataset.axis=same?'x':'y';
CUR_GRP=g.id;CUR_SCREEN=scr;S.grpLast[g.id]=scr;
document.querySelectorAll('.sb-item').forEach(b=>{const on=b.dataset.grp===g.id;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='scr-'+scr));
renderGrpHead();placeInd();
main.scrollTop=0;
if(scr==='settings'&&document.getElementById('setSearch').value)filterSettings('');
if(scr==='conns'&&typeof renderConns==='function')renderConns();
save();
}
function renderGrpHead(){
const g=grpOf(CUR_GRP),multi=g.tabs.length>1;
document.getElementById('ghTitle').textContent=t(g.key);
document.getElementById('ghSub').textContent=t(SUBKEY[CUR_SCREEN]);
const tl=document.getElementById('ghTabs');
tl.hidden=!multi;
tl.innerHTML='<span class="subtab-ind" aria-hidden="true"></span>'+g.tabs.map(([s,k])=>
'<button class="subtab" role="tab" id="tab-'+s+'" aria-controls="scr-'+s+'" aria-selected="'+(s===CUR_SCREEN)+'" tabindex="'+(s===CUR_SCREEN?0:-1)+'">'+esc(k?t(k):'DNS')+'</button>').join('');
GROUPS.forEach(gr=>gr.tabs.forEach(([s])=>{const sec=document.getElementById('scr-'+s);if(!sec)return;
if(gr.tabs.length>1){sec.setAttribute('role','tabpanel');sec.setAttribute('aria-labelledby','tab-'+s);}else{sec.removeAttribute('role');sec.setAttribute('aria-labelledby','ghTitle');}}));
}
function placeInd(){
const nav=document.querySelector('.sb-nav'),ind=nav&&nav.querySelector('.sb-ind'),b=nav&&nav.querySelector('.sb-item.on');
if(ind&&b){ind.style.transform='translate('+b.offsetLeft+'px,'+b.offsetTop+'px)';ind.style.width=b.offsetWidth+'px';ind.style.height=b.offsetHeight+'px';}
const tl=document.getElementById('ghTabs'),ti=tl&&tl.querySelector('.subtab-ind'),tb=tl&&tl.querySelector('[aria-selected="true"]');
if(ti&&tb){ti.style.transform='translateX('+tb.offsetLeft+'px)';ti.style.width=tb.offsetWidth+'px';}
}
window.addEventListener('resize',placeInd);
document.getElementById('ghTabs').addEventListener('click',e=>{const b=e.target.closest('[role=tab]');if(b)switchScreen(b.id.slice(4));});
document.getElementById('ghTabs').addEventListener('keydown',e=>{
const ts=[...e.currentTarget.querySelectorAll('[role=tab]')],i=ts.indexOf(document.activeElement);if(i<0)return;
let n=null;if(e.key==='ArrowRight')n=i+1;else if(e.key==='ArrowLeft')n=i-1;else if(e.key==='Home')n=0;else if(e.key==='End')n=ts.length-1;
if(n===null)return;e.preventDefault();n=(n+ts.length)%ts.length;switchScreen(ts[n].id.slice(4));
const cur=document.querySelector('#ghTabs [aria-selected="true"]');cur&&cur.focus();
});
document.querySelectorAll('.sb-item').forEach(b=>b.addEventListener('click',()=>switchScreen(b.dataset.grp)));
```

Горячие клавиши — в обработчике `keydown` раздела hotkeys заменить ветку модификаторов:

```js
const mod=S.os==='mac'?e.metaKey:e.ctrlKey;
if(mod&&!e.altKey&&!e.shiftKey){
const k=e.key.toLowerCase();
if(k==='k'){e.preventDefault();switchScreen('profiles');const s=document.getElementById('profSearch');s.focus();s.select();}
else if(k==='d'){e.preventDefault();toggleConn();}
else if(k===','){e.preventDefault();switchScreen('settings');}
else if(/^[1-5]$/.test(k)){e.preventDefault();switchScreen(GROUPS[+k-1].id);}
}
```

Ветку `Escape` в этом обработчике оставить только для меню и панели профиля (диалоги закрывает менеджер из S7). Нижние карточки: `coreCard` → `gotoSettingsSection('core')`, `updCard` и `gotoUpd` → `switchScreen('updates')`.

---

## S6. Адаптивность (задача A6)

Ширина окна приложения отслеживается `ResizeObserver`; классы ставятся на `<body>`, потому что диалоги и панель профиля лежат вне `#app`.

```js
/* ===== responsive ===== */
new ResizeObserver(([en])=>{
const w=en.contentRect.width;
document.body.classList.toggle('w-md',w>=600&&w<960);
document.body.classList.toggle('w-sm',w<600);
placeInd();drawGraph();
}).observe(document.getElementById('app'));
```

```css
#app{min-width:0}
#app[data-mode="native"]{min-width:880px;min-height:560px}
.skip-link{position:absolute;inset-inline-start:8px;top:-60px;z-index:900;padding:8px 12px;border-radius:var(--r-md);background:var(--accent);color:var(--accent-contrast);font-weight:600}
.skip-link:focus{top:8px}
html[data-shell="native"] .skip-link{display:none}
/* 600–959: сайдбар из иконок */
body.w-md{--sidebar-w:64px}
body.w-md .sb-l,body.w-md .sb-logo .lg-name,body.w-md .sb-card-t{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
body.w-md .sb-item,body.w-md .sb-card{justify-content:center;padding-inline:0}
body.w-md .conn2{grid-template-columns:minmax(0,1fr)}
/* < 600: нижняя навигация */
body.w-sm #statusbar{display:none}
body.w-sm #app{grid-template-rows:var(--tb-h) minmax(0,1fr)}
body.w-sm #body{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto}
body.w-sm #sidebar{order:2;flex-direction:row;padding:4px 6px calc(4px + env(safe-area-inset-bottom,0px));border-inline-end:0;border-top:1px solid var(--b-subtle)}
body.w-sm .sb-logo,body.w-sm .sb-bottom{display:none}
body.w-sm .sb-nav{flex-direction:row;flex:1;gap:2px}
body.w-sm .sb-item{flex:1 1 0;flex-direction:column;gap:2px;min-height:52px;padding:6px 2px;font-size:.6875rem;justify-content:center;text-align:center;min-width:0}
body.w-sm .sb-l{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body.w-sm .screen,body.w-sm #grpHead{padding-inline:16px}
body.w-sm .conn2,body.w-sm .form-grid,body.w-sm .preset-grid,body.w-sm .dns-grid,body.w-sm .sub-grid,body.w-sm .set-layout,body.w-sm .upd-vers{grid-template-columns:minmax(0,1fr)}
body.w-sm .prof-toolbar,body.w-sm .log-toolbar{flex-wrap:wrap}
body.w-sm .dlg-back{align-items:flex-end;padding:0}
body.w-sm .dlg{width:100%;max-width:100%;max-height:92vh;border-radius:16px 16px 0 0}
body.w-sm #drawer{width:100%}
body.w-sm .subtabs{overflow-x:auto}
body.w-sm .conn-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
body.w-sm .conn-table tr{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:10px 0;border-top:1px solid var(--b-subtle)}
body.w-sm .conn-table td{border:0;padding:0}
```

Разметка: `<a class="skip-link" href="#main" data-i18n="a11y.skip">Перейти к содержимому</a>` — первым дочерним элементом `#app`; у `<main id="main">` атрибут `tabindex="-1"`.

---

## S7. Модальные окна, панель профиля, меню, вкладки (задача A15)

Заменить раздел `/* ===== dialogs ===== */` (`dlgStack`, `openDlg`, `closeDlg`; обработчики `.dlg-back` по `pointerdown` и `[data-close]` оставить):

```js
/* ===== dialogs ===== */
const dlgStack=[];
function isShown(el){return !!el&&el.isConnected&&el.getClientRects().length>0&&!el.closest('[inert],[hidden]');}
function focusables(root){return [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(isShown);}
function drawerIsOpen(){return document.getElementById('drawer').classList.contains('open');}
function syncInert(){
const anyDlg=dlgStack.length>0;
document.getElementById('app').inert=anyDlg||drawerIsOpen();
const dr=document.getElementById('drawer');if(drawerIsOpen())dr.inert=anyDlg;
dlgStack.forEach((d,i)=>{const el=document.getElementById(d.id);if(el)el.inert=i<dlgStack.length-1;});
}
function openDlg(id,trigger){
const back=document.getElementById(id);if(!back||back.classList.contains('open'))return;
const h=back.querySelector('.dlg-h h2,.dlg-h h3');
if(h){if(!h.id)h.id=id+'-title';back.setAttribute('aria-labelledby',h.id);}
dlgStack.push({id,trigger:trigger||document.activeElement});
back.classList.add('open');
syncInert();
const body=back.querySelector('.dlg-b')||back;
const f=back.querySelector('[data-autofocus]:not([hidden])')
||body.querySelector('input:not([type=hidden]):not([disabled]):not([hidden]),select:not([disabled]),textarea:not([disabled])')
||body.querySelector('button:not([disabled])')
||back.querySelector('.dlg-h [data-close]');
setTimeout(()=>{if(isShown(f))f.focus();},30);
}
function closeDlg(id){
const i=id?dlgStack.findIndex(d=>d.id===id):dlgStack.length-1;if(i<0)return;
const [d]=dlgStack.splice(i,1);
const back=document.getElementById(d.id);back.classList.remove('open');back.inert=false;
syncInert();
const tr=d.trigger;
setTimeout(()=>{if(isShown(tr))tr.focus();else document.getElementById('main').focus();},0);
}
document.addEventListener('keydown',e=>{
if(!dlgStack.length||openMenuEl)return;
const back=document.getElementById(dlgStack[dlgStack.length-1].id);
if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeDlg();return;}
if(e.key!=='Tab')return;
const f=focusables(back);if(!f.length)return;
const first=f[0],last=f[f.length-1],inside=back.contains(document.activeElement);
if(e.shiftKey&&(document.activeElement===first||!inside)){e.preventDefault();last.focus();}
else if(!e.shiftKey&&(document.activeElement===last||!inside)){e.preventDefault();first.focus();}
},true);
```

Панель профиля — заменить `openDrawer`/`closeDrawer` (заполнение полей из старой `openDrawer` перенести как есть на место комментария), в разметке `<aside id="drawer" … inert aria-labelledby="drName">`:

```js
let drawerProfile=null,drawerTrigger=null;
function openDrawer(p,trigger){
drawerProfile=p;
/* …заполнение drBadge, drName, drType, drServer, drSecretTxt, drTransport, drLat, drSub — как в v1.1… */
drawerTrigger=trigger||document.activeElement;
const dr=document.getElementById('drawer');dr.inert=false;
document.getElementById('drawerBack').classList.add('open');dr.classList.add('open');
syncInert();
setTimeout(()=>document.getElementById('drClose').focus(),30);
}
function closeDrawer(){
const dr=document.getElementById('drawer');if(!dr.classList.contains('open'))return;
document.getElementById('drawerBack').classList.remove('open');dr.classList.remove('open');dr.inert=true;
syncInert();
const tr=drawerTrigger;setTimeout(()=>{if(isShown(tr))tr.focus();},0);
}
```

```css
#drawer:not(.open){visibility:hidden;transition:transform var(--t-emph) var(--e-in),visibility 0s linear var(--t-emph)}
#drawer.open{visibility:visible;transition:transform var(--t-emph) var(--e-in)}
```

Меню — заменить раздел `/* ===== menus ===== */` (`openMenuEl`, `closeMenus`, `openMenu`, обработчик `pointerdown`):

```js
/* ===== menus ===== */
let openMenuEl=null,menuTrigger=null;
function closeMenus(returnFocus){
if(openMenuEl){openMenuEl.remove();openMenuEl=null;}
if(menuTrigger){menuTrigger.setAttribute('aria-expanded','false');const tr=menuTrigger;menuTrigger=null;if(returnFocus&&tr.isConnected)tr.focus();}
}
function openMenu(items,x,y,header,trigger){
closeMenus(false);
const m=document.createElement('div');m.className='menu';m.setAttribute('role','menu');
if(trigger){menuTrigger=trigger;trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','true');
m.setAttribute('aria-label',(trigger.getAttribute('aria-label')||trigger.textContent||'').trim());}
if(header)m.innerHTML='<div class="menu-head" role="presentation"><div class="n">'+header.badge+'<span>'+esc(header.name)+'</span></div><div class="c">'+esc(header.sub)+'</div></div>';
for(const it of items){
if(it==='sep'){m.insertAdjacentHTML('beforeend','<div class="menu-sep" role="separator"></div>');continue;}
const b=document.createElement('button');
b.className='menu-item'+(it.danger?' danger':'');
b.setAttribute('role',it.check!==undefined?'menuitemradio':'menuitem');
if(it.check!==undefined)b.setAttribute('aria-checked',String(!!it.check));
b.tabIndex=-1;
b.innerHTML=(it.ic?ic(it.ic):'<span style="width:15px"></span>')+'<span>'+esc(it.label)+'</span>'+(it.kbd?'<span class="mi-kbd">'+esc(it.kbd)+'</span>':'')+(it.check?'<span class="chk">'+ic('check')+'</span>':'');
b.addEventListener('click',()=>{closeMenus(true);it.fn&&it.fn();});
m.appendChild(b);
}
m.addEventListener('keydown',e=>{
const its=[...m.querySelectorAll('[role^="menuitem"]')],i=its.indexOf(document.activeElement);
if(e.key==='ArrowDown'){e.preventDefault();its[(i+1)%its.length].focus();}
else if(e.key==='ArrowUp'){e.preventDefault();its[(i-1+its.length)%its.length].focus();}
else if(e.key==='Home'){e.preventDefault();its[0].focus();}
else if(e.key==='End'){e.preventDefault();its[its.length-1].focus();}
else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenus(true);}
else if(e.key==='Tab'){closeMenus(false);}
else if(e.key.length===1&&/\S/.test(e.key)){const c=e.key.toLowerCase(),n=its.findIndex((el,k)=>k>i&&el.textContent.trim().toLowerCase().startsWith(c));if(n>-1)its[n].focus();}
});
document.body.appendChild(m);
const r=m.getBoundingClientRect();
m.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';
m.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';
openMenuEl=m;
const first=m.querySelector('[role^="menuitem"]');if(first)first.focus();
}
document.addEventListener('pointerdown',e=>{if(openMenuEl&&!openMenuEl.contains(e.target)&&!e.target.closest('[aria-haspopup="menu"]'))closeMenus(false);});
document.addEventListener('keydown',e=>{
if(!((e.key==='F10'&&e.shiftKey)||e.key==='ContextMenu'))return;
const row=e.target.closest('.prow,.preset,.rule-row,.ct-row');if(!row)return;
const btn=row.querySelector('[data-menu-p],[data-pmenu],[data-rmenu],[data-cmenu]');if(!btn)return;
e.preventDefault();btn.click();
});
document.addEventListener('contextmenu',e=>{const row=e.target.closest('.prow,.ct-row');if(!row)return;const btn=row.querySelector('[data-menu-p],[data-cmenu]');if(!btn)return;e.preventDefault();btn.click();});
```

Все вызовы `openMenu` передают триггер последним аргументом. В частности, в делегированном обработчике `[data-menu-p]`: `profileMenu(PROFILES.find(x=>x.id===mb.dataset.menuP),mb.getBoundingClientRect(),mb)`, а `profileMenu(p,r,trigger)` передаёт `trigger` в `openMenu`; так же — меню пресета `[data-pmenu]`, ошибки подписки, выбор сервера `#profilePick`.

Вкладки — общий помощник:

```js
function selectTab(list,i){
[...list.querySelectorAll('[role=tab]')].forEach((tb,k)=>{
tb.setAttribute('aria-selected',String(k===i));tb.tabIndex=k===i?0:-1;tb.classList.toggle('on',k===i);
const p=document.getElementById(tb.getAttribute('aria-controls'));if(p)p.hidden=k!==i;
});
}
function initTabs(list,onSelect){
list.setAttribute('role','tablist');
list.addEventListener('click',e=>{const tb=e.target.closest('[role=tab]');if(tb)onSelect([...list.querySelectorAll('[role=tab]')].indexOf(tb));});
list.addEventListener('keydown',e=>{
const ts=[...list.querySelectorAll('[role=tab]')],i=ts.indexOf(document.activeElement);if(i<0)return;
let n=null;if(e.key==='ArrowRight')n=i+1;else if(e.key==='ArrowLeft')n=i-1;else if(e.key==='Home')n=0;else if(e.key==='End')n=ts.length-1;
if(n===null)return;e.preventDefault();n=(n+ts.length)%ts.length;onSelect(n);
const cur=list.querySelector('[role=tab][aria-selected="true"]');if(cur)cur.focus();
});
}
```

Вкладки импорта — разметка кнопок `<button class="tab" role="tab" id="impTab-link" aria-controls="impPane-link" data-tab="link" …>`, панелей `<div class="imp-pane" role="tabpanel" id="impPane-link" aria-labelledby="impTab-link" data-pane="link">` (так же `qr`, `file`); `setImpTab(tab)` вызывает `selectTab(document.getElementById('impTabs'),['link','qr','file'].indexOf(tab))`; инициализация `initTabs(document.getElementById('impTabs'),i=>setImpTab(['link','qr','file'][i]));` (старые обработчики кликов по `#impTabs .tab` удалить).

---

## S8. Главный экран (задача A7)

Разметка — заменить `section#scr-connection` целиком:

```html
<section class="screen active" id="scr-connection">
  <div class="banner banner-err" id="connBanner" role="alert" hidden>
    <span class="ic" data-icon="alert"></span>
    <div class="bn-t"><b data-i18n="core.err.t">Ядро не запустилось</b><span data-i18n="core.err.port">Порт 2080 занят другой программой.</span></div>
    <div class="bn-acts"><button class="btn btn-sec btn-sm" id="cbRetry" data-i18n="err.retry">Повторить</button><button class="btn btn-ghost btn-sm" id="cbDiag" data-i18n="cx.toDiag">Открыть диагностику</button></div>
  </div>
  <div class="conn2">
    <div class="card cx-card" id="stateCard" data-conn="off">
      <div class="cx-top">
        <div class="ray" aria-hidden="true"><!-- полный знак из S2 --></div>
        <div class="cx-state"><div class="conn-state" id="connState" role="status" aria-live="polite"></div><div class="conn-state-sub" id="connStateSub"></div></div>
      </div>
      <div class="cx-main" id="cxMain">
        <div class="cx-server">
          <span class="cap" id="srvLbl" data-i18n="srv.current">Сервер</span>
          <button class="srv-pick" id="profilePick" aria-haspopup="menu" aria-expanded="false" aria-describedby="srvLbl">
            <span class="srv-top"><span class="srv-name" id="ppName"></span><span class="badge" id="ppBadge"></span></span>
            <span class="srv-addr mono" id="ppAddr"></span>
            <span class="srv-chg"><span data-i18n="srv.change">Сменить</span><span class="ic ic-16" data-icon="chevdown"></span></span>
          </button>
        </div>
        <button class="btn btn-lg btn-pri" id="connBtn"></button>
        <div class="cx-mode">
          <span class="cap" id="modeLbl"></span>
          <div class="seg seg-wide" id="connMode" role="radiogroup" aria-labelledby="modeLbl"></div>
          <p class="hint" id="modeHint"></p>
        </div>
        <dl class="cx-meta">
          <div><dt data-i18n="conn.session">Сессия</dt><dd class="mono" id="sessTime">00:00</dd></div>
          <div><dt data-i18n="conn.ip">IP через туннель</dt><dd class="mono" id="extIp">—</dd></div>
          <div><dt data-i18n="conn.country">Страна</dt><dd id="extGeo">—</dd></div>
        </dl>
      </div>
      <div class="cx-empty" id="cxEmpty" hidden>
        <p class="cx-empty-t" data-i18n="cx.empty.t">Пока нет серверов</p>
        <p class="cx-empty-d" data-i18n="cx.empty.d">Добавьте подписку или ссылку от провайдера — и подключайтесь.</p>
        <div class="cx-empty-acts"><button class="btn btn-pri" id="cxAdd" data-i18n="cx.add">Добавить сервер</button><button class="btn btn-sec" id="cxNeko" data-i18n="cx.neko">Перенести из NekoBox</button></div>
      </div>
      <div class="cx-qa">
        <button class="btn btn-ghost btn-sm" id="qaTest"><span class="ic" data-icon="gauge"></span><span class="ic ic-spin" data-icon="refresh"></span><span data-i18n="quick.test">Проверить серверы</span></button>
        <button class="btn btn-ghost btn-sm" id="qaImport"><span class="ic" data-icon="plus"></span><span data-i18n="quick.import">Добавить сервер</span></button>
        <button class="btn btn-ghost btn-sm" id="qaSubs"><span class="ic" data-icon="rss"></span><span class="ic ic-spin" data-icon="refresh"></span><span data-i18n="quick.subs">Обновить подписки</span></button>
      </div>
    </div>
    <div class="conn-right">
      <div class="card conn-graph">
        <!-- блоки .traffic-top, .traffic-legend и <canvas id="trafficCv" height="170" data-i18n-aria="aria.graph" role="img"> из v1.1 без изменений -->
        <div class="graph-empty" id="graphEmpty" data-i18n="graph.empty">Подключитесь, чтобы видеть скорость</div>
      </div>
      <div class="card" id="leakCard"></div>
      <div class="card" id="healthCard"><!-- содержимое карточки здоровья v1.1 (заголовок data-i18n="health.title", сетка .hl-grid) --></div>
    </div>
  </div>
</section>
```

```css
.conn2{display:grid;grid-template-columns:minmax(320px,1fr) minmax(0,1.15fr);gap:16px;align-items:start}
.conn-right{display:flex;flex-direction:column;gap:12px;min-width:0}
.conn-right>.card{margin:0}
.cx-card{display:flex;flex-direction:column;gap:16px}
.cx-top{display:flex;align-items:center;gap:16px}
.cx-state{min-width:0}
.cx-main{display:flex;flex-direction:column;gap:14px}
.cx-server{display:flex;flex-direction:column;gap:6px}
.srv-pick{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"top chg" "addr chg";gap:4px 12px;align-items:center;width:100%;
  padding:12px 14px;border-radius:var(--r-md);border:1px solid var(--b-control);background:var(--surface2);text-align:start}
.srv-pick:hover{background:var(--hover)}
.srv-top{grid-area:top;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.srv-name{font-size:1.05rem;font-weight:650;overflow-wrap:anywhere}
.srv-addr{grid-area:addr;color:var(--t2);font-size:.8125rem;overflow-wrap:anywhere}
.srv-chg{grid-area:chg;display:inline-flex;align-items:center;gap:4px;color:var(--accent);font-weight:600;font-size:.8125rem;white-space:nowrap}
#connBtn{width:100%}
.seg-wide{display:grid;grid-template-columns:1fr 1fr;width:100%}
.seg-wide button{justify-content:center;flex-wrap:wrap;text-align:center;font-size:.8125rem;padding:6px 10px}
.seg button[aria-checked="true"]{background:var(--surface);color:var(--t1);font-weight:600;box-shadow:inset 0 0 0 1.5px var(--b-control)}
.mode-admin{font-size:.625rem;font-weight:600;padding:1px 6px;border-radius:var(--r-full);border:1px solid var(--b-control);color:var(--t2)}
.cx-mode .hint{font-size:.75rem;color:var(--t2);margin-top:6px}
.cx-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:0}
.cx-meta>div{background:var(--surface2);border:1px solid var(--b-subtle);border-radius:var(--r-md);padding:10px 12px;min-width:0}
.cx-meta dt{font-size:.75rem;color:var(--t3);margin-bottom:2px}
.cx-meta dd{margin:0;font-size:.875rem;font-weight:600;overflow-wrap:anywhere}
.cx-qa{display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--b-subtle);padding-top:12px}
.cx-empty{display:flex;flex-direction:column;gap:8px}
.cx-empty-t{font-size:1.05rem;font-weight:650}
.cx-empty-d{color:var(--t2)}
.cx-empty-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.conn-graph{position:relative}
.graph-empty{position:absolute;inset:56px 16px 16px;display:grid;place-items:center;color:var(--t2);font-size:.875rem;text-align:center;pointer-events:none}
.banner{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:var(--r-md);margin-bottom:16px;flex-wrap:wrap}
.banner>.ic{flex:none;margin-top:2px}
.bn-t{flex:1;min-width:220px;display:flex;flex-direction:column;gap:2px;font-size:.8125rem}
.bn-acts{display:flex;gap:8px;flex-wrap:wrap}
.banner-err{background:color-mix(in srgb,var(--err) 10%,var(--surface));border:1px solid color-mix(in srgb,var(--err) 45%,var(--b-subtle))}
.banner-err>.ic{color:var(--err-text)}
.banner-warn{background:color-mix(in srgb,var(--warn) 10%,var(--surface));border:1px solid color-mix(in srgb,var(--warn) 45%,var(--b-subtle))}
.banner-warn>.ic{color:var(--warn-text)}
.leak-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.leak-row{display:flex;align-items:center;gap:10px;font-size:.8125rem;padding:8px 0;border-top:1px solid var(--b-subtle)}
.leak-row:first-child{border-top:0}
.lk-st{display:inline-flex;flex:none} .lk-ok{color:var(--ok-text)} .lk-warn{color:var(--warn-text)}
.lk-k{flex:1;min-width:0;color:var(--t2)}
.lk-v{font-family:var(--font-mono);font-size:.75rem;overflow-wrap:anywhere;text-align:end}
.leak-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.skel{background:var(--surface2);border-radius:var(--r-sm);animation:blink 1.4s ease-in-out infinite}
```

Старые правила `.conn-grid`, `.conn-side`, `.conn-meta*`, `.qa-list`, `.qa-btn*` удалить вместе с карточкой «Быстрые действия».

```js
/* ===== connection (заменяет renderConn) ===== */
function renderConn(){
const card=document.getElementById('stateCard'),p=curProfile(),none=!p;
const err=!!S.coreError,starting=!!S.coreStarting;
card.dataset.conn=err?'err':S.conn==='on'?'on':S.conn==='connecting'?'mid':'off';
const stKey=err?'err':starting?'starting':S.conn==='on'?'on':S.conn==='connecting'?'connecting':'off';
document.getElementById('connState').textContent=t('conn.state.'+stKey);
document.getElementById('connStateSub').textContent=t('conn.state.'+stKey+'.sub');
document.getElementById('connBanner').hidden=!err;
document.getElementById('cxMain').hidden=none;
document.getElementById('cxEmpty').hidden=!none;
const btn=document.getElementById('connBtn');
btn.disabled=starting||err||none;
btn.innerHTML=ic('power')+'<span>'+esc(t(S.conn==='on'?'conn.disconnect':S.conn==='connecting'?'conn.cancel':'conn.connect'))+'</span>';
btn.classList.toggle('btn-pri',S.conn!=='on');btn.classList.toggle('btn-danger-solid',S.conn==='on');
if(p){
document.getElementById('ppName').textContent=profName(p);
const bd=document.getElementById('ppBadge');bd.className='badge bt-'+p.type;bd.textContent=TYPE_LABEL[p.type];
document.getElementById('ppAddr').textContent=p.host+':'+p.port;
}
document.getElementById('extIp').textContent=S.conn==='on'&&p&&p.ip?p.ip:'—';
document.getElementById('extGeo').textContent=S.conn==='on'&&p?t('geo.'+(p.geo||'local')):'—';
document.getElementById('graphEmpty').hidden=S.conn==='on';
if(S.conn==='off')document.getElementById('sessTime').textContent='00:00';
const f=document.getElementById('bgField');if(f)f.dataset.conn=card.dataset.conn;
renderMode();renderStatus();renderHealth();renderLeaks(document.getElementById('leakCard'));
}
function toggleConn(){if(!curProfile()||S.coreError||S.coreStarting)return;if(S.conn==='connecting'){setConn('off');return;}if(S.conn==='on'){setConn('off');toast('toast.disconnected');}else setConn('connecting');}

function renderMode(){
const web=S.mode==='browser',seg=document.getElementById('connMode');
const opts=web?[['off','gw.off'],['tproxy','gw.tproxy'],['tun','gw.tun']]:[['sys','mode.sys'],['tun','mode.tun']];
const cur=web?(S.gw||'tproxy'):(S.tun?'tun':'sys');
seg.style.gridTemplateColumns='repeat('+opts.length+',1fr)';
seg.innerHTML=opts.map(([v,k])=>'<button role="radio" data-cmode="'+v+'" aria-checked="'+(v===cur)+'" tabindex="'+(v===cur?0:-1)+'"><span>'+esc(t(k))+'</span>'+
(!web&&v==='tun'?'<span class="mode-admin">'+esc(t('mode.admin'))+'</span>':'')+'</button>').join('');
document.getElementById('modeLbl').textContent=t(web?'gw.title':'mode.title');
document.getElementById('modeHint').textContent=t((web?'gw.':'mode.')+cur+'.hint');
}
function setMode(v){
if(S.mode==='browser'){S.gw=v;save();renderMode();renderStatus();return;}
if(v==='tun'&&!S.tunService){openDlg('dlgTun',document.querySelector('#connMode [data-cmode="tun"]'));return;}
S.tun=v==='tun';S.sysproxy=!S.tun;save();renderMode();renderStatus();
if(S.conn==='on')toast('toast.modeApplied');
}
document.getElementById('connMode').addEventListener('click',e=>{const b=e.target.closest('[data-cmode]');if(b)setMode(b.dataset.cmode);});
document.getElementById('connMode').addEventListener('keydown',e=>{
const bs=[...e.currentTarget.querySelectorAll('[role=radio]')],i=bs.indexOf(document.activeElement);if(i<0)return;
let n=null;if(e.key==='ArrowRight'||e.key==='ArrowDown')n=i+1;else if(e.key==='ArrowLeft'||e.key==='ArrowUp')n=i-1;if(n===null)return;
e.preventDefault();n=(n+bs.length)%bs.length;setMode(bs[n].dataset.cmode);
const cur=e.currentTarget.querySelector('[aria-checked="true"]');if(cur)cur.focus();
});
document.getElementById('tunInstall').addEventListener('click',function(){
const b=this;b.classList.add('loading');b.disabled=true;
setTimeout(()=>{b.classList.remove('loading');b.disabled=false;S.tunService=true;S.tun=true;S.sysproxy=false;save();closeDlg('dlgTun');renderMode();renderStatus();toast('toast.tunReady');},1200);
});

function renderLeaks(box){
if(!box)return;
const on=S.conn==='on',p=curProfile();
const rows=on?[['leak.ip','ok',(p&&p.ip||'—')+' · '+t('geo.'+((p&&p.geo)||'local'))],['leak.direct','ok',t('leak.hidden')],['leak.dns','ok',t('leak.noLeak')],['leak.ipv6','ok',t('leak.ipv6.tunnel')]]:[];
box.innerHTML='<div class="card-h">'+ic('shield')+'<h2>'+esc(t('leak.title'))+'</h2></div>'+
(on?'<ul class="leak-list">'+rows.map(([k,st,v])=>'<li class="leak-row"><span class="lk-st lk-'+st+'">'+ic(st==='ok'?'check':'alert','ic-16')+'<span class="sr-only">'+esc(t('st.'+st))+'</span></span><span class="lk-k">'+esc(t(k))+'</span><span class="lk-v">'+esc(v)+'</span></li>').join('')+'</ul>'
:'<p class="t2" style="font-size:.8125rem">'+esc(t('leak.off'))+'</p>')+
'<div class="leak-foot"><span class="cap">'+(S.leakAt?esc(tf('leak.last',{when:relTime(S.leakAt)})):'')+'</span><button class="btn btn-sec btn-sm" data-leak-run'+(on?'':' disabled')+'>'+ic('shield')+'<span>'+esc(t('leak.run'))+'</span></button></div>';
}
document.addEventListener('click',e=>{
const b=e.target.closest('[data-leak-run]');if(!b)return;
b.disabled=true;
setTimeout(()=>{S.leakAt=Date.now();document.querySelectorAll('#leakCard,#leakCard2').forEach(renderLeaks);toast('toast.leakOk');},1200);
});
document.getElementById('cbRetry').addEventListener('click',()=>{S.coreError=null;S.coreStarting=true;renderConn();setTimeout(()=>{S.coreStarting=false;renderConn();},1200);});
document.getElementById('cbDiag').addEventListener('click',()=>switchScreen('checks'));
document.getElementById('cxAdd').addEventListener('click',function(){openDlg('dlgImport',this);});
document.getElementById('cxNeko').addEventListener('click',function(){openOnboarding(2);});
```

Диалог TUN — вставить рядом с другими `.dlg-back`:

```html
<div class="dlg-back" id="dlgTun" role="dialog" aria-modal="true">
  <div class="dlg dlg-sm">
    <div class="dlg-h"><h2 data-i18n="tun.dlg.t">Включить режим TUN</h2><button class="btn btn-ic btn-sm" data-close data-i18n-title="common.close" data-i18n-aria="common.close"><span class="ic ic-16" data-icon="x"></span></button></div>
    <div class="dlg-b"><p data-i18n="tun.dlg.d"></p><p class="hint" data-i18n="tun.dlg.note"></p></div>
    <div class="dlg-f"><button class="btn btn-ghost" data-close data-i18n="common.cancel">Отмена</button><span class="flex1"></span><button class="btn btn-pri" id="tunInstall"><span class="ic ic-spin" data-icon="refresh"></span><span data-i18n="tun.dlg.ok">Установить службу</span></button></div>
  </div>
</div>
```

Меню выбора сервера (`#profilePick`, обработчик в разделе quick actions): пункты — профили, отсортированные по задержке, у текущего `check:true`, подпись «Имя · Протокол · 43 мс», затем `'sep'` и пункт «Все серверы…» (`srv.all`) → `switchScreen('profiles')`; передать `this` как триггер.

Статус-бар (`renderStatus`): `#stState` без `role`; пилюля режима показывает «Системный прокси» или «TUN» как режим, а подсветку `on` получает только при `S.conn==='on'`.

---

## S9. Проверка маршрута (задача A10)

Разметка — первым блоком `section#scr-routing` (после скрытой `.scr-head`):

```html
<div class="card" id="rtTester">
  <div class="card-h"><span class="ic" data-icon="search"></span><h2 data-i18n="rt.test.t">Проверить маршрут</h2></div>
  <div class="rt-in">
    <label class="sr-only" for="rtQ" data-i18n="rt.test.label">Адрес или приложение</label>
    <input class="input input-mono" id="rtQ" autocomplete="off" spellcheck="false" data-i18n-ph="rt.test.ph" placeholder="lori.ru · chat.openai.com · steam.exe">
    <button class="btn btn-pri" id="rtGo" data-i18n="rt.test.run">Проверить</button>
  </div>
  <div class="rt-sugg" id="rtSugg"></div>
  <p class="rt-res" id="rtRes" role="status" aria-live="polite"></p>
</div>
```

```css
.rt-in{display:flex;gap:8px;flex-wrap:wrap}
.rt-in .input{flex:1 1 240px;min-width:0}
.rt-sugg{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.rt-sugg button{height:28px;padding-inline:10px;border-radius:var(--r-full);border:1px solid var(--b-control);font-family:var(--font-mono);font-size:.75rem;color:var(--t2)}
.rt-res{min-height:1.5em;margin-top:10px;font-size:.875rem}
.rule-row.scan{border-color:var(--b-strong);background:var(--hover)}
.rule-row.hit{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
```

(Цели `.rt-sugg button` высотой 28 px проходят WCAG 2.5.8 (≥ 24 px); это единственное допустимое исключение из правила 32 px, потому что чипы стоят плотным рядом и дублируют поле ввода.)

```js
/* ===== route tester ===== */
const GEO_DEMO={
'geosite:cn':q=>/\.cn$|(^|\.)(baidu|qq|bilibili|taobao)\.com$/.test(q),
'geosite:geolocation-!cn':q=>!/\.cn$|(^|\.)(baidu|qq|bilibili|taobao)\.com$/.test(q),
'category-ru-gov':q=>/(^|\.)gosuslugi\.ru$/.test(q),
'geosite:category-ads-all':q=>/(^|\.)(doubleclick\.net|ads\.[a-z.]+)$/.test(q),
};
function matchRoute(raw){
const q=raw.trim().toLowerCase().replace(/^https?:\/\//,'').split('/')[0];
const isIP=/^\d{1,3}(\.\d{1,3}){3}$/.test(q),isProc=/\.(exe|app)$/.test(q)||!q.includes('.');
const rules=activeRules();
for(let i=0;i<rules.length;i++){
const r=rules[i];
for(const v0 of r.values){
const v=String(v0).toLowerCase();
if(r.type==='process'){if(isProc&&(q===v||q===v.replace(/\.exe$/,'')))return {q,i,out:r.out,why:v0};continue;}
if(r.type==='domain'&&!isIP&&!isProc){
if(v==='*')return {q,i,out:r.out,why:'*'};
if(GEO_DEMO[v]){if(GEO_DEMO[v](q))return {q,i,out:r.out,why:v0};continue;}
if(q===v||q.endsWith('.'+v))return {q,i,out:r.out,why:v0};
}
if(r.type==='ip'&&isIP){
if(v==='geoip:private'&&/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(q))return {q,i,out:r.out,why:v0};
if(v==='geoip:ru'&&/^(5|31|46|77|78|79|81|83|85|87|88|89|91|92|93|94|95)\./.test(q))return {q,i,out:r.out,why:v0};
}
}
}
return {q,i:-1,out:S.defOut,why:''};
}
let rtToken=0;
function runRouteTest(){
const v=document.getElementById('rtQ').value;if(!v.trim())return;
const my=++rtToken,res=matchRoute(v),rows=[...document.querySelectorAll('#ruleList .rule-row')];
rows.forEach(r=>r.classList.remove('scan','hit'));
const out=document.getElementById('rtRes');out.textContent=t('rt.test.checking');
const finish=()=>{
if(my!==rtToken)return;
if(res.i>-1&&rows[res.i]){rows[res.i].classList.add('hit','open');rows[res.i].scrollIntoView({block:'nearest'});}
out.textContent=res.i>-1?tf('rt.test.result',{q:res.q,out:t('out.'+res.out),n:res.i+1,why:res.why}):tf('rt.test.resultDef',{q:res.q,out:t('out.'+res.out)});
};
if(matchMedia('(prefers-reduced-motion: reduce)').matches||res.i<0){finish();return;}
let k=0;(function step(){if(my!==rtToken)return;rows.forEach(r=>r.classList.remove('scan'));if(k>res.i){finish();return;}if(rows[k])rows[k].classList.add('scan');k++;setTimeout(step,110);})();
}
document.getElementById('rtGo').addEventListener('click',runRouteTest);
document.getElementById('rtQ').addEventListener('keydown',e=>{if(e.key==='Enter')runRouteTest();});
['lori.ru','chat.openai.com','store.steampowered.com','example.org','192.168.1.10','cursor.exe'].forEach(s=>{
const b=document.createElement('button');b.type='button';b.textContent=s;
b.addEventListener('click',()=>{document.getElementById('rtQ').value=s;runRouteTest();});
document.getElementById('rtSugg').appendChild(b);
});
```

Ожидаемые результаты при активном LAV Preset RU и исходе по умолчанию «Прокси» (правило рекламы добавлено последним, A10 п. 5):

| Ввод | Результат |
|---|---|
| `lori.ru` | Напрямую · правило 3 (`ru`) |
| `chat.openai.com` | Прокси · правило 1 (`openai.com`) |
| `store.steampowered.com` | Напрямую · правило 5 (`steampowered.com`) |
| `example.org` | Прокси · по умолчанию |
| `192.168.1.10` | Напрямую · правило 6 (`geoip:private`) |
| `cursor.exe` | Прокси · правило 2 (`cursor.exe`) |

---

## S10. Движение и фон (задача A20)

Разметка — первым дочерним элементом `<div id="body">`:

```html
<div id="bgField" aria-hidden="true" data-conn="off"><i class="bf-beam b1"></i><i class="bf-beam b2"></i><i class="bf-floor"></i><i class="bf-streak" id="bfStreak"></i><i class="bf-grain"></i></div>
```

```css
#body{position:relative}
#sidebar,#main{position:relative;z-index:1}
#bgField{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;--field:.45}
#bgField[data-conn="mid"]{--field:.95} #bgField[data-conn="on"]{--field:.75} #bgField[data-conn="err"]{--field:.3}
.bf-beam{position:absolute;left:-30%;width:160%;border-radius:50%;background:radial-gradient(closest-side,rgba(var(--ray-rgb),.14),rgba(var(--ray-rgb),0) 72%);
  opacity:var(--field);transition:opacity 900ms var(--ease)}
.bf-beam.b1{top:4%;height:34%;animation:bfDrift1 38s ease-in-out infinite alternate}
.bf-beam.b2{top:56%;height:22%;animation:bfDrift2 53s ease-in-out infinite alternate}
.bf-floor{position:absolute;inset:auto -20% -45% -20%;height:70%;background:radial-gradient(closest-side,rgba(var(--ray-rgb),.06),transparent);opacity:var(--field)}
.bf-grain{position:absolute;inset:0;opacity:.06;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .7 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.bf-streak{position:absolute;left:-40%;top:38%;width:36%;height:2px;transform:rotate(-16deg);background:linear-gradient(90deg,transparent,rgba(var(--ray-rgb),.7),transparent);opacity:0}
.bf-streak.run{animation:bfStreak 1.1s var(--e-in) forwards}
.bf-ripple{position:absolute;width:60px;height:60px;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%) scale(.3);
  background:radial-gradient(circle,transparent 58%,rgba(var(--ray-rgb),.3) 64%,transparent 71%);animation:bfRipple 1s var(--e-out) forwards}
@keyframes bfDrift1{from{transform:rotate(-16deg) translateX(-7%)}to{transform:rotate(-12deg) translateX(7%)}}
@keyframes bfDrift2{from{transform:rotate(-23deg) translateX(6%)}to{transform:rotate(-27deg) translateX(-8%)}}
@keyframes bfStreak{0%{opacity:0;left:-40%}20%{opacity:1}100%{opacity:0;left:110%}}
@keyframes bfRipple{to{transform:translate(-50%,-50%) scale(16);opacity:0}}
html[data-bg="off"] #bgField{display:none}
html[data-bg="quiet"] .bf-beam,html[data-bg="quiet"] .bf-floor,html[data-bg="quiet"] .bf-streak{display:none}
html.bg-paused #bgField *{animation-play-state:paused!important}
```

```js
/* ===== motion & background ===== */
const RM=matchMedia('(prefers-reduced-motion: reduce)');
function bgEffective(){if(RM.matches)return 'off';return S.bgAnim||(S.mode==='browser'?'off':'live');}
function applyBg(){document.documentElement.dataset.bg=bgEffective();document.querySelectorAll('[data-bg-btn]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.bgBtn===(S.bgAnim||bgEffective()))));}
try{RM.addEventListener('change',applyBg);}catch(e){}
document.addEventListener('visibilitychange',()=>document.documentElement.classList.toggle('bg-paused',document.hidden));
let lastStreak=0;
function fxStreak(){
if(bgEffective()!=='live'||Date.now()-lastStreak<4000)return;
lastStreak=Date.now();const s=document.getElementById('bfStreak');if(!s)return;
s.style.top=(18+Math.random()*50)+'%';s.classList.remove('run');void s.offsetWidth;s.classList.add('run');
}
function fxRipple(){
if(bgEffective()!=='live')return;
const body=document.getElementById('body'),ray=document.querySelector('#stateCard .ray');if(!ray||!ray.offsetParent)return;
const a=body.getBoundingClientRect(),b=ray.getBoundingClientRect(),r=document.createElement('i');
r.className='bf-ripple';r.style.left=(b.left-a.left+b.width/2)+'px';r.style.top=(b.top-a.top+b.height/2)+'px';
document.getElementById('bgField').appendChild(r);setTimeout(()=>r.remove(),1100);
}
```

Вызовы: в `tickTraffic` после расчёта `curDn` — `if(S.conn==='on'&&curDn>300e3)fxStreak();`; в `setConn`, в момент перехода в `'on'` — `fxRipple();`; `applyBg()` — в `applyMode()`, в `init` и при выборе в Настройках (`[data-bg-btn]`, ставит `S.bgAnim` и `save()`).

Диалог «растёт из кнопки» — добавить в `openDlg` перед `back.classList.add('open')`:

```js
const dlg=back.querySelector('.dlg'),tr=trigger||document.activeElement;
if(dlg&&tr&&tr.getBoundingClientRect&&!RM.matches){
const r=tr.getBoundingClientRect();
dlg.style.transformOrigin=Math.round(r.left+r.width/2-(innerWidth-dlg.offsetWidth)/2)+'px '+Math.round(r.top+r.height/2-(innerHeight-dlg.offsetHeight)/2)+'px';
}
```

`@keyframes dlgIn` v1.1 заменить на `from{opacity:0;transform:scale(.98)}`.

---

## S11. Встроенная самопроверка (задача A22)

Диалог:

```html
<div class="dlg-back" id="dlgA11y" role="dialog" aria-modal="true">
  <div class="dlg dlg-md">
    <div class="dlg-h"><h2 data-i18n="a11y.title">Проверка доступности</h2><button class="btn btn-ic btn-sm" data-close data-i18n-title="common.close" data-i18n-aria="common.close"><span class="ic ic-16" data-icon="x"></span></button></div>
    <div class="dlg-b"><p id="a11ySum" role="status"></p><ol id="a11yList" class="a11y-list"></ol></div>
  </div>
</div>
```

```css
.a11y-list{margin:10px 0 0;padding-inline-start:18px;display:flex;flex-direction:column;gap:8px;font-size:.8125rem}
.a11y-list code{font-family:var(--font-mono);font-size:.75rem;color:var(--t2);overflow-wrap:anywhere}
.a11y-hl{outline:3px solid var(--err)!important;outline-offset:2px!important}
```

```js
/* ===== a11y self-check ===== */
function runA11yCheck(){
const P=c=>{let m=c.match(/^rgba?\(([^)]+)\)$/);if(m){const p=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
m=c.match(/^color\(srgb ([^)]+)\)$/);if(m){const p=m[1].split(/[\s\/]+/).filter(Boolean).map(Number);return {r:p[0]*255,g:p[1]*255,b:p[2]*255,a:p.length>3?p[3]:1};}return null;};
const lin=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};
const L=c=>.2126*lin(c.r)+.7152*lin(c.g)+.0722*lin(c.b);
const ratio=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const blend=(t,b)=>({r:t.r*t.a+b.r*(1-t.a),g:t.g*t.a+b.g*(1-t.a),b:t.b*t.a+b.b*(1-t.a),a:1});
const vis=el=>{if(!el.getClientRects().length||el.closest('[inert],[hidden],[data-a11y-ignore]'))return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;};
const bgOf=el=>{const st=[];for(let n=el;n;n=n.parentElement){const c=P(getComputedStyle(n).backgroundColor);if(c&&c.a>0){st.push(c);if(c.a>=1)break;}}let b={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)b=blend(st[i],b);return b;};
const issues=[];
document.querySelectorAll('body *').forEach(el=>{
if(el instanceof SVGElement||['SCRIPT','STYLE','CANVAS','OPTION'].includes(el.tagName))return;
const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own||!vis(el))return;
const s=getComputedStyle(el),fg=P(s.color);if(!fg)return;
const bg=bgOf(el),r=ratio(blend(fg,bg),bg),fs=parseFloat(s.fontSize),big=fs>=24||(fs>=18.66&&parseInt(s.fontWeight)>=700),need=big?3:4.5;
if(r<need&&!el.closest(':disabled,[aria-disabled="true"]'))issues.push({el,k:'a11y.k.contrast',v:r.toFixed(2)+' < '+need});
});
document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=radio],[tabindex]:not([tabindex="-1"])').forEach(el=>{
if(!vis(el))return;const r=el.getBoundingClientRect();
const name=(el.getAttribute('aria-label')||el.innerText||'').trim()||(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(i=>(document.getElementById(i)||{}).textContent||'').join('').trim()||(el.id&&document.querySelector('label[for="'+el.id+'"]')?'label':'')||el.getAttribute('title')||'';
if(!name)issues.push({el,k:'a11y.k.name',v:''});
if((r.width<24||r.height<24)&&!(el.tagName==='A'&&el.closest('p,li')))issues.push({el,k:'a11y.k.target',v:Math.round(r.width)+'×'+Math.round(r.height)});
});
const sum=document.getElementById('a11ySum'),list=document.getElementById('a11yList');
sum.textContent=tf('a11y.sum',{n:issues.length});
list.innerHTML='';
issues.slice(0,40).forEach(it=>{
const li=document.createElement('li');
const sel=it.el.tagName.toLowerCase()+(it.el.id?'#'+it.el.id:'')+(it.el.classList.length?'.'+[...it.el.classList].slice(0,2).join('.'):'');
li.innerHTML='<b>'+esc(t(it.k))+'</b> '+esc(it.v)+' <code>'+esc(sel)+'</code> ';
const b=document.createElement('button');b.className='btn btn-ghost btn-sm';b.textContent=t('a11y.show');
b.addEventListener('click',()=>{closeDlg('dlgA11y');it.el.scrollIntoView({block:'center'});it.el.classList.add('a11y-hl');setTimeout(()=>it.el.classList.remove('a11y-hl'),2000);});
li.appendChild(b);list.appendChild(li);
});
openDlg('dlgA11y',document.getElementById('stA11y'));
}
```
