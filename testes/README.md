# Testes locais

Nada aqui vai para o site publicado. Precisa de Node 22+, Postgres 14+ e Chromium (Playwright).

## 1. SQL (migrations, RLS, limites) — só Postgres

```bash
PGUSER=postgres ./supabase/tests/rodar_local.sh
```

Cria o banco `pbr_teste`, aplica os stubs do Supabase (`supabase/tests/00_stubs_supabase.sql`),
aplica cada migration **duas vezes** (idempotência) e roda todos os `supabase/tests/NN_*_test.sql`
(chat, pedidos e briefings).

## 2. Edge Functions e preços — só Node

```bash
node --test testes/funcoes/*.test.mjs
```

- `edge-functions.test.mjs`: `criar-pagamento` e `webhook-mercadopago` com `fetch` simulado (CORS, validação,
  preço vindo do servidor, corpo da preferência, sandbox, assinatura `x-signature` calculada de forma
  independente com `node:crypto`, idempotência, erros 4xx/5xx).
- `briefing-upload.test.mjs`: Edge Function de upload (nome seguro, tipo, tamanho, limite, erros do banco e do Storage).
- `precos.test.mjs`: o `config.js` (preço exibido) bate com a tabela `planos` das migrations (preço cobrado).

O Node 22+ importa os `.ts` das funções diretamente (remove os tipos), então o código testado é o mesmo do deploy.

## 3. Ponta a ponta — Postgres + navegador

- `e2e/servidor-supabase-falso.js` imita a API do Supabase:
  - RPC e as tabelas usadas pelo painel;
  - login por senha;
  - Realtime pelo protocolo Phoenix;
  - `/functions/v1/*`, que executa as **Edge Functions reais** do repositório;
  - Storage: URL assinada de envio (`PUT`, com limites do bucket) e de download (só quem lê pelo RLS).

  Tudo roda no Postgres local, com os papéis `anon`/`authenticated`/`service_role` e o RLS reais.
- `e2e/mercadopago-falso.js` imita o Mercado Pago:
  - preferências e consulta de pagamento;
  - uma tela de checkout com os botões aprovar, Pix pendente e recusar;
  - webhooks **assinados** com `x-signature`.

Usuários de teste: `dono@teste.local` (admin) e `intruso@teste.local`, senha `senha-de-teste`.

```bash
cd testes && npm install && npx playwright install chromium
createdb pbr_e2e
cat ../supabase/tests/00_stubs_supabase.sql ../supabase/migrations/*.sql | psql -d pbr_e2e
psql -d pbr_e2e -c "insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','dono@teste.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002','intruso@teste.local');
  insert into public.admins values ('aaaaaaaa-0000-0000-0000-000000000001');"
```

Em quatro terminais:

```bash
python3 -m http.server 8080            # na raiz do repositório
```

```bash
cd testes && npm run servidor          # Supabase falso (usa PGHOST/PGUSER/PGPASSWORD)
```

```bash
cd testes && npm run mp                # Mercado Pago falso
```

```bash
cd testes && npm run chat && npm run checkout && npm run fase4 && npm run layout
```

Capturas de tela ficam em `testes/e2e/saida/`.
