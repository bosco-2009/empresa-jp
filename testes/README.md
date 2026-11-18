# Testes locais

Nada aqui vai para o site publicado. Precisa de Node 18+, Postgres 14+ e Chromium (Playwright).

## 1. SQL (migrations, RLS, limites) — só Postgres

```bash
PGUSER=postgres ./supabase/tests/rodar_local.sh
```

Cria o banco `pbr_teste`, aplica os stubs do Supabase (`supabase/tests/00_stubs_supabase.sql`),
aplica cada migration **duas vezes** (idempotência) e roda `supabase/tests/10_chat_test.sql`.

## 2. Ponta a ponta (widget + painel) — Postgres + navegador

O `e2e/servidor-supabase-falso.js` imita a API do Supabase (RPC, tabelas usadas pelo painel, login por
senha e Realtime pelo protocolo Phoenix) executando tudo no Postgres local com os papéis `anon`/`authenticated`
e o RLS reais. Usuários de teste: `dono@teste.local` (admin) e `intruso@teste.local`, senha `senha-de-teste`.

```bash
cd testes && npm install && npx playwright install chromium
createdb pbr_e2e
cat ../supabase/tests/00_stubs_supabase.sql ../supabase/migrations/*.sql | psql -d pbr_e2e
psql -d pbr_e2e -c "insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','dono@teste.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002','intruso@teste.local');
  insert into public.admins values ('aaaaaaaa-0000-0000-0000-000000000001');"
```

Em três terminais:

```bash
python3 -m http.server 8080            # na raiz do repositório
```

```bash
cd testes && npm run servidor          # usa PGHOST/PGUSER/PGPASSWORD
```

```bash
cd testes && npm run chat && npm run layout
```

Capturas de tela ficam em `testes/e2e/saida/`.
