#!/usr/bin/env python3
"""Gera a Plus Jakarta Sans servida pelo site: subconjunto pt-BR e eixo de peso 400–800.

Uso (da raiz do repositório):
    pip install fonttools brotli --break-system-packages
    python3 testes/fontes/subconjunto.py           # grava assets/fonts/plus-jakarta-sans-latin-wght.woff2
    python3 testes/fontes/subconjunto.py --checar  # só confere se o arquivo servido está atualizado

Fonte de origem: testes/fontes/original/plus-jakarta-sans-latin-wght.woff2 (subconjunto "latin" de
Plus Jakarta Sans v2.071, licença OFL em assets/fonts/). O resultado mantém os mesmos desenhos:
- caracteres: ASCII + letras do português + os símbolos que o site usa (lista UNICODES abaixo);
  o que ficar de fora (ex.: "ñ" num nome digitado no chat) cai na fonte do sistema;
- eixo wght limitado a 400–800 (os pesos de --peso-normal a --peso-extra em tokens.css);
- sem hinting (a fonte original não tem instruções de hinting úteis em telas modernas).

Mudou a lista? Atualize também o unicode-range do @font-face em assets/css/tokens.css
(o teste testes/funcoes/fontes.test.mjs compara os dois e trava o peso máximo).
"""
import hashlib
import os
import pathlib
import subprocess
import sys
import tempfile

RAIZ = pathlib.Path(__file__).resolve().parents[2]
ORIGEM = RAIZ / 'testes/fontes/original/plus-jakarta-sans-latin-wght.woff2'
DESTINO = RAIZ / 'assets/fonts/plus-jakarta-sans-latin-wght.woff2'

# Mesma lista do unicode-range em assets/css/tokens.css.
UNICODES = (
    'U+0020-007E,'          # ASCII imprimível
    'U+00A0,U+00A7,U+00A9-00AB,U+00AE,U+00B0,U+00B7,U+00BA-00BB,'  # espaço fixo, § © ª « ® ° · º »
    'U+00C0-00C3,U+00C7,U+00C9-00CA,U+00CD,U+00D3-00D5,U+00DA,U+00DC,'  # À Á Â Ã Ç É Ê Í Ó Ô Õ Ú Ü
    'U+00E0-00E3,U+00E7,U+00E9-00EA,U+00ED,U+00F3-00F5,U+00FA,U+00FC,'  # à á â ã ç é ê í ó ô õ ú ü
    'U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+2026,'  # – — ‘ ’ “ ” • …
    'U+20AC,U+2212'         # € −
)
PESO = 'wght=400:800'
RECURSOS = 'kern,mark,mkmk,ccmp,liga,calt,locl,tnum,pnum'


def gerar(saida: pathlib.Path) -> None:
    # Data fixa no cabeçalho da fonte: o mesmo comando gera sempre os mesmos bytes (--checar).
    ambiente = {**os.environ, 'SOURCE_DATE_EPOCH': '1700000000'}
    with tempfile.TemporaryDirectory() as tmp:
        parcial = pathlib.Path(tmp) / 'parcial.ttf'
        subprocess.run([sys.executable, '-m', 'fontTools.varLib.instancer', str(ORIGEM), PESO,
                        '-o', str(parcial), '-q'], check=True, env=ambiente)
        subprocess.run([sys.executable, '-m', 'fontTools.subset', str(parcial),
                        f'--unicodes={UNICODES}', f'--layout-features={RECURSOS}',
                        '--no-hinting', '--flavor=woff2', '--desubroutinize',
                        f'--output-file={saida}'], check=True, env=ambiente)


def resumo(caminho: pathlib.Path) -> str:
    return hashlib.sha256(caminho.read_bytes()).hexdigest()[:12]


def main() -> int:
    if '--checar' in sys.argv:
        with tempfile.TemporaryDirectory() as tmp:
            novo = pathlib.Path(tmp) / 'novo.woff2'
            gerar(novo)
            igual = novo.read_bytes() == DESTINO.read_bytes()
            print(('OK' if igual else 'DESATUALIZADO'), DESTINO.name, resumo(DESTINO), '→', resumo(novo))
            return 0 if igual else 1
    antes = DESTINO.stat().st_size if DESTINO.exists() else 0
    gerar(DESTINO)
    print(f'{DESTINO.relative_to(RAIZ)}: {antes} → {DESTINO.stat().st_size} bytes '
          f'(origem {ORIGEM.stat().st_size} bytes)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
