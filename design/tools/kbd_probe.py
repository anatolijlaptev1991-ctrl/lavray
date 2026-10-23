"""Keyboard and ARIA behaviour checks for design/prototype.html.

Each check prints PASS or FAIL with evidence. Exit code 0 = all pass.

Usage:
  python design/tools/kbd_probe.py [--proto path/to/prototype.html]

Requires: pip install playwright && python -m playwright install chromium
"""
import argparse, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DEFAULT_PROTO = HERE.parent / 'prototype.html'

FOCUS_JS = r"""() => {
  const el = document.activeElement;
  if (!el || el === document.body) return {tag: 'body', inDialog: false, inDrawer: false, inMenu: false};
  const st = getComputedStyle(el);
  const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase();
  const rgb = st.outlineColor.match(/\d+/g) || [];
  const ocHex = rgb.length >= 3 ? '#' + rgb.slice(0,3).map(v => (+v).toString(16).padStart(2,'0')).join('') : '';
  const ring = (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2 && ocHex === acc) || (st.boxShadow || '').includes(st.outlineColor) && st.outlineStyle !== 'none';
  return {ring, tag: el.tagName.toLowerCase(), id: el.id || '', cls: [...el.classList].slice(0,3).join('.'),
          role: el.getAttribute('role') || '', name: (el.getAttribute('aria-label') || el.innerText || el.placeholder || '').trim().slice(0,40),
          inDialog: !!el.closest('.dlg-back.open'), inDrawer: !!el.closest('#drawer'), inMenu: !!el.closest('[role=menu]'),
          isField: ['input','select','textarea'].includes(el.tagName.toLowerCase()),
          isPrimary: !!el.closest('.dlg-f') && el.classList.contains('btn-pri')};
}"""

RESULTS = []
def check(name, ok, evidence):
    RESULTS.append((name, bool(ok), evidence))
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {json.dumps(evidence, ensure_ascii=False)[:300]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--proto', default=str(DEFAULT_PROTO))
    a = ap.parse_args()
    url = Path(a.proto).resolve().as_uri()
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url + '#lang=ru&theme=dark&mode=native&screen=connection&freeze=1'); page.wait_for_timeout(400)
        F = lambda: page.evaluate(FOCUS_JS)
        def tabs(n):
            seq = []
            for _ in range(n):
                page.keyboard.press('Tab'); seq.append(F())
            return seq

        # 1. every dialog has an accessible name
        named = page.evaluate("""() => [...document.querySelectorAll('[role=dialog]')].map(d => {
            const ids = (d.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
            const txt = ids.map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim() || (d.getAttribute('aria-label') || '').trim();
            return {id: d.id || (d.parentElement && d.parentElement.id), name: txt.slice(0, 40)}; })""")
        check('dialogs-named', all(x['name'] for x in named), [x for x in named if not x['name']] or len(named))

        # 2. window caption buttons are not in the Tab order; 3. closed drawer is not focusable
        page.evaluate("document.activeElement && document.activeElement.blur()")
        seq = tabs(60)
        caption = [s for s in seq if s.get('id') in ('wbMin', 'wbMax', 'wbClose') or 'cap-btn' in s.get('cls', '')]
        check('window-buttons-not-tabbable', not caption, caption[:3])
        check('closed-drawer-unfocusable', not any(s['inDrawer'] for s in seq), [s for s in seq if s['inDrawer']][:3])
        noring = [s for s in seq if s['tag'] != 'body' and not s.get('ring')]
        check('focus-ring-accent-2px', not noring, [(s.get('id') or s.get('cls'), s.get('name')) for s in noring][:6])

        # 4-6. Import dialog: initial focus in a field, focus stays inside, Esc returns focus to the trigger
        trig = page.evaluate("""() => { const b = document.getElementById('profImportBtn') || document.getElementById('qaImport');
            if (!b) return null; try { switchScreen('profiles'); } catch(e) {} b.focus(); return b.id; }""")
        if trig:
            page.keyboard.press('Enter'); page.wait_for_timeout(250)
            first = F()
            check('import-initial-focus-in-field', first.get('isField') and first.get('inDialog'), first)
            seq = tabs(30)
            leaked = [s for s in seq if not s['inDialog'] and s['tag'] != 'body']
            check('modal-focus-trap', not leaked, leaked[:3])
            tablist = page.evaluate("""() => { const d = document.querySelector('.dlg-back.open'); if (!d) return null;
                const tl = d.querySelector('[role=tablist]'); const sel = d.querySelectorAll('[role=tab][aria-selected=true]');
                return {tablist: !!tl, selected: sel.length, tabs: d.querySelectorAll('[role=tab]').length}; }""")
            check('import-tabs-aria', tablist and tablist['tablist'] and tablist['selected'] == 1 and tablist['tabs'] >= 2, tablist)
            page.keyboard.press('Escape'); page.wait_for_timeout(250)
            after = F()
            closed = page.evaluate("!document.querySelector('.dlg-back.open')")
            check('escape-closes-and-returns-focus', closed and after.get('id') == trig, {'closed': closed, 'focus': after, 'trigger': trig})
        else:
            check('import-trigger-exists', False, 'no #profImportBtn / #qaImport')

        # 7. editor: initial focus is not the primary button
        page.evaluate("try { openEditor(null); } catch(e) {}"); page.wait_for_timeout(250)
        ed = F()
        check('editor-initial-focus-not-primary', ed.get('inDialog') and not ed.get('isPrimary'), ed)
        page.keyboard.press('Escape'); page.wait_for_timeout(200)

        # 8-9. row menu: opens with focus on first item, arrows move, Esc returns focus; Shift+F10 on a row opens it
        page.evaluate("try { switchScreen('profiles'); } catch(e) {}"); page.wait_for_timeout(150)
        has_btn = page.evaluate("(() => { const b = document.querySelector('[data-menu-p]'); if (!b) return false; b.focus(); return true; })()")
        if has_btn:
            page.keyboard.press('Enter'); page.wait_for_timeout(150)
            m1 = F()
            page.keyboard.press('ArrowDown'); page.wait_for_timeout(60)
            m2 = F()
            page.keyboard.press('Escape'); page.wait_for_timeout(150)
            m3 = F()
            check('menu-focus-first-item', m1.get('inMenu') and m1.get('role') == 'menuitem', m1)
            check('menu-arrow-moves', m2.get('inMenu') and m2.get('name') != m1.get('name'), {'before': m1.get('name'), 'after': m2.get('name')})
            check('menu-escape-returns-focus', not m3.get('inMenu') and 'data-menu-p' not in str(m3) and m3.get('tag') == 'button', m3)
        row = page.evaluate("(() => { const r = document.querySelector('.prow'); if (!r) return false; r.focus(); return true; })()")
        if row:
            page.keyboard.press('Shift+F10'); page.wait_for_timeout(150)
            check('row-context-menu-key', page.evaluate("!!document.querySelector('[role=menu]')"), 'Shift+F10 on .prow')
            page.keyboard.press('Escape')

        # 10. exactly one live region announces the connection state
        page.evaluate("try { switchScreen('connection'); } catch(e) {}"); page.wait_for_timeout(150)
        live = page.evaluate("""() => [...document.querySelectorAll('[role=status],[aria-live]')]
            .filter(e => e.id !== 'toasts' && !e.closest('#toasts') && e.offsetParent !== null && /Отключено|Подключ/.test(e.textContent))
            .map(e => e.id || e.className)""")
        check('single-connection-live-region', len(live) <= 1, live)

        # 11. reduced motion: no infinite animations while connected
        page.evaluate("try { switchScreen('connection'); setConn('on'); } catch(e) {}"); page.wait_for_timeout(400)
        infinite = page.evaluate("document.getAnimations().filter(a => a.effect && a.effect.getTiming().iterations === Infinity).length")
        check('reduced-motion-no-infinite-animations', infinite == 0, infinite)

        # 12. forced-colors support present in CSS
        fc = page.evaluate("""() => { let n = 0; for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (r.media && /forced-colors/.test(r.media.mediaText)) n++; } catch(e) {} } return n; }""")
        check('forced-colors-rules', fc > 0, fc)

        # 13. browser mode: skip link is the first Tab stop
        page.evaluate("S.mode='browser'; applyMode(); try { switchScreen('connection'); } catch(e) {}")
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press('Tab')
        sk = F()
        check('browser-skip-link-first', sk.get('tag') == 'a' and 'skip' in sk.get('cls', ''), sk)

        # 14. phone width: navigation stays reachable and the page does not scroll sideways
        page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(200)
        nav = page.evaluate("""() => { const items = [...document.querySelectorAll('.sb-item')].filter(b => b.offsetParent !== null);
            const vis = items.filter(b => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0; });
            return {visible: vis.length, total: items.length, sw: document.documentElement.scrollWidth, iw: innerWidth}; }""")
        check('phone-nav-reachable', nav['visible'] >= 4 and nav['sw'] <= nav['iw'] + 1, nav)

        check('no-page-errors', not errors, errors[:3])
        b.close()
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
