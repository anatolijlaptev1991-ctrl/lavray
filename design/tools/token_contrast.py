"""Checks WCAG contrast of every required design-token pair in design/prototype.html.

Reads the CSS custom properties from the theme blocks
  html[data-theme="dark"|"light"]{...}
  html[data-accent="sage"|"graphite"]{...}
  html[data-accent="sage"|"graphite"][data-theme="light"]{...}
and verifies, for both themes and every accent (amber, sage, graphite):
  text (t1, t2, t3) and status text (*-text) on bg / surface / surface2 / hover  >= 4.5
  accent as text on bg / surface / surface2 / accent-soft                       >= 4.5
  button text: accent-contrast on accent, err-contrast on err                   >= 4.5
  control borders: b-control on bg / surface / surface2                          >= 3.0
  focus ring: accent on bg                                                        >= 3.0

Usage: python design/tools/token_contrast.py [--proto path]   (exit 1 on any failure)
"""
import argparse, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def parse_color(v):
    v = v.strip()
    m = re.fullmatch(r'#([0-9a-fA-F]{6})', v)
    if m:
        h = m.group(1)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    m = re.fullmatch(r'rgba?\(([^)]+)\)', v)
    if m:
        p = [x.strip() for x in m.group(1).split(',')]
        return (float(p[0]), float(p[1]), float(p[2]), float(p[3]) if len(p) > 3 else 1.0)
    return None


def blend(top, bot):
    a = top[3]
    return tuple(top[i] * a + bot[i] * (1 - a) for i in range(3)) + (1.0,)


def lum(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def ratio(a, b):
    x, y = lum(a), lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def block(css, selector):
    m = re.search(re.escape(selector) + r'\s*\{([^}]*)\}', css)
    if not m:
        return {}
    return {k.strip(): v.strip() for k, v in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', m.group(1))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--proto', default=str(HERE.parent / 'prototype.html'))
    css = Path(ap.parse_args().proto).read_text(encoding='utf-8')
    failures = 0
    for theme in ('dark', 'light'):
        base = block(css, f'html[data-theme="{theme}"]')
        for accent in ('amber', 'sage', 'graphite'):
            tok = dict(base)
            if accent != 'amber':
                tok.update(block(css, f'html[data-accent="{accent}"]'))
                if theme == 'light':
                    tok.update(block(css, f'html[data-accent="{accent}"][data-theme="light"]'))
            col = {k: parse_color(v) for k, v in tok.items() if parse_color(v)}
            need = lambda *names: [n for n in names if n not in col]
            missing = need('--bg', '--surface', '--surface2', '--hover', '--t1', '--t2', '--t3', '--accent', '--accent-contrast', '--accent-soft', '--b-control')
            if missing:
                print(f'FAIL {theme}/{accent}: missing tokens {missing}')
                failures += 1
                continue
            soft = blend(col['--accent-soft'], col['--surface'])
            bgs = {'bg': col['--bg'], 'surface': col['--surface'], 'surface2': col['--surface2'], 'hover': col['--hover']}
            pairs = []
            for t in ('--t1', '--t2', '--t3', '--ok-text', '--warn-text', '--err-text', '--info-text'):
                if t in col:
                    for bn, bc in bgs.items():
                        pairs.append((f'{t} on {bn}', ratio(col[t], bc), 4.5))
            for bn in ('bg', 'surface', 'surface2'):
                pairs.append((f'--accent text on {bn}', ratio(col['--accent'], bgs[bn]), 4.5))
                pairs.append((f'--b-control on {bn}', ratio(col['--b-control'], bgs[bn]), 3.0))
            pairs.append(('--accent text on accent-soft', ratio(col['--accent'], soft), 4.5))
            pairs.append(('--accent-contrast on --accent (button)', ratio(col['--accent-contrast'], col['--accent']), 4.5))
            if '--err' in col and '--err-contrast' in col:
                pairs.append(('--err-contrast on --err (danger button)', ratio(col['--err-contrast'], col['--err']), 4.5))
            pairs.append(('focus ring --accent on bg', ratio(col['--accent'], col['--bg']), 3.0))
            bad = [(n, round(r, 2), th) for n, r, th in pairs if r < th]
            failures += len(bad)
            print(f"{'PASS' if not bad else 'FAIL'} {theme}/{accent}: {len(pairs)} pairs" + ''.join(f'\n     {n}: {r} < {th}' for n, r, th in bad))
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
