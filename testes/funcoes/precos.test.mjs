// O preço exibido (config.js) precisa ser igual ao preço cobrado (tabela planos da migration).
// Uso: node --test testes/funcoes/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);

function lerConfig() {
  const janela = {};
  vm.runInNewContext(readFileSync(new URL('config.js', raiz), 'utf8'), { window: janela });
  return janela.PBR_CONFIG;
}

function precosDasMigrations() {
  const pasta = new URL('supabase/migrations/', raiz);
  const precos = {};
  for (const arq of readdirSync(pasta).sort()) {
    const sql = readFileSync(new URL(arq, pasta), 'utf8');
    // valores iniciais: insert into public.planos (...) values ('id', 'Nome', 12345), ...
    const bloco = /insert into public\.planos[^;]*?values([\s\S]*?)on conflict/i.exec(sql);
    if (bloco) for (const m of bloco[1].matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*(\d+)\)/g)) precos[m[1]] = { nome: m[2], valor: Number(m[3]) };
    // ajustes posteriores: update public.planos set valor_centavos = N where id = 'x'
    for (const m of sql.matchAll(/update public\.planos set valor_centavos = (\d+) where id = '([a-z0-9-]+)'/gi)) {
      if (!/^\s*--/.test(sql.slice(sql.lastIndexOf('\n', m.index) + 1, m.index))) precos[m[2]].valor = Number(m[1]);
    }
  }
  return precos;
}

test('cada plano do config.js existe na tabela planos com o mesmo nome e preço', () => {
  const config = lerConfig();
  const banco = precosDasMigrations();
  assert.ok(config.planos.length > 0);
  for (const p of config.planos) {
    assert.ok(banco[p.id], `plano ${p.id} não existe na migration`);
    assert.equal(banco[p.id].valor, p.precoCentavos, `preço do plano ${p.id}: config.js ${p.precoCentavos} x banco ${banco[p.id].valor}`);
    assert.equal(banco[p.id].nome, p.nome, `nome do plano ${p.id}`);
  }
});
