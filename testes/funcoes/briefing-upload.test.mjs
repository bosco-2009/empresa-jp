// Testes unitários da Edge Function briefing-upload (fetch simulado). Uso: node --test testes/funcoes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerAmbiente } from '../../supabase/functions/_shared/comum.ts';
import { criarHandlerBriefingUpload, nomeSeguro, TAMANHO_MAXIMO } from '../../supabase/functions/_shared/briefing-upload.ts';

const PEDIDO = '5f0c8f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
const amb = lerAmbiente((n) => ({
  SUPABASE_URL: 'https://projeto.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.servico', MP_ACCESS_TOKEN: 'x',
  SITE_URL: 'https://bosco-2009.github.io/empresa-jp/',
})[n]);

function fetchFalso(rotas) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push({ url: String(url), init, corpo: init.body ? JSON.parse(init.body) : null });
    for (const [padrao, r] of rotas) if (String(url).includes(padrao)) return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
    throw new Error('inesperado: ' + url);
  };
  return { f, chamadas };
}
const okRotas = (existentes = 2) => [
  ['/rpc/briefing_autorizar_upload', { corpo: [{ pedido_id: PEDIDO, arquivos_existentes: existentes }] }],
  ['/storage/v1/object/upload/sign/briefings/', { corpo: { url: '/object/upload/sign/briefings/caminho?token=abc' } }],
];
const req = (corpo, origem = 'https://bosco-2009.github.io') => new Request('https://x/functions/v1/briefing-upload', {
  method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
});
const ENTRADA = { codigo: 'PBR-ABC234', token: 'a'.repeat(64), nome: 'Logo Final (2).PNG', tipo: 'image/png', tamanho: 120000 };

test('nome seguro: sem acentos, espaços ou extensão enganosa', () => {
  assert.equal(nomeSeguro('Logo Final (2).PNG', 'image/png'), 'logo-final-2.png');
  assert.equal(nomeSeguro('Cardápio ÇÃO.pdf', 'application/pdf'), 'cardapio-cao.pdf');
  assert.match(nomeSeguro('../../etc/passwd', 'image/jpeg'), /^[a-z0-9-]+\.jpg$/, 'sem barras nem pontos de diretório');
  assert.equal(nomeSeguro('foto.php', 'image/jpeg'), 'foto.jpg', 'extensão vem do tipo, não do nome');
  assert.equal(nomeSeguro('', 'image/webp'), 'arquivo.webp');
});

test('gera URL assinada na pasta do pedido', async () => {
  const { f, chamadas } = fetchFalso(okRotas());
  const r = await criarHandlerBriefingUpload(amb, f)(req(ENTRADA));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(d.caminho, new RegExp(`^${PEDIDO}/[0-9a-f]{16}-logo-final-2\\.png$`));
  assert.equal(d.upload_url, 'https://projeto.supabase.co/storage/v1/object/upload/sign/briefings/caminho?token=abc');
  assert.deepEqual(chamadas[0].corpo, { p_codigo: 'PBR-ABC234', p_token: 'a'.repeat(64) });
  assert.ok(chamadas[1].url.endsWith('/storage/v1/object/upload/sign/briefings/' + d.caminho));
  assert.equal(chamadas[1].init.headers.Authorization, 'Bearer eyJ.servico');
});

test('recusa tipo, tamanho, origem e limite antes de assinar', async () => {
  for (const [entrada, status, erro] of [
    [{ ...ENTRADA, tipo: 'image/svg+xml' }, 400, 'tipo_nao_permitido'],
    [{ ...ENTRADA, tipo: 'text/html' }, 400, 'tipo_nao_permitido'],
    [{ ...ENTRADA, tamanho: TAMANHO_MAXIMO + 1 }, 413, 'arquivo_grande'],
    [{ ...ENTRADA, tamanho: 0 }, 400, 'tamanho_invalido'],
    [{ ...ENTRADA, tamanho: 1.5 }, 400, 'tamanho_invalido'],
  ]) {
    const { f, chamadas } = fetchFalso(okRotas());
    const r = await criarHandlerBriefingUpload(amb, f)(req(entrada));
    assert.equal(r.status, status, erro);
    assert.equal((await r.json()).erro, erro);
    assert.equal(chamadas.length, 0);
  }
  const { f, chamadas } = fetchFalso(okRotas(20));
  const r = await criarHandlerBriefingUpload(amb, f)(req(ENTRADA));
  assert.equal(r.status, 429);
  assert.equal(chamadas.some((c) => c.url.includes('/storage/')), false, 'não assina com 20 arquivos');

  const r2 = await criarHandlerBriefingUpload(amb, fetchFalso(okRotas()).f)(req(ENTRADA, 'https://evil.example'));
  assert.equal(r2.status, 403);
});

test('erros do banco: token errado 403, pedido pendente 403, briefing travado 409; Storage fora 502', async () => {
  for (const [msg, status] of [['acesso_negado', 403], ['pedido_nao_aprovado', 403], ['briefing_bloqueado', 409]]) {
    const { f } = fetchFalso([['/rpc/briefing_autorizar_upload', { status: 403, corpo: { code: '42501', message: msg } }]]);
    const r = await criarHandlerBriefingUpload(amb, f)(req(ENTRADA));
    assert.equal(r.status, status);
    assert.equal((await r.json()).erro, msg);
  }
  const { f } = fetchFalso([okRotas()[0], ['/storage/', { status: 500, corpo: {} }]]);
  assert.equal((await criarHandlerBriefingUpload(amb, f)(req(ENTRADA))).status, 502);
});
