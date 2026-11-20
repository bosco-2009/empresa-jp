#!/usr/bin/env python3
"""Gera as imagens responsivas do portfólio (melhoria 21).

Uso (na raiz do repositório, precisa de python3 + Pillow com WebP):

    python3 testes/portfolio/gerar.py                 # todas as fotos de testes/portfolio/originais/
    python3 testes/portfolio/gerar.py --entrada X --saida Y

Para cada original <slug>.png/.jpg/.jpeg/.webp (captura de tela de um site REAL, autorizado pelo cliente):
- corta no centro para 4:3 (mesma proporção do card do portfólio);
- grava <slug>-480, <slug>-800 e <slug>-1200 em WebP e em PNG (fallback) em assets/img/portfolio/;
- remove metadados (EXIF/GPS) e perfis de cor: nada além dos pixels vai para o site.

Depois, no config.js: portfolio.projetos → { nome, segmento, url, foto: '<slug>', alt }.
Os originais ficam fora do Git (.gitignore) e nunca são publicados.
"""
import argparse
import re
import sys
from pathlib import Path

try:
    from PIL import Image, features
except ImportError:  # pragma: no cover
    sys.exit('Precisa do Pillow: pip install pillow')

LARGURAS = (480, 800, 1200)  # devem bater com LARGURAS_PORTFOLIO em assets/js/main.js
PROPORCAO = 4 / 3
EXTENSOES = {'.png', '.jpg', '.jpeg', '.webp'}
SLUG = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')

RAIZ = Path(__file__).resolve().parents[2]


def cortar_4x3(img):
    l, a = img.size
    if l / a > PROPORCAO:  # larga demais: corta as laterais
        nova = round(a * PROPORCAO)
        x = (l - nova) // 2
        return img.crop((x, 0, x + nova, a))
    nova = round(l / PROPORCAO)  # alta demais: corta embaixo (o topo do site é o que importa)
    return img.crop((0, 0, l, nova))


def gerar(original, saida):
    slug = original.stem.lower()
    if not SLUG.match(slug):
        raise ValueError(f'{original.name}: use só letras minúsculas, números e hífen no nome (ex.: loja-da-ana.png)')
    with Image.open(original) as aberta:
        img = cortar_4x3(aberta.convert('RGB'))
    if img.width < LARGURAS[-1]:
        print(f'  aviso: {original.name} tem {img.width}px de largura; o ideal é ≥ {LARGURAS[-1]}px (será ampliada)')
    arquivos = []
    for largura in LARGURAS:
        altura = round(largura / PROPORCAO)
        redim = img.resize((largura, altura), Image.LANCZOS)
        webp = saida / f'{slug}-{largura}.webp'
        png = saida / f'{slug}-{largura}.png'
        redim.save(webp, 'WEBP', quality=80, method=6)
        redim.save(png, 'PNG', optimize=True)
        arquivos += [webp, png]
    return slug, arquivos


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--entrada', type=Path, default=RAIZ / 'testes/portfolio/originais')
    ap.add_argument('--saida', type=Path, default=RAIZ / 'assets/img/portfolio')
    args = ap.parse_args()
    if not features.check('webp'):
        sys.exit('Este Pillow não tem suporte a WebP.')
    if not args.entrada.is_dir():
        sys.exit(f'Pasta de originais não encontrada: {args.entrada}')
    originais = sorted(p for p in args.entrada.iterdir() if p.suffix.lower() in EXTENSOES)
    if not originais:
        print('Nenhum original encontrado. Coloque as capturas em', args.entrada)
        return
    args.saida.mkdir(parents=True, exist_ok=True)
    for original in originais:
        slug, arquivos = gerar(original, args.saida)
        total = sum(a.stat().st_size for a in arquivos) // 1024
        print(f'  ✔ {slug}: {len(arquivos)} arquivos ({total} KB)')


if __name__ == '__main__':
    main()
