#!/usr/bin/env python3
"""Copia VUELO 40 al repo de Laura (landing-lauracortes) para lauramcortes.com/vuelo40.

El juego elige anfitrión por dominio en tiempo de ejecución; aquí solo se ajustan las
etiquetas que leen WhatsApp/Facebook sin JavaScript (canonical, Open Graph, noscript pixel).
Uso: python3 scripts/sync-vuelo40-laura.py ../landing-lauracortes
"""
import shutil, sys
from pathlib import Path

src = Path(__file__).resolve().parent.parent / 'vuelo40'
dst = Path(sys.argv[1] if len(sys.argv) > 1 else '../landing-lauracortes').resolve() / 'vuelo40'

shutil.copytree(src / 'assets', dst / 'assets', dirs_exist_ok=True)
for page in ('index.html', 'br/index.html'):   # br/: VOO 40 en portugués (scripts/build-vuelo40-br.py)
    out = []
    for line in (src / page).read_text(encoding='utf-8').splitlines(keepends=True):
        if line.lstrip().startswith(('<link rel="canonical"', '<meta ')):
            line = line.replace('https://camiloecortes.com/vuelo40', 'https://lauramcortes.com/vuelo40')
        if 'facebook.com/tr?id=3559974890833540' in line:
            line = line.replace('3559974890833540', '936449302360462')
        out.append(line)
    (dst / page).parent.mkdir(parents=True, exist_ok=True)
    (dst / page).write_text(''.join(out), encoding='utf-8')
print('VUELO 40 copiado a', dst)
