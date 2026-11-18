# Supabase — Portfólio BR

## Migrations (aplicar em ordem, pelo nome do arquivo)

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `migrations/20261118120000_chat_ao_vivo.sql` | Tabelas `admins`, `conversas`, `mensagens`; `eh_admin()`; RLS; RPCs do visitante; gatilhos; Realtime |

Todas são **idempotentes**: rodar de novo não dá erro nem duplica nada.

Como aplicar (qualquer um):

- **Painel do Supabase:** SQL Editor → colar o conteúdo do arquivo → Run.
- **CLI:** `supabase link --project-ref <ref>` e depois `supabase db push`.

> `supabase/tests/` **não** deve ser aplicado no projeto: são stubs e testes para Postgres local.

## Configurações do projeto (uma vez)

1. **Auth → Sign In / Providers → Email:** manter *Email* ativo e **desligar "Allow new users to sign up"**.
   O login é só para o dono; ninguém deve conseguir criar conta pelo site. Mesmo que alguém criasse,
   não teria acesso a nada, porque o RLS exige estar em `public.admins`.
2. **Realtime → Settings:** manter permitido o uso de **canais públicos** ("Allow public access" ligado,
   ou seja, *não* marcar "only private channels"). O widget do visitante recebe avisos por um canal Broadcast
   público cujo nome é secreto. Se os canais públicos forem desligados, o chat continua funcionando,
   mas as respostas chegam ao visitante pela busca periódica (a cada 20 s), e não na hora.
3. **API Keys:** copiar a **URL do projeto** e a **chave pública** (`anon` ou `sb_publishable_...`) para
   `config.js` → `supabase.url` e `supabase.anonKey`. **Nunca** usar a `service_role`/secret key no front.

## Criar o primeiro admin

1. **Authentication → Users → Add user → Create new user**: e-mail e senha forte do dono,
   com **"Auto Confirm User"** marcado.
2. No **SQL Editor**, cadastrar como admin (trocar o e-mail):

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'dono@exemplo.com.br'
   on conflict (user_id) do nothing;
   ```

3. Abrir `https://<site>/admin/` e entrar com esse e-mail e senha.

Remover um admin:

```sql
delete from public.admins where user_id = (select id from auth.users where email = 'dono@exemplo.com.br');
```

## Modelo de segurança do chat

- **Visitante (papel `anon`) não tem acesso a nenhuma tabela.** Tudo passa por 3 funções
  `SECURITY DEFINER` com `search_path` vazio:
  - `chat_iniciar(p_visitante_id, p_token, p_nome?, p_whatsapp?, p_pagina?, p_criar?)` cria ou retoma a conversa;
  - `chat_listar(p_visitante_id, p_token, p_depois?, p_limite?)` devolve o histórico (no máximo 200 por chamada);
  - `chat_enviar(p_visitante_id, p_token, p_texto)` envia uma mensagem (1 a 2.000 caracteres).
- O navegador gera um **token aleatório de 256 bits** (localStorage). O banco guarda só o **SHA-256** dele.
  Toda função confere o token: conhecer o `visitante_id` não basta.
- **Anti-spam:**
  - no máximo **20 mensagens do visitante por conversa a cada 10 minutos**;
  - no máximo **60 conversas novas por 10 minutos** no site todo;
  - tamanhos limitados por `check` (nome ≤ 80, WhatsApp com 10 a 13 dígitos, página ≤ 300, texto ≤ 2.000).
- **Admin** (usuário em `public.admins`) lê e escreve tudo pelo RLS (`eh_admin()`).
  - Só pode inserir mensagens como `autor = 'admin'`.
  - Só pode alterar `status` e `nao_lidas_admin` das conversas (permissão por coluna).
- **Tempo real:**
  - o painel usa `postgres_changes` em `mensagens` e `conversas`, que respeita o RLS;
  - o visitante recebe só um *ping* sem conteúdo (`realtime.send`, canal `chat:<canal secreto>`) e então busca as mensagens pela RPC.
- Funções internas (`_chat_*`) não podem ser chamadas por `anon` nem `authenticated`.

## Testes locais

Veja [`../testes/README.md`](../testes/README.md).
