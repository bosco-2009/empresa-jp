#!/usr/bin/env python3
"""Miniaturas dos cartões do blog e do "Leia também" (melhoria 106).

Uso (na raiz do repositório, precisa de python3 + Pillow com WebP):

    python3 testes/blog/miniaturas.py

Fonte: as próprias imagens Open Graph do site (assets/img/og/<nome>.png, geradas por testes/og/gerar.mjs).
Nada de fotos de terceiros. Para cada imagem usada em cartão grava em assets/img/miniaturas/:
- <nome>-400.webp e <nome>-800.webp (1x/2x, mesma proporção 1200×630);
- <nome>-400.png em paleta (fallback de <picture> para navegador sem WebP).
Metadados não são copiados. As miniaturas são decorativas (alt=""): o título do cartão já diz tudo.
O teste testes/funcoes/blog-miniaturas.test.mjs confere arquivos, dimensões e o HTML dos cartões.
"""
import sys
from pathlib import Path

try:
    from PIL import Image, features
except ImportError:  # pragma: no cover
    sys.exit('Precisa do Pillow: pip install pillow')

RAIZ = Path(__file__).resolve().parents[2]
OG = RAIZ / 'assets/img/og'
SAIDA = RAIZ / 'assets/img/miniaturas'
LARGURAS = (400, 800)  # devem bater com MINIATURA_LARGURAS em testes/funcoes/blog-miniaturas.test.mjs
# Imagens OG que aparecem em cartões: os 3 artigos (lista do blog e "Leia também") e os segmentos citados
NOMES = (
    'blog-site-ou-instagram',
    'blog-o-que-um-site-profissional-precisa-ter',
    'blog-como-funciona-a-criacao-do-seu-site',
    'segmento-beleza',
    'segmento-restaurante',
    'segmento-servicos',
)


def gerar(nome):
    with Image.open(OG / f'{nome}.png') as aberta:
        img = aberta.convert('RGB')
    arquivos = []
    for largura in LARGURAS:
        altura = round(largura * img.height / img.width)
        redim = img.resize((largura, altura), Image.LANCZOS)
        webp = SAIDA / f'{nome}-{largura}.webp'
        redim.save(webp, 'WEBP', quality=78, method=6)
        arquivos.append(webp)
        if largura == LARGURAS[0]:
            png = SAIDA / f'{nome}-{largura}.png'
            redim.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(png, 'PNG', optimize=True)
            arquivos.append(png)
    return arquivos


def main():
    if not features.check('webp'):
        sys.exit('Este Pillow não tem suporte a WebP.')
    SAIDA.mkdir(parents=True, exist_ok=True)
    for nome in NOMES:
        for arq in gerar(nome):
            print(f'{arq.relative_to(RAIZ)}: {arq.stat().st_size} bytes')


if __name__ == '__main__':
    main()
