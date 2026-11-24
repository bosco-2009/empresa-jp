"""Compacta uma imagem Open Graph numa paleta pequena (melhoria 84).

    python3 -I testes/og/paleta.py <png> [cores=64] [psnr_minimo=40]

As imagens OG são arte chapada (fundo em degradê suave, texto e formas lisas): 64 cores SEM pontilhado
(o Floyd-Steinberg vira ruído que o PNG não comprime), com a paleta refinada por k-means (as cores chapadas
da marca e os cinzas ficam fiéis), deixam o arquivo ~45% menor e com PSNR maior que o das 256 cores antigas.
Para os degradês não virarem faixas, as áreas lisas ganham um pontilhado ordenado (Bayer 4×4) bem fraco,
que se repete e por isso comprime bem; texto e bordas (gradiente local alto) ficam sem pontilhado.
Antes de gravar, compara com a imagem de entrada: PSNR abaixo do mínimo ou 0,1% dos pixels com erro acima
de 32 (de 255) → tenta 96 e depois 128 cores; se nem assim passar, NÃO grava e sai com erro.
Depois, recompressão sem perda com o pyoxipng, se estiver instalado.
"""
import io
import math
import sys

import numpy as np
from PIL import Image, ImageChops, ImageStat

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16 - 0.5 + 1 / 32
AMPLITUDE = 4  # níveis (de 255) do pontilhado nas áreas lisas


def pontilhar_areas_lisas(img):
    a = np.asarray(img).astype(np.float32)
    alt, larg = a.shape[:2]
    bayer = np.tile(BAYER, (alt // 4 + 1, larg // 4 + 1))[:alt, :larg, None]
    grad = np.abs(np.diff(a, axis=0, append=a[-1:])).sum(2) + np.abs(np.diff(a, axis=1, append=a[:, -1:])).sum(2)
    lisa = (grad < 6)[..., None]
    return Image.fromarray(np.clip(a + bayer * AMPLITUDE * lisa, 0, 255).astype(np.uint8))


def psnr(a, b):
    st = ImageStat.Stat(ImageChops.difference(a.convert('RGB'), b.convert('RGB')))
    mse = sum(x * x for x in st.rms) / 3
    return 99.0 if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def erro_p999(a, b):
    h = ImageChops.difference(a.convert('RGB'), b.convert('RGB')).convert('L').histogram()
    total, soma = sum(h), 0
    for valor, n in enumerate(h):
        soma += n
        if soma >= total * 0.999:
            return valor
    return 255


def main():
    caminho = sys.argv[1]
    cores = int(sys.argv[2]) if len(sys.argv) > 2 else 64
    minimo = float(sys.argv[3]) if len(sys.argv) > 3 else 40.0
    original = Image.open(caminho).convert('RGB')
    pontilhado = pontilhar_areas_lisas(original)
    # Começa com poucas cores e sobe só se a imagem pedir (degradê mais rico, texto fino...)
    for tentativa in (cores, cores * 3 // 2, cores * 2):
        paleta = original.quantize(tentativa, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE, kmeans=4)
        q = pontilhado.quantize(palette=paleta, dither=Image.Dither.NONE)
        nota, pior = psnr(original, q), erro_p999(original, q)
        if nota >= minimo and pior <= 32:
            break
    else:
        sys.exit(f'{caminho}: até {tentativa} cores dariam PSNR {nota:.1f} dB e erro p99,9 {pior}; mantido o original')
    buf = io.BytesIO()
    q.save(buf, 'PNG', optimize=True)
    dados = buf.getvalue()
    try:
        import oxipng
        dados = oxipng.optimize_from_memory(dados, level=6, strip=oxipng.StripChunks.safe())
    except ImportError:
        pass
    with open(caminho, 'rb') as f:
        atual = f.read()
    if len(dados) < len(atual):
        with open(caminho, 'wb') as f:
            f.write(dados)
    print(f'{caminho}: {tentativa} cores, {len(atual)} → {min(len(dados), len(atual))} bytes, PSNR {nota:.1f} dB, erro p99,9 {pior}')


if __name__ == '__main__':
    main()
