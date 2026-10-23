"""Consistency checks for the I18N dictionaries of design/prototype.html.

  * every language has exactly the same keys as ru;
  * placeholders {x} are identical across languages for each key;
  * no empty values; no Cyrillic outside ru, no CJK outside zh (language names and brand names excepted);
  * keys used in markup (data-i18n*, t('…'), tf('…')) exist; keys defined but never used are listed;
  * plural helpers give the expected Russian forms for n = 0, 1, 2, 5, 11, 21, 22, 25.

Usage: python design/tools/i18n_check.py [--proto path]   (exit 1 on any error; unused keys are warnings)
"""
import argparse, json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ALLOW_FOREIGN = {'Русский', '简体中文', 'English', 'Español', 'Deutsch'}
NOT_KEYS = {'dns.google'}  # string literals in code that look like keys but are host names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--proto', default=str(HERE.parent / 'prototype.html'))
    path = Path(ap.parse_args().proto).resolve()
    src = path.read_text(encoding='utf-8')
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page()
        page.goto(path.as_uri() + '#freeze=1')
        page.wait_for_timeout(300)
        dic = page.evaluate('() => I18N')
        plural = page.evaluate("""() => {
          const out = {};
          const fn = (typeof plural === 'function') ? (n => plural('pl.p', n)) : (typeof pluralP === 'function' ? pluralP : null);
          if (!fn) return null;
          const save = S.lang; S.lang = 'ru';
          for (const n of [0,1,2,5,11,21,22,25]) out[n] = fn(n);
          S.lang = save; return out; }""")
        b.close()
    errors, warns = [], []
    langs = list(dic.keys())
    # Plural forms live in keys "<base>.one|few|many|other" (see docs/fix-plan/03-i18n.md, F2):
    # ru needs one/few/many, en/es/de need one/other, zh needs other. They are exempt from strict key parity.
    need_cats = {'ru': {'one', 'few', 'many'}, 'en': {'one', 'other'}, 'es': {'one', 'other'}, 'de': {'one', 'other'}, 'zh': {'other'}}
    is_pl = lambda k: k.startswith('pl.')
    base = {k for k in dic['ru'] if not is_pl(k)}
    for lang in langs:
        keys = {k for k in dic[lang] if not is_pl(k)}
        miss, extra = sorted(base - keys), sorted(keys - base)
        if miss: errors.append(f'{lang}: missing {len(miss)} keys: {miss[:12]}')
        if extra: errors.append(f'{lang}: extra {len(extra)} keys: {extra[:12]}')
        for k, v in dic[lang].items():
            s = str(v)
            if not s.strip(): errors.append(f'{lang}.{k}: empty value')
            s_chk = s.replace('.рф', '')
            if lang != 'ru' and re.search(r'[Ѐ-ӿ]', s_chk) and s not in ALLOW_FOREIGN: errors.append(f'{lang}.{k}: Cyrillic in value: {s[:50]}')
            if lang != 'zh' and re.search(r'[一-鿿]', s) and s not in ALLOW_FOREIGN: errors.append(f'{lang}.{k}: CJK in value: {s[:50]}')
    pl_bases = sorted({k.rsplit('.', 1)[0] for lang in langs for k in dic[lang] if is_pl(k) and k.rsplit('.', 1)[-1] in ('one', 'few', 'many', 'other')})
    for pb in pl_bases:
        for lang in langs:
            have = {k.rsplit('.', 1)[-1] for k in dic[lang] if k.startswith(pb + '.')}
            lack = need_cats.get(lang, {'other'}) - have
            if lack: errors.append(f'{lang}: plural {pb} lacks forms {sorted(lack)}')
    ph = lambda s: sorted(set(re.findall(r'\{(\w+)\}', str(s))))
    for k in base:
        ref = ph(dic['ru'][k])
        for lang in langs:
            if k in dic[lang] and ph(dic[lang][k]) != ref:
                errors.append(f'{lang}.{k}: placeholders {ph(dic[lang][k])} != ru {ref}')
    code = re.sub(r'const I18N\s*=\s*\{.*?\n\};', '', src, flags=re.S)
    used = set(re.findall(r'data-i18n(?:-aria|-title|-ph)?="([^"]+)"', code))
    used |= set(re.findall(r"['\"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9!-]+)+)['\"]", code))
    dyn_prefixes = ('city.', 'geo.', 'tag.', 'dns.', 'out.', 'rt.type.', 'theme.', 'accent.', 'conn.state.', 'upd.stage.', 'log.m', 'rule.n',
                    'preset.', 'mode.', 'gw.', 'chk.', 'leak.', 'st.', 'a11y.k.', 'bg.', 'dens.', 'test.', 'filter.', 'menu.', 'scr.', 'nav.', 'tab.', 'sub.err.')
    used -= NOT_KEYS
    missing_used = sorted(k for k in used if k not in base and not is_pl(k) and k.split('.')[0] in {x.split('.')[0] for x in base} and not k.endswith('.') and not re.search(r'\.(html|md|js|css|svg|png|com|net|org|io|ru|exe|json)$', k))
    if missing_used: errors.append(f'keys used in code but absent in ru: {missing_used[:20]}')
    unused = sorted(k for k in base if k not in used and not k.startswith(dyn_prefixes))
    if unused: warns.append(f'possibly unused keys ({len(unused)}): {unused[:30]}')
    if plural is None:
        errors.append('no plural helper found (plural(key,n) or pluralP)')
    else:
        exp = {'0': 'профилей', '1': 'профиль', '2': 'профиля', '5': 'профилей', '11': 'профилей', '21': 'профиль', '22': 'профиля', '25': 'профилей'}
        for n, word in exp.items():
            if word not in plural[n]: errors.append(f'ru plural n={n}: got "{plural[n]}", expected word "{word}"')
    for e in errors: print('ERROR', e)
    for w in warns: print('WARN ', w)
    print(f"languages: {langs}; keys in ru: {len(base)}; errors: {len(errors)}; warnings: {len(warns)}")
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
