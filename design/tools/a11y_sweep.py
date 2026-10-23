"""Automated accessibility / i18n / layout sweep of design/prototype.html.

Walks every screen and dialog of the prototype in every language x theme x mode
(x OS when the prototype exposes applyOS) and measures, for each visible element:
  * text contrast against the real composited background (WCAG 2.x formula);
  * text clipped by ellipsis or by an overflow:hidden ancestor;
  * labels wrapped onto several lines inside compact controls;
  * interactive targets smaller than 24x24 px (WCAG 2.5.8) and 32x32 px (DS §12);
  * interactive elements without an accessible name;
  * Cyrillic text leaking into non-Russian locales, CJK leaking into non-Chinese ones;
  * horizontal overflow of the page at small viewports (browser mode).

Usage:
  python design/tools/a11y_sweep.py                 # full sweep, writes design/tools/out/
  python design/tools/a11y_sweep.py --quick         # ru+de, both themes, native only
  python design/tools/a11y_sweep.py --proto other.html --out some/dir

Requires: pip install playwright && python -m playwright install chromium
Exit code 0 = all thresholds pass, 1 = at least one threshold failed.
"""
import argparse, collections, json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DEFAULT_PROTO = HERE.parent / 'prototype.html'

# Thresholds checked at the end. Every listed category must be at or below the value.
THRESHOLDS = {
    'contrast': 0,        # text below 4.5:1 (3:1 for large text), disabled controls excluded
    'names': 0,           # interactive elements without an accessible name
    'targets<24': 0,      # WCAG 2.5.8 minimum (inline text links inside paragraphs excluded)
    'clip': 0,            # text pushed outside an overflow:hidden ancestor
    'foreign': 0,         # Cyrillic in en/zh/es/de, CJK in ru/en/es/de (language names excluded)
    'cjk-style': 0,       # letter-spacing / uppercase / italic on Chinese text
    'phone-overflow': 0,  # horizontal page overflow at 390 px in browser mode
}
# Elements allowed to truncate with an ellipsis by design (long user data: hosts, URLs, rule values).
ELLIPSIS_ALLOW = ('.p-addr', '.sub-url', '.rule-val', '.kv-v', '.menu-head', '.mono', '.ct-host', '.srv-addr')

CHECK_JS = r"""
(ctx) => {
  const out = {contrast:[], ellipsis:[], clip:[], wrap:[], targets:[], names:[], foreign:[], cjk:[], doc:null};
  const P = (c) => {
    if (!c) return null;
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
    m = c.match(/^color\(srgb ([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s\/]+/).filter(Boolean).map(Number); return {r:p[0]*255,g:p[1]*255,b:p[2]*255,a:p.length>3?p[3]:1}; }
    return null;
  };
  const lin = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
  const L = c => 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
  const ratio = (a,b) => { const x=L(a), y=L(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
  const blend = (top, bot) => { const a = top.a; return {r: top.r*a+bot.r*(1-a), g: top.g*a+bot.g*(1-a), b: top.b*a+bot.b*(1-a), a:1}; };
  const hex = c => '#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  const isVis = (el) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false;
      if (n.inert) return false;
    }
    return true;
  };
  const cumOpacity = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const stack = []; let img = false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') img = true;
      const c = P(s.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = {r:255,g:255,b:255,a:1};
    for (let i = stack.length-1; i >= 0; i--) base = blend(stack[i], base);
    return {bg: base, img};
  };
  const path = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { s += '#'+n.id; parts.unshift(s); break; }
      const cls = [...n.classList].slice(0,2).join('.');
      if (cls) s += '.'+cls;
      parts.unshift(s);
    }
    return parts.join('>');
  };
  const ownText = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g,' ').trim();
  const langNames = el => el.closest('#langSel,#setLang,.onb-lang,[data-lang-native],option');
  for (const el of document.querySelectorAll('body *')) {
    if (el instanceof SVGElement || ['SCRIPT','STYLE','CANVAS','OPTION'].includes(el.tagName)) continue;
    const txt = ownText(el);
    if (!txt || !isVis(el)) continue;
    const s = getComputedStyle(el);
    const fg0 = P(s.color); if (!fg0) continue;
    const {bg, img} = bgOf(el);
    const fg = blend({...fg0, a: fg0.a*cumOpacity(el)}, bg);
    const r = ratio(fg, bg);
    const fs = parseFloat(s.fontSize), fw = parseInt(s.fontWeight)||400;
    const need = (fs >= 24 || (fs >= 18.66 && fw >= 700)) ? 3 : 4.5;
    const disabled = !!el.closest('button:disabled,[aria-disabled="true"],input:disabled,select:disabled');
    if (r < need && !disabled && !el.closest('[data-a11y-ignore]')) out.contrast.push({t: txt.slice(0,48), r: +r.toFixed(2), need, fg: hex(fg), bg: hex(bg), fs, img, p: path(el)});
    if (el.scrollWidth > el.clientWidth + 1 && (s.textOverflow === 'ellipsis' || s.overflowX === 'hidden' || s.overflowX === 'clip')) {
      out.ellipsis.push({t: txt.slice(0,60), sw: el.scrollWidth, cw: el.clientWidth, p: path(el), allowed: !!el.closest(ctx.allow)});
    }
    const er = el.getBoundingClientRect();
    for (let a = el.parentElement, k = 0; a && k < 6; a = a.parentElement, k++) {
      const as = getComputedStyle(a);
      if (as.overflowX === 'hidden' || as.overflowX === 'clip' || as.overflow === 'hidden') {
        const ar = a.getBoundingClientRect();
        if ((er.right > ar.right + 2 || er.left < ar.left - 2) && s.textOverflow !== 'ellipsis') out.clip.push({t: txt.slice(0,60), by: path(a), over: Math.round(Math.max(er.right-ar.right, ar.left-er.left)), p: path(el)});
        break;
      }
    }
    const ctl = el.closest('button,.chip,.badge,.seg,.tab,.subtab,.sb-item,[role=tab],th');
    if (ctl) {
      const rng = document.createRange(); rng.selectNodeContents(el);
      const tops = new Set([...rng.getClientRects()].map(q => Math.round(q.top)));
      if (tops.size > 1) out.wrap.push({t: txt.slice(0,60), lines: tops.size, ctl: path(ctl)});
    }
    if (ctx.lang !== 'ru' && /[Ѐ-ӿ]/.test(txt) && !langNames(el)) out.foreign.push({kind:'cyrillic', t: txt.slice(0,60), p: path(el)});
    if (ctx.lang !== 'zh' && /[一-鿿]/.test(txt) && !langNames(el)) out.foreign.push({kind:'cjk', t: txt.slice(0,60), p: path(el)});
    if (ctx.lang === 'zh' && /[一-鿿]/.test(txt)) {
      if (s.letterSpacing !== 'normal' && parseFloat(s.letterSpacing) !== 0) out.cjk.push({issue:'letter-spacing '+s.letterSpacing, t: txt.slice(0,30), p: path(el)});
      if (s.textTransform === 'uppercase') out.cjk.push({issue:'uppercase', t: txt.slice(0,30), p: path(el)});
      if (s.fontStyle === 'italic') out.cjk.push({issue:'italic', t: txt.slice(0,30), p: path(el)});
    }
  }
  const sel = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=menuitem],[role=radio],[role=checkbox],[tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(sel)) {
    if (!isVis(el)) continue;
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    let name = (el.getAttribute('aria-label') || '').trim();
    if (!name && el.getAttribute('aria-labelledby')) name = el.getAttribute('aria-labelledby').split(/\s+/).map(id => (document.getElementById(id)||{}).textContent||'').join(' ').trim();
    if (!name) name = (el.innerText || '').trim();
    if (!name && el.id) { const l = document.querySelector('label[for="'+el.id+'"]'); if (l) name = l.innerText.trim(); }
    if (!name && el.closest('label')) name = el.closest('label').innerText.trim();
    if (!name) name = (el.getAttribute('title') || '').trim();
    const desc = el.tagName.toLowerCase() + (el.getAttribute('role') ? '[role='+el.getAttribute('role')+']' : '') + ' ' + path(el);
    if (!name) out.names.push({p: desc, w, h});
    const inlineLink = el.tagName === 'A' && el.closest('p,li,.set-d,.hint,.cap');
    if ((w < 24 || h < 24) && !inlineLink) out.targets.push({lvl:'<24', w, h, name: name.slice(0,30), p: desc});
    else if ((w < 32 || h < 32) && !inlineLink) out.targets.push({lvl:'<32', w, h, name: name.slice(0,30), p: desc});
  }
  out.doc = {sw: document.documentElement.scrollWidth, iw: innerWidth};
  return out;
}
"""

SET_STATE_JS = """([lang,theme,mode,os,screen]) => {
  try { closeMenus(); } catch(e) {}
  document.querySelectorAll('.dlg-back.open').forEach(d => { try { closeDlg(d.id); } catch(e) { d.classList.remove('open'); } });
  try { closeDrawer(); } catch(e) {}
  applyLang(lang); setTheme(theme);
  S.mode = mode; applyMode();
  if (os && typeof applyOS === 'function') applyOS(os);
  switchScreen(screen);
}"""

DISCOVER_JS = """() => ({
  screens: [...document.querySelectorAll('section.screen[id^="scr-"]')].map(s => s.id.slice(4)),
  dialogs: [...document.querySelectorAll('.dlg-back[id]')].map(d => d.id),
  hasOS: typeof applyOS === 'function',
  hasDrawer: typeof openDrawer === 'function' && typeof PROFILES !== 'undefined' && PROFILES.length > 0,
})"""

OPEN_DIALOG_JS = """(id) => {
  if (id === 'drawer') { openDrawer(PROFILES[0]); return; }
  if (id === 'dlgEditor' && typeof openEditor === 'function') { openEditor(null); return; }
  if (id === 'dlgOnb' && typeof openOnboarding === 'function') { openOnboarding(); return; }
  if (id === 'dlgQr' && typeof openQr === 'function') { openQr(PROFILES[0]); return; }
  openDlg(id);
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--proto', default=str(DEFAULT_PROTO))
    ap.add_argument('--out', default=str(HERE / 'out'))
    ap.add_argument('--quick', action='store_true', help='ru+de, both themes, native only, no OS variants')
    a = ap.parse_args()
    out = Path(a.out); (out / 'shots').mkdir(parents=True, exist_ok=True)
    url = Path(a.proto).resolve().as_uri()
    langs = ['ru', 'de'] if a.quick else ['ru', 'en', 'zh', 'es', 'de']
    themes = ['dark', 'light']
    modes = ['native'] if a.quick else ['native', 'browser']
    states = {}
    console = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
        page = ctx.new_page()
        page.on('console', lambda m: console.append(m.type + ': ' + m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: console.append('pageerror: ' + str(e)))
        page.goto(url + '#freeze=1'); page.wait_for_timeout(400)
        info = page.evaluate(DISCOVER_JS)
        oses = ['win', 'mac', 'linux'] if (info['hasOS'] and not a.quick) else [None]
        dialogs = info['dialogs'] + (['drawer'] if info['hasDrawer'] else [])
        for lang in langs:
            for theme in themes:
                for mode in modes:
                    for os_ in oses:
                        if mode == 'browser' and os_ not in (None, 'win'):
                            continue
                        tag = f'{lang}-{theme}-{mode}' + (f'-{os_}' if os_ else '')
                        for scr in info['screens']:
                            page.evaluate(SET_STATE_JS, [lang, theme, mode, os_, scr]); page.wait_for_timeout(40)
                            states[f'{tag}-{scr}'] = page.evaluate(CHECK_JS, {'lang': lang, 'allow': ','.join(ELLIPSIS_ALLOW)})
                        if mode == 'native' and os_ in (None, 'win'):
                            for d in dialogs:
                                page.evaluate(SET_STATE_JS, [lang, theme, mode, os_, info['screens'][0]])
                                page.evaluate(OPEN_DIALOG_JS, d); page.wait_for_timeout(80)
                                states[f'{tag}-dlg:{d}'] = page.evaluate(CHECK_JS, {'lang': lang, 'allow': ','.join(ELLIPSIS_ALLOW)})
        for scr in info['screens']:
            page.evaluate(SET_STATE_JS, ['ru', 'dark', 'native', None, scr]); page.wait_for_timeout(60)
            page.screenshot(path=str(out / 'shots' / f'ru-dark-native-{scr}.png'))
        for (w, h, tag) in [(390, 844, 'phone'), (768, 1024, 'tablet')]:
            page.set_viewport_size({'width': w, 'height': h})
            for scr in info['screens']:
                page.evaluate(SET_STATE_JS, ['de', 'light', 'browser', None, scr]); page.wait_for_timeout(60)
                states[f'vp-{tag}-de-light-browser-{scr}'] = page.evaluate(CHECK_JS, {'lang': 'de', 'allow': ','.join(ELLIPSIS_ALLOW)})
            page.evaluate(SET_STATE_JS, ['ru', 'dark', 'browser', None, info['screens'][0]]); page.wait_for_timeout(60)
            page.screenshot(path=str(out / 'shots' / f'vp-{tag}-ru-dark-browser.png'))
        b.close()

    summary = collections.OrderedDict()
    def collect(kind, keyf, filt=lambda k, it: True, fmt=lambda it: it):
        uniq = collections.OrderedDict()
        for k, v in states.items():
            for it in v[kind]:
                if not filt(k, it):
                    continue
                kk = keyf(it)
                uniq.setdefault(kk, {'example': fmt(it), 'states': []})['states'].append(k)
        return uniq
    summary['contrast'] = collect('contrast', lambda i: (i['p'], i['fg'], i['bg']), lambda k, i: not k.startswith('vp-'))
    summary['names'] = collect('names', lambda i: i['p'])
    summary['targets<24'] = collect('targets', lambda i: (i['p'], i['lvl']), lambda k, i: i['lvl'] == '<24')
    summary['targets<32'] = collect('targets', lambda i: (i['p'], i['lvl']), lambda k, i: i['lvl'] == '<32')
    summary['ellipsis'] = collect('ellipsis', lambda i: (i['p'], i['t']), lambda k, i: not i['allowed'])
    summary['clip'] = collect('clip', lambda i: (i['p'], i['t']))
    summary['wrap'] = collect('wrap', lambda i: (i['ctl'], i['t']))
    summary['foreign'] = collect('foreign', lambda i: (i['kind'], i['t']), lambda k, i: i['kind'] != 'latin-in-zh')
    summary['cjk-style'] = collect('cjk', lambda i: (i['issue'], i['p']))
    phone = {k: v['doc'] for k, v in states.items() if k.startswith('vp-phone') and v['doc']['sw'] > v['doc']['iw'] + 1}
    report = {'states': len(states), 'console_errors': console, 'phone-overflow': phone,
              'categories': {k: [{'n': len(x['states']), **x['example'], 'first_state': x['states'][0]} for x in v.values()] for k, v in summary.items()}}
    (out / 'a11y_sweep.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')

    failed = False
    print(f"states checked: {len(states)}; console errors: {len(console)}")
    for cat, items in summary.items():
        limit = THRESHOLDS.get(cat)
        status = '' if limit is None else ('PASS' if len(items) <= limit else 'FAIL')
        failed |= status == 'FAIL'
        print(f"{cat:15} unique={len(items):4} {status}")
        for it in list(items.values())[:8]:
            print('    ', json.dumps(it['example'], ensure_ascii=False)[:180])
    po = 'PASS' if len(phone) <= THRESHOLDS['phone-overflow'] else 'FAIL'
    failed |= po == 'FAIL'
    print(f"phone-overflow  states={len(phone):3} {po}")
    if console:
        failed = True
        print('console errors:', console[:5])
    print('details:', out / 'a11y_sweep.json')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
