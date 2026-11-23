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
- `paginas.test.mjs`: consistência entre as páginas estáticas (CSP igual e coerente com o `config.js`, cabeçalho e rodapé
  iguais aos da home, canonical/OG no subcaminho, imagem OG 1200×630, `noindex` conforme `config.rascunho`, sitemap,
  JSON-LD sem avaliações, 404 com caminhos absolutos, scripts síncronos só `config.js`/`inicio.js`).
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
cd testes && npm run chat && npm run checkout && npm run fase4 && npm run movimento && npm run mockup && npm run exemplos && npm run simulador && npm run comparativo && npm run para-quem && npm run respostas-rapidas && npm run origem && npm run tema && npm run faq && npm run linha-tempo && npm run microinteracoes && npm run exportar && npm run recuperacao && npm run whatsapp-contextual && npm run segmentos && npm run prefetch && npm run pedido && npm run chat-desempenho && npm run resumo && npm run briefing-pendente && npm run depois-pagar && npm run chat-acessivel && npm run busca-global && npm run css-critico && npm run pedido-aberto && npm run layout && npm run auditoria
```

`pedido-aberto.test.js` (Supabase e MP falsos) cobre o aviso "Você tem um pedido em aberto" de `planos.html` (melhoria 39):
volta do Mercado Pago sem pagar, "Concluir pagamento" reabrindo a **mesma** preferência (sem pedido duplicado nem nada novo
no `localStorage`), Pix em processamento recusado com mensagem, aviso sumindo depois do pagamento aprovado, token adulterado,
pedido com mais de 30 dias, sem dados pessoais na tela, 4 larguras, modo escuro e axe.

`auditoria.test.js` passa por **todas as páginas** (inclusive o 404 servido num caminho profundo e o painel) em 320, 375,
768 e 1280 px:
- rolagem horizontal;
- console (inclui violações de CSP);
- axe (falha em serious/critical e lista os menores);
- teclado, com o "Pular para o conteúdo" primeiro e foco visível em cada parada;
- menu, FAQ e link de pular, testados pelo teclado.

`movimento.test.js` (só precisa do servidor estático) testa a abertura de marca e as animações de rolagem:
- aparece uma vez por sessão e termina sozinha; pula por tecla, clique e toque;
- não aparece com movimento reduzido nem sem JS;
- leitores de tela veem o conteúdo real;
- revelar, cascata, sublinhado e o celular em 3D;
- CLS 0 e quadros por segundo;
- 4 larguras com axe;
- grava o vídeo da abertura (1280×720) em `testes/e2e/saida/`; com `GRAVAR_VIDEO=1` atualiza o `testes/video-abertura.webm`
  versionado (só quando a abertura mudar, para não pesar o repositório).

`mockup.test.js` cobre o mockup vivo do hero:
- 3 telas de exemplo com o rótulo "exemplo", trocando só com transform/opacity;
- botão de pausa pelo teclado (WCAG 2.2.2); pausa fora da tela;
- movimento reduzido e sem JS: parado na primeira tela;
- 4 larguras com axe, sem sobreposição dos selos.

`simulador.test.js` cobre o "Qual plano é para mim?" da home:
- todas as combinações de páginas × venda online seguem as regras de `config.simulador`;
- link `planos.html?plano=` pré-seleciona o plano; exemplo do segmento; orientação de domínio;
- teclado, região `aria-live`, oculto sem JS; 4 larguras com axe.

`comparativo.test.js` cobre o comparativo de planos (`planos.html#comparativo`):
- cada linha de `config.comparativo` tem valor para todos os planos; tabela com `caption` e `th scope`;
- abas no celular (setas, Home/End, tabindex móvel); "Escolher" marca o plano no formulário;
- link da home, oculto sem JS; 4 larguras com axe.

`para-quem.test.js` cobre a seção "Para quem é" da home: um ícone próprio por segmento, frase sem números,
links para os sites de exemplo (nome acessível único), revelação na rolagem e axe em 4 larguras.

`respostas-rapidas.test.js` (precisa do Supabase falso, como o `chat.test.js`) cobre as respostas rápidas do painel:
inserção no cursor sem enviar, `{nome}`, padrões com preços/prazos do `config.js`, editor em `<dialog>` (teclado, axe),
localStorage e 4 larguras.

`briefing-pendente.test.js` (Supabase falso) cobre o lembrete de briefing pendente na aba Pedidos: filtro "Sem briefing"
(aprovados há mais de 24 h), selo da aba (pendentes + sem briefing), mensagem pronta com `pedido.html?pedido=` **sem o
token**, wa.me sem envio automático, registro local de "lembrado" e o bloco sumindo quando o briefing chega (tempo real).

`chat-desempenho.test.js` (Supabase falso) cobre o carregamento sob demanda do chat: visitante novo não baixa o
`supabase-js` nem abre WebSocket na carga; mouse/foco/toque no botão só baixam a biblioteca (sem cliente nem conexão);
quem já conversou retoma depois do evento `load`; abrir o chat durante a retomada não duplica `chat_iniciar` nem o canal.

`whatsapp-contextual.test.js` (Supabase falso) cobre o WhatsApp contextual: com o número vazio do `config.js` nada aparece;
com um número de teste, cards de plano, resumo do pedido (segue o plano marcado), comparativo, artigos do blog e o chat fora
do horário levam a mensagem do modelo certo de `contato.whatsappModelos`; 4 larguras e modo escuro com axe.

`exportar.test.js` (Supabase falso) cobre os filtros e a exportação do painel: período, origem (utm/ref) e "só leads"
nas conversas; período e origem nos pedidos (contadores e resumo seguem o recorte); CSV gerado no navegador com `;`,
BOM, aspas escapadas e apóstrofo antes de valores que parecem fórmula; 4 larguras com axe.

`origem.test.js` (Supabase e MP falsos) cobre a origem do visitante: utm_* e domínio de referência guardados na
chegada, chat (`pagina_origem`), pedido (Edge Function real → `pedidos.origem`), painel e banco sem a migration.

`tema.test.js` cobre o modo escuro: segue o sistema, botão (teclado, localStorage, sem CLS), exemplos e painel sempre
claros, cabeçalho em uma linha e axe no escuro em todas as páginas × 4 larguras.

`faq.test.js` cobre o FAQ: ids `#faq-...` estáveis, link direto abrindo a pergunta, busca sem acentos (com as
`palavras` extras do `config.js`), "Copiar link", JSON-LD FAQPage e axe claro/escuro em 4 larguras.

`microinteracoes.test.js` cobre hover/pressionar de botões e cards (inclusive cards já revelados), o "carregando"
do checkout (Edge Function simulada), o tremor do campo inválido, o FAQ e o desligamento com movimento reduzido.

`portfolio.test.js` (python3 + Pillow) cobre as imagens responsivas do portfólio: o gerador (`testes/portfolio/gerar.py`)
recusa nomes fora do padrão, corta em 4:3, grava 480/800/1200 em WebP e PNG sem EXIF/ICC; com um projeto falso só no
teste, `<picture>` com `srcset`/`sizes` escolhe o WebP do tamanho certo (1x e 2x) em 4 larguras com axe; sem projetos,
nada é baixado e a seção da home continua oculta.

Capturas de tela ficam em `testes/e2e/saida/`.

`css-critico.test.js` (só precisa do servidor estático) cobre a melhoria 38: `home.css` só na home, logo depois de
`main.css` (mesma cascata de antes), nenhuma outra página baixa as regras da abertura/mockup/linha do tempo, e CLS 0 em
home, planos, blog e artigo (320/375 px; em planos a 768/1280 px só o deslocamento mínimo já existente, ≤ 0,005), claro e escuro.

## 4. Lighthouse (opcional)

```bash
npx lighthouse@12.6.1 http://localhost:8080/ --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new"
```

Com o rascunho, o SEO acusa só o `noindex` (esperado). Para medir como ficará publicado, rode numa cópia do site sem
as linhas de `noindex` das páginas públicas (passo 6 do `PUBLICAR.md`).

## Imagens Open Graph por página

```bash
node testes/og/gerar.mjs
```

Gera um SVG por página em `testes/og/svg/` e o PNG 1200×630 (< 100 KB) em `assets/img/og/` para planos, exemplos,
blog e cada artigo. Ao criar um artigo novo, acrescente-o à lista `IMAGENS` do script e aponte `og:image` (e o
`image` do JSON-LD) para o PNG gerado; o `paginas.test.mjs` confere tamanho, peso e os caminhos.

`pedido.test.js` (Supabase falso) cobre o acompanhamento do pedido (`pedido.html`): sem acesso e token errado, pagamento
pendente e recusado, link pessoal (token sai da barra), nenhum dado pessoal na página, briefing recebido pelo botão "Atualizar",
o dono mudando a etapa no detalhe do pedido do painel (em produção, ajustes finais, entregue), prazo do plano vindo do `config.js`,
4 larguras em claro e escuro com axe.

`recuperacao.test.js` cobre a recuperação de checkout abandonado no painel (pedidos `pendente` há mais de 1 hora):
- filtro "Abandonados" com contador e etiqueta no item (o pendente recente e o aprovado ficam de fora);
- mensagem pronta (nome, código, plano, valor e link para retomar o plano), editável, com "Restaurar mensagem";
- link `wa.me` com o texto escapado e `rel="noopener"`; nada é enviado pelo sistema;
- registro local de "chamado" (só id e data no `localStorage` do admin);
- 320, 375, 768 e 1280 px com axe e console limpo.

`depois-pagar.test.js` (só precisa do servidor estático) cobre a melhoria 35 em `planos.html`: o bloco "O que acontece
depois de pagar" logo abaixo do botão (etapas e textos de `config.depoisDoPagamento`, prazo do plano escolhido atualizado
ao trocar de plano) e a seção "Dúvidas sobre o pagamento" (só as perguntas de `config.faq` com `checkout: true`, com link
direto `#faq-...` e "Copiar link"), sem mudar o FAQ da home; 320/375/768/1280 px, claro e escuro, console e axe.

`chat-acessivel.test.js` (Supabase falso + servidor estático) cobre a melhoria 36 no widget do chat, pela árvore de
acessibilidade do Playwright (`ariaSnapshot`, salva em `e2e/saida/chat-arvore-celular.txt`):
- abrir pelo teclado leva o foco ao primeiro campo; `Esc` fecha e devolve o foco ao botão (só quando o foco está no chat);
- no celular (painel em tela cheia) o diálogo é `aria-modal` e o `Tab` circula dentro dele; no computador não prende;
- rótulos "(opcional)" e descrições (dica do WhatsApp, aviso de privacidade, erro) dos campos;
- `aria-live` só numa região de anúncio: respostas novas do atendente (com o chat aberto ou fechado), nunca o
  histórico restaurado nem as mensagens do próprio visitante; axe e console limpos.
