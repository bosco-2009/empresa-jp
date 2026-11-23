# Supabase — Portfólio BR

## Migrations (aplicar em ordem, pelo nome do arquivo)

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `migrations/20261118120000_chat_ao_vivo.sql` | Tabelas `admins`, `conversas`, `mensagens`; `eh_admin()`; RLS; RPCs do visitante; gatilhos; Realtime |
| 2 | `migrations/20261119120000_pedidos.sql` | Tabelas `planos` (preço oficial), `pedidos`, `pedidos_eventos`; RLS; funções da service role (`pedido_criar`, `pedido_definir_preferencia`, `pedido_registrar_pagamento`); RPC pública `pedido_consultar`; Realtime em `pedidos` |
| 3 | `migrations/20261120120000_briefings.sql` | Tabela `briefings` (um por pedido) com RLS; RPCs `briefing_enviar`/`briefing_obter` (código + token, só pedido aprovado, editável enquanto `novo`); `briefing_autorizar_upload` (service role); bucket **privado** `briefings` (5 MB, imagens e PDF) com leitura só para admin; Realtime em `briefings` |
| 4 | `migrations/20261121120000_origem_visitante.sql` | **Aditiva** (melhoria 10): coluna `pedidos.origem` (até 300 caracteres) e `pedido_definir_origem` (service role). Depois de aplicar, publique de novo a função `criar-pagamento`. Sem ela o site e o painel continuam funcionando, só sem a origem nos pedidos |
| 5 | `migrations/20261122120000_acompanhar_pedido.sql` | **Aditiva** (melhoria 30): só a RPC `pedido_acompanhar(codigo, token)` para `pedido.html`. A etapa é derivada do status do pagamento e do status do briefing (que o dono muda no painel); devolve só código, plano, etapa e datas, sem dados pessoais. Sem ela, `pedido.html` mostra "Não foi possível carregar" e o resto do site segue igual |

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

## Edge Functions (Mercado Pago)

Código em `functions/criar-pagamento/` e `functions/webhook-mercadopago/`. Os arquivos `index.ts` só ligam o
`Deno.serve`; a lógica fica em `functions/_shared/` (pasta com `_` não vira função), escrita só com APIs Web
(`fetch`, `crypto.subtle`), sem dependências externas.

### Deploy

```bash
supabase functions deploy criar-pagamento --no-verify-jwt
supabase functions deploy webhook-mercadopago --no-verify-jwt
supabase functions deploy briefing-upload --no-verify-jwt
```

`briefing-upload` (Fase 4) não precisa de secrets novos: usa `SUPABASE_URL` e a chave de serviço automáticas
e as mesmas `SITE_URL`/`ORIGENS_PERMITIDAS` do CORS.

`--no-verify-jwt` (também em `config.toml`) é necessário:
- `criar-pagamento` é chamada pelo navegador com a chave publicável, que não é um JWT de usuário. A função
  valida a origem (CORS), os campos e cobra o preço da tabela `planos`.
- `webhook-mercadopago` é chamada pelos servidores do Mercado Pago, que não têm JWT do Supabase. A função
  valida a assinatura `x-signature`.

### Secrets (Edge Functions → Secrets, ou `supabase secrets set NOME=valor`)

| Secret | Obrigatório | Valor |
|---|---|---|
| `MP_ACCESS_TOKEN` | sim | Access Token do Mercado Pago (Suas integrações → Credenciais). `TEST-...` usa o `sandbox_init_point`. |
| `MP_WEBHOOK_SECRET` | sim | Assinatura secreta gerada em Suas integrações → Webhooks (ver abaixo). |
| `SITE_URL` | não | URL do site com `/` no final. Padrão: `https://bosco-2009.github.io/empresa-jp/`. Usada nas `back_urls`. |
| `ORIGENS_PERMITIDAS` | não | Origens aceitas no CORS, separadas por vírgula. Padrão: a origem de `SITE_URL`. `localhost`/`127.0.0.1` são sempre aceitos (desenvolvimento). Ex.: `https://www.meudominio.com.br,https://meudominio.com.br`. |
| `MP_SANDBOX` | não | `true`/`false` força o uso do `sandbox_init_point`; sem ele, decide pelo prefixo `TEST-` do token. |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente nas Edge Functions (a função também
aceita `SUPABASE_SECRET_KEY` com uma chave `sb_secret_...`).

### Webhook no Mercado Pago

Em **Suas integrações → (aplicação) → Webhooks → Configurar notificações**:

- **URL (modo produção e modo teste):** `https://mqjpccrxsyajcgbdifld.supabase.co/functions/v1/webhook-mercadopago`
- **Eventos:** marcar **Pagamentos**.
- Salvar e copiar a **assinatura secreta** para o secret `MP_WEBHOOK_SECRET`.

A preferência também envia `notification_url` com essa mesma URL. A função:
1. aceita só `type=payment` (o resto recebe 200 e é ignorado);
2. valida `x-signature` (HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`) e responde 401 se não conferir;
3. consulta o pagamento em `GET /v1/payments/{id}` (não confia no corpo da notificação);
4. confere `external_reference` (id do pedido), **valor e moeda (BRL)** e atualiza o pedido de forma
   **idempotente**. Valor divergente não aprova e fica registrado em `pedidos_eventos`.

Ao usar "Simular notificação" no painel do MP (que manda um id de pagamento inexistente), a resposta esperada
é **200** com `pagamento_inexistente` (URL e assinatura ok); **401** indica `MP_WEBHOOK_SECRET` diferente da assinatura do painel.

### Preços

O preço **cobrado** vem de `public.planos` (o front só exibe o `config.js`). Para mudar um preço:

```sql
update public.planos set valor_centavos = 59700, atualizado_em = now() where id = 'essencial';
```

e ajustar `precoCentavos` no `config.js`. O teste `testes/funcoes/precos.test.mjs` compara os dois (com os
valores das migrations). Para desativar um plano: `update public.planos set ativo = false where id = '...'`.

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

## Briefing e arquivos (Fase 4)

- O cliente abre `briefing.html` pelo botão da página de confirmação (aprovado) ou pelo link pessoal
  `briefing.html#c=<código>&t=<token>` (o token vai no fragmento `#`, que não é enviado a servidores).
- `briefing_enviar(codigo, token, dados)` só aceita pedido **aprovado**; o cliente edita enquanto o status do briefing
  for `novo`. Quando o admin muda para `em_producao`, `em_revisao` ou `entregue`, o briefing (e o envio de arquivos) trava.
- **Arquivos:** a Edge Function `briefing-upload` valida código + token, pedido aprovado, briefing editável, tipo
  (JPG, PNG, WebP, GIF, HEIC/HEIF, PDF), tamanho (≤ 5 MB) e limite de 20 arquivos por pedido, e devolve uma **URL assinada**
  de envio para `briefings/<id do pedido>/<aleatório>-<nome>`. O bucket repete os limites (`file_size_limit`,
  `allowed_mime_types`), então um envio diferente do declarado é recusado pelo Storage. O bucket é **privado**: só o admin
  lê (política em `storage.objects`) e baixa por link temporário de 60 s no painel. SVG não é aceito (pode conter scripts).
- `briefing_enviar` só aceita na lista `arquivos` caminhos da pasta do próprio pedido **que existem** no bucket.
- Arquivos removidos da lista pelo cliente continuam no bucket (contam no limite de 20); a limpeza entra na rotina de retenção.

## Modelo de segurança dos pedidos

- `anon` não acessa `planos`, `pedidos` nem `pedidos_eventos`, nem as funções `pedido_criar`/`_definir_preferencia`/`_registrar_pagamento`
  (só a `service_role` das Edge Functions).
- O cliente consulta o próprio pedido com `pedido_consultar(codigo, token)`: o token (256 bits) fica no navegador
  e o banco guarda só o SHA-256. Código inexistente e token errado dão o **mesmo** erro. A resposta não tem dados pessoais.
- Admin só **lê** pedidos e eventos (RLS `eh_admin()`); ninguém do front cria nem muda status.
- Anti-abuso em `pedido_criar`: no máximo 5 pedidos por e-mail por hora e 60 pedidos por 10 minutos no site.
- Pedido aprovado não volta a pendente/recusado por notificação atrasada de outra tentativa; reembolso é final.

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
