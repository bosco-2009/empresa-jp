#!/usr/bin/env python3
"""Calcula as fontes de reserva com métricas ajustadas à Plus Jakarta Sans (melhoria 119).

Enquanto a Plus Jakarta Sans ainda não chegou (internet lenta; font-display: swap), o texto aparece na fonte do
sistema. Sem ajuste, a troca muda a largura e a altura das linhas e empurra o conteúdo (CLS de até 0,03 na home a
375 px com a fonte atrasada 1,5 s). Estas faces "Plus Jakarta Sans Reserva" usam uma fonte local (Arial e as
compatíveis em métrica; Roboto no Android) com size-adjust e ascent/descent/line-gap-override calculados aqui,
para que a troca quase não mexa no layout.

Uso (da raiz do repositório):
    pip install fonttools brotli --break-system-packages
    python3 testes/fontes/reserva.py            # imprime os valores
    python3 testes/fontes/reserva.py --json     # o mesmo em JSON (usado por testes/funcoes/fontes.test.mjs? não:
                                                # o teste confere os números gravados em tokens.css com o JSON
                                                # salvo em testes/fontes/reserva.json)
    python3 testes/fontes/reserva.py --gravar   # grava testes/fontes/reserva.json

Fontes locais usadas na medição (as do container de testes):
- Arial: Liberation Sans (mesmas larguras e métricas verticais da Arial, por projeto);
- Roboto: Roboto variável do Google Fonts (instanciada em 400 e 700).

Largura: média das larguras ponderada pela frequência de cada caractere no texto publicado do site
(HTML + config.js), no peso 400 (face normal) e 700 (face negrito: 600, 700 e 800 usam essa face).
Métricas verticais: hhea da Plus Jakarta Sans divididas pelo size-adjust (o navegador multiplica os overrides
pelo size-adjust).
"""
import collections
import html
import io
import json
import pathlib
import re
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RAIZ = pathlib.Path(__file__).resolve().parents[2]
PJS = RAIZ / 'assets/fonts/plus-jakarta-sans-latin-wght.woff2'
SAIDA = RAIZ / 'testes/fontes/reserva.json'
LOCAIS = {
    'arial': {
        400: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        700: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    },
    'roboto': {
        400: ('/usr/share/fonts/truetype/google-fonts/ofl/roboto/Roboto[wdth,wght].ttf', 400),
        700: ('/usr/share/fonts/truetype/google-fonts/ofl/roboto/Roboto[wdth,wght].ttf', 700),
    },
}


def abrir(origem, peso=None):
    fonte = TTFont(origem)
    if 'fvar' in fonte:
        eixos = {e.axisTag: e.defaultValue for e in fonte['fvar'].axes}
        eixos['wght'] = peso
        fonte = instancer.instantiateVariableFont(fonte, eixos)
    return fonte


def frequencias():
    """Contagem de cada caractere visível no texto publicado (sem tags, scripts nem estilos)."""
    cont = collections.Counter()
    arquivos = [p for p in RAIZ.rglob('*.html') if not re.search(r'/(testes|supabase|node_modules|\.git)/', str(p))]
    for p in arquivos:
        t = p.read_text(encoding='utf-8')
        t = re.sub(r'<(script|style)\b[\s\S]*?</\1>', ' ', t)
        t = html.unescape(re.sub(r'<[^>]+>', ' ', t))
        cont.update(re.sub(r'\s+', ' ', t))
    cfg = (RAIZ / 'config.js').read_text(encoding='utf-8')
    for m in re.finditer(r"'((?:[^'\\]|\\.)*)'", cfg):
        cont.update(m.group(1))
    return cont


def largura_media(fonte, cont):
    cmap = fonte.getBestCmap()
    hmtx = fonte['hmtx']
    upm = fonte['head'].unitsPerEm
    total = soma = 0
    for ch, n in cont.items():
        g = cmap.get(ord(ch))
        if g is None:
            continue
        total += n
        soma += n * hmtx[g][0] / upm
    return soma / total


def calcular():
    cont = frequencias()
    # Só os caracteres que todas as fontes têm entram na média (a comparação fica justa).
    fontes = {('pjs', p): abrir(PJS, p) for p in (400, 700)}
    for nome, pesos in LOCAIS.items():
        for p, origem in pesos.items():
            fontes[(nome, p)] = abrir(*origem) if isinstance(origem, tuple) else abrir(origem)
    comuns = set(cont)
    for f in fontes.values():
        comuns &= {chr(c) for c in f.getBestCmap()}
    cont = collections.Counter({c: n for c, n in cont.items() if c in comuns})

    pjs = fontes[('pjs', 400)]
    upm = pjs['head'].unitsPerEm
    hhea = pjs['hhea']
    resultado = {'caracteres': sum(cont.values())}
    for nome in LOCAIS:
        for p in (400, 700):
            ajuste = largura_media(fontes[('pjs', p)], cont) / largura_media(fontes[(nome, p)], cont)
            resultado[f'{nome}-{p}'] = {
                'size-adjust': round(ajuste * 100, 2),
                'ascent-override': round(hhea.ascent / upm / ajuste * 100, 2),
                'descent-override': round(-hhea.descent / upm / ajuste * 100, 2),
                'line-gap-override': round(hhea.lineGap / upm / ajuste * 100, 2),
            }
    return resultado


if __name__ == '__main__':
    r = calcular()
    if '--gravar' in sys.argv:
        SAIDA.write_text(json.dumps(r, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print('gravado', SAIDA.relative_to(RAIZ))
    else:
        print(json.dumps(r, indent=2, ensure_ascii=False))
