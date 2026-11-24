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
- `sitemap.test.mjs`: o `sitemap.xml` tem exatamente as páginas públicas (com o comentário de rascunho; `portfolio.html`
  só com projetos reais), nunca exemplos/privadas/admin, canonical = `loc`, `lastmod` válido; o `blog/feed.xml` tem um item
  por artigo. Para regerar: `node testes/seo/gerar-sitemap.mjs` (`--conferir` só confere). `lastmod` vem do `git log`.
- `links-internos.test.mjs` (item 71): em todas as páginas HTML, cada `href`/`src`/`srcset`/`poster` local, `og:image`/`og:url`
  e endereço absoluto do próprio site aponta para um arquivo que existe, e cada âncora `#id` (inclusive em outra página)
  existe no destino. Ignora links externos e os montados pelo JS; as abas do painel (`data-aba-link`) são rotas do JS.
- `blog-leitura.test.mjs` (item 57): "leitura de N min" (200 palavras/min, arredondado) igual no artigo, no cartão de
  `blog/index.html`, nos cartões de "Leia também" e no JSON-LD (`wordCount`/`timeRequired`); cada artigo tem 2–3 relacionados
  fixos no HTML com exatamente um link para página de segmento. Mudou um artigo? `node testes/blog/leitura.mjs --gravar`.
- `indicado.test.mjs` (item 65): bloco "Plano indicado" no fim dos artigos e das páginas de segmento igual à regra
  `config.planoIndicado` (todo artigo/segmento com regra, plano existente, sem preço no bloco). Mudou a regra ou um plano?
  `node testes/conteudo/indicado.mjs --gravar` (depois de `testes/segmentos/gerar.py`, rode de novo). E2E: `npm run indicado`.
- `precos.test.mjs`: o `config.js` (preço exibido) bate com a tabela `planos` das migrations (preço cobrado).
- `versao-arquivos.test.mjs` (item 69): toda referência local a CSS, JS e fonte (HTML e `url()` dos CSS) leva `?v=<8 hex do
  sha256 do arquivo>`, atualizada; o preload da fonte é o mesmo endereço do `@font-face`. Mudou CSS/JS/fonte/`config.js`?
  `node testes/cache/versionar.mjs` (`--conferir` só confere). Nos testes e2e, rotas do Playwright usam `'**/config.js*'`.

O Node 22+ importa os `.ts` das funções diretamente (remove os tipos), então o código testado é o mesmo do deploy.

## 3. Ponta a ponta — Postgres + navegador

- `e2e/servidor-supabase-falso.js` imita a API do Supabase:
  - RPC e as tabelas usadas pelo painel;
  - login por senha;
  - Realtime pelo protocolo Phoenix;
  - `/functions/v1/*`, que executa as **Edge Functions reais** do repositório;
  - `/__realtime/derrubar` e `/__realtime/liberar`: derrubam os WebSockets do Realtime e recusam novos até liberar
    (queda simulada do `tempo-real-pausado.test.js`, item 79);
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
cd testes && npm run chat && npm run checkout && npm run fase4 && npm run movimento && npm run mockup && npm run exemplos && npm run simulador && npm run comparativo && npm run para-quem && npm run respostas-rapidas && npm run origem && npm run tema && npm run faq && npm run linha-tempo && npm run microinteracoes && npm run exportar && npm run recuperacao && npm run whatsapp-contextual && npm run segmentos && npm run prefetch && npm run pedido && npm run chat-desempenho && npm run resumo && npm run conteudos-resumo && npm run exportar-resumo && npm run briefing-pendente && npm run depois-pagar && npm run chat-acessivel && npm run busca-global && npm run atalhos-painel && npm run css-critico && npm run pedido-aberto && npm run tentar-de-novo && npm run form-celular && npm run briefing-revisao && npm run chat-boas-vindas && npm run paginacao-painel && npm run pagos-sem-contato && npm run pedidos-atrasados && npm run checklist-pedido && npm run alvos-toque && npm run nomes-links && npm run sem-conexao && npm run resumo-erros && npm run fila-espera && npm run lcp && npm run orcamento-bytes && npm run lembrar-simulador && npm run barra-plano && npm run impressao && npm run tempo-real-pausado && npm run jsonld-organizacao && npm run layout && npm run auditoria
```

`briefing-erro-rede.test.js` (sem Postgres: RPCs, Edge Function e Storage respondidos pelo Playwright, item 82) derruba a rede
no meio do envio (`abort`), responde 503 e pendura a requisição (relógio controlado, prazo de 20 s): o briefing mostra a mensagem
no `role="alert"` com "Tentar de novo", o rascunho continua inteiro e o reenvio funciona pelo teclado; um arquivo com falha fica na
lista com a mensagem num `role="alert"`, "Tentar de novo" (o mesmo arquivo) e "Descartar"; a nova tentativa reaproveita a URL
assinada e um 409 do Storage (arquivo que já tinha chegado) conta como enviado, sem duplicar; enviar com arquivo pendente leva à
etapa 4 com foco no "Tentar de novo". Recusas (limite, tipo) continuam sumindo sozinhas. 4 larguras × claro/escuro, axe e alvos.

`briefing-revisao.test.js` (sem Postgres: RPCs respondidas pelo Playwright) cobre a prévia do briefing antes de enviar
(melhoria 50): resumo agrupado por etapa com `h3` e "Editar etapa N: …", ida à etapa certa só pelo teclado (foco na legenda),
"Voltar à revisão" devolvendo o foco ao mesmo "Editar", envio descrito por `aria-describedby`, 4 larguras, escuro e movimento reduzido.

`nomes-links.test.js` (Supabase falso + Postgres, item 72; WCAG 2.4.4/2.4.9) agrupa links e botões pelo nome acessível
(calculado pelo axe-core) e acusa nomes iguais com destinos diferentes, em todas as páginas a 320 e 1280 px (menu móvel aberto
também), no chat aberto, no simulador respondido, em `planos.html` com plano escolhido e no painel com dados. Destino de link =
endereço sem `?v=` (`index.html` = pasta; WhatsApp pelo número); de botão = `aria-controls`/`value`/`data-*`. Repetiu? Use texto
mais claro ou complemento `visualmente-oculto`. Um controle prova que o teste acusa dois "Saiba mais" diferentes.

`pedidos-atrasados.test.js` (item 83) grava briefings N dias úteis antes de hoje (fuso de São Paulo) e confere o cálculo do
prazo (dias úteis, fins de semana, `prazoDias` antes do texto, plano sem número = sem prazo), a etiqueta "Atrasado", o filtro
"Atrasados", a linha "Prazo de entrega" do detalhe, o cartão do Resumo, que o cálculo não grava nada e que marcar "Site
entregue" tira o atraso; 4 larguras + axe.

`orcamento-bytes.test.js` (só o servidor estático, item 73) soma o que cada página pública carrega até o `load`: HTML,
CSS, JS e fontes da própria origem (corpo sem compressão; supabase-js, prefetch e imagens ficam de fora), a 375 e 1280 px,
e falha se passar do mapa `ORCAMENTO` (medido + 10 %), listando os 5 maiores arquivos. Também barra script externo na carga,
página pública sem orçamento e orçamento frouxo (> medido + 25 %). Página cresceu de propósito?
`node e2e/orcamento-bytes.test.js --medir` imprime o mapa novo para colar no teste.

`lembrar-simulador.test.js` (só o servidor estático, item 74) cobre a lembrança do simulador: a home guarda só
`{plano, em}` em `pbr_simulador_v1` (o último indicado); `planos.html` sem `?plano=` mostra "O simulador indicou o plano X"
no passo 1 sem marcar nada; "Marcar" (teclado) marca, foca o plano e anuncia em `aria-live`; marcar à mão também fecha;
"Dispensar" apaga e não volta; com `?plano=`, indicado já marcado, vencido (> 30 dias), data futura, plano inexistente ou
JSON quebrado não mostra; `localStorage` bloqueado não quebra; 4 larguras × claro/escuro com axe, alvos e console.

`barra-plano.test.js` (só o servidor estático, item 75) cobre o resumo fixo do plano no celular em `planos.html`: a 320/375 px
a barra fica oculta com o formulário na tela e aparece ao descer até o comparativo, com nome e preço exibido iguais ao `config.js`
(acompanhando a troca de plano); "Continuar" leva ao 1º campo vazio, depois ao aceite e ao botão de pagar; some com campo de texto
em foco (teclado); não cobre o rodapé no fim da página nem o botão do chat; CLS 0, entrada animada só sem movimento reduzido,
axe (claro e escuro) e console. A 768/1280 px e sem JS nunca aparece nem reserva espaço.

`jsonld-organizacao.test.js` (só o servidor estático, item 80) junta o JSON-LD da home (HTML fixo + nós do `main.js`) e confere
que Organization e WebSite levam só dados reais do `config.js`: com os contatos vazios/`[PROVISÓRIO]` não há e-mail, telefone,
`contactPoint`, razão social nem CNPJ; com contatos simulados no próprio teste eles entram no formato certo; marcados ou inválidos, nunca.

`impressao.test.js` (só o servidor estático; as RPCs do pedido são simuladas no próprio teste, item 77) cobre a impressão de
`termos.html`, `privacidade.html`, `pedido.html` e `obrigado.html` com `emulateMedia({ media: 'print' })`, claro e escuro:
cabeçalho no fluxo (sem sticky), sem menu, chat, abertura, tema nem botões; fundo branco e texto escuro mesmo no modo escuro;
links do conteúdo com o endereço impresso (sem query nem token) e âncoras sem endereço; link pessoal do briefing fora do papel;
nada passa da largura útil da A4; PDF gerado em `e2e/saida/impressao-*.pdf` (comprovantes em 1 folha) e 1ª página em PNG.

`paginacao-painel.test.js` (Supabase falso, 200 registros de teste) cobre as listas longas do painel (melhoria 49): conversas,
pedidos e briefings em páginas de 50 (`range` + `count: 'exact'`), "Mostrando X de Y" e "Carregar mais", foco no primeiro item
novo, tempo real sem perder o que já foi carregado, conversas sem mensagem fora do total (`mensagens!inner`), filtros/busca/
exportação contando só o carregado, falha de rede sem perder o limite, "Ver pedido" de briefing abrindo pedido fora da página,
4 larguras e axe. O Supabase falso agora entende `limit`/`offset` e devolve o total em `Content-Range`.

`pagos-sem-contato.test.js` (Supabase falso) cobre o aviso de pedidos pagos sem contato do dono (melhoria 51): filtro
"Sem contato" e etiqueta para aprovados nos últimos 30 dias, site não entregue, sem resposta do dono no chat de uma conversa
com o mesmo WhatsApp (com ou sem 55, numa consulta só com `mensagens!inner` e `autor=eq.admin`) e sem WhatsApp aberto pelo
painel; boas-vindas editável (com ou sem pedido de briefing, sem token nem valor), wa.me sem envio automático, "Já falei com
este cliente", aviso sumindo em tempo real quando o dono responde no chat, falha da consulta sem alarme falso, nenhuma
escrita no banco, 4 larguras e axe. O Supabase falso entende `conversas?whatsapp=in.(...)`.

`conteudos-resumo.test.js` (Supabase falso) cobre o cartão "De onde vieram os pedidos" da aba Resumo (melhoria 70):
conversas, pedidos e pagos do mês agrupados pelo `cta: blog/...`/`cta: segmento/...` do fim de `conversas.pagina_origem` e
`pedidos.origem` (cta cortado, de outro tipo ou fora do fim é ignorado), tabela com `caption` e `th scope`, total e "X de Y no
mês", troca de mês, mês vazio explicado, tempo real, nenhuma consulta nova ao abrir o Resumo, 4 larguras e axe.

`exportar-resumo.test.js` (Supabase falso) cobre o "Baixar CSV" da aba Resumo (melhoria 76): botão desligado antes dos dados,
arquivo `resumo-portfolio-br-AAAA-MM.csv` (BOM, ";" e CRLF) com os cartões do mês escolhido e do anterior, a tabela "De onde
vieram os pedidos" com total e observações; nenhum nome, e-mail, WhatsApp, código de pedido ou texto de visitante no arquivo;
nenhuma consulta nova; aviso em `role=status`; teclado; troca de mês, mês vazio, tempo real, escape de fórmula, 4 larguras e axe.

`checklist-pedido.test.js` (Supabase falso) cobre a lista de verificação por pedido aprovado no painel (melhoria 66):
cinco checkbox nativos com data de cada marcação, contagem "etapas N de 5" no cartão, teclado, aviso em `role=status`,
salvo só no `localStorage` do admin (id + datas), sincronia entre abas, armazenamento bloqueado, nada gravado no banco;
320/375/768/1280 px + axe.

`alvos-toque.test.js` (Supabase falso) cobre os alvos de toque (melhoria 68, WCAG 2.2 2.5.8): em 320 e 375 px, em todas as
páginas (com e sem o menu móvel aberto), no chat aberto e no painel (login, conversas, pedidos, detalhe, briefings, resumo),
cada link/botão/campo visível mede 24×24 CSS px ou tem espaçamento (círculo de 24 px sem encostar em outro alvo). Exceções:
link em texto corrido, `<label>` equivalente com 24 px, link esticado (`::after` no cartão), alvos cobertos ou `aria-hidden`.
Regra mais rígida que a WCAG: fora de texto corrido, nenhum alvo depende só do espaçamento (token `--alvo-minimo`).
Um controle injeta botões de 16 px colados para provar que o teste acusa o problema.

`atalhos-painel.test.js` (Supabase falso) cobre os atalhos do painel (melhoria 41): `g` + `c`/`p`/`b`/`r` trocam de aba
(e `g` esquecido por mais de 1,5 s não faz nada), `/` foca a busca da aba (Pedidos) ou a geral, nada dispara digitando num
campo, `j`/`k` andam na lista e `Enter` abre, o foco continua no mesmo item quando o tempo real redesenha a lista, `?` abre o
`<dialog>` (Esc fecha e devolve o foco), atalhos de uma tecla desligáveis e lembrados (WCAG 2.1.4), 4 larguras e axe.

`pedido-aberto.test.js` (Supabase e MP falsos) cobre o aviso "Você tem um pedido em aberto" de `planos.html` (melhoria 39):
volta do Mercado Pago sem pagar, "Concluir pagamento" reabrindo a **mesma** preferência (sem pedido duplicado nem nada novo
no `localStorage`), Pix em processamento recusado com mensagem, aviso sumindo depois do pagamento aprovado, token adulterado,
pedido com mais de 30 dias, sem dados pessoais na tela, 4 larguras, modo escuro e axe.

`form-celular.test.js` (só o servidor estático) cobre o formulário de contratação no celular (melhoria 46):
`autocomplete`/`inputmode`/`enterkeyhint`, máscara do WhatsApp (digitar, apagar com Backspace, colar, DDI, editar no meio
sem pular o cursor), validação só ao sair do campo, erro que some ao corrigir, descrição acessível (dica + erro) lida
da árvore de acessibilidade do Chromium, foco no primeiro erro ao enviar, 4 larguras e axe.

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

`contraste-escuro.test.js` (item 52) mede o contraste com cálculo próprio na home, planos e blog, nos temas escuro e
claro × 4 larguras: textos e placeholders (4,5:1, ou 3:1 em texto grande), bordas de campos e ícones (3:1). Esconde o que
está na frente, fotografa só o fundo e lê os pixels atrás de cada linha de texto, então vale também sobre gradientes
(onde o axe fica "incompleto"). Os `<details>` são abertos para medir as respostas do FAQ. Roda o axe junto.

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

## Peso e dimensões das imagens (melhoria 42)

```bash
node --test testes/funcoes/imagens.test.mjs   # sem navegador: limites de bytes, dimensões, <img> com width/height
node testes/imagens/otimizar.mjs              # otimiza SVG (regras próprias) e PNG sem perda (pyoxipng, opcional)
node testes/imagens/otimizar.mjs --verificar  # só confere
node testes/imagens/auditar.mjs               # navegador: tamanho real × exibido em todas as páginas (375/1280 px, densidade 2)
```

- `imagens.test.mjs` falha se uma imagem passar do limite do seu tipo (SVG 2 KB, ícone PNG 8 KB, ICO 4 KB,
  Open Graph 80 KB, portfólio WebP 150 KB / PNG 450 KB; JPG/GIF/AVIF não previstos), se as dimensões reais não
  baterem com o manifest/ícones/OG, se alguma `<img>` (no HTML ou criada pelo JS) não tiver `width`/`height`
  (ou tiver proporção diferente da do arquivo), se um SVG tiver `<script>`, eventos `on*`, `<foreignObject>` ou recurso
  externo, se ainda puder ser otimizado, ou se houver imagem órfã em `assets/img/`.
- `svg.mjs`: o otimizador (tira prólogo, comentários, metadados e restos de editor; arredonda números a 2 casas;
  encurta cores; junta espaços). Mantém `<title>`, `role` e `aria-*`.
- `otimizar.mjs` só troca um PNG se os pixels decodificados forem idênticos aos de antes. Na melhoria 42: 812 → 740 KB
  no total (ícones −9 a −26%, Open Graph −8 a −12%), sem mudar nenhum pixel. O `og/gerar.mjs` já aplica a mesma
  recompressão quando o pyoxipng está instalado.
- `auditar.mjs` grava `testes/e2e/saida/imagens.md` (arquivo, bytes, tamanho real e maior exibição) e sai com erro se uma
  `<img>` estiver sem `width`/`height` ou distorcida; imagens raster mais de 2× maiores que o necessário, ou menores
  (borradas), viram aviso.

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
ao trocar de plano) e a seção "Dúvidas antes de contratar" (só as perguntas de `config.faq` com `checkout: true`, com link
direto `#faq-...` e "Copiar link"), sem mudar o FAQ da home; 320/375/768/1280 px, claro e escuro, console e axe.
Melhoria 55: as dúvidas de compra cobrem prazo, o que acontece depois do pagamento, alterações e formas de pagamento,
e a página ganha um JSON-LD `FAQPage` próprio, validado (perguntas e respostas iguais às exibidas, `@id` e `url` da
página canônica, um único FAQPage na página, sem `[PROVISÓRIO]` nem HTML no texto).

`chat-acessivel.test.js` (Supabase falso + servidor estático) cobre a melhoria 36 no widget do chat, pela árvore de
acessibilidade do Playwright (`ariaSnapshot`, salva em `e2e/saida/chat-arvore-celular.txt`):
- abrir pelo teclado leva o foco ao primeiro campo; `Esc` fecha e devolve o foco ao botão (só quando o foco está no chat);
- no celular (painel em tela cheia) o diálogo é `aria-modal` e o `Tab` circula dentro dele; no computador não prende;
- rótulos "(opcional)" e descrições (dica do WhatsApp, aviso de privacidade, erro) dos campos;
- `aria-live` só numa região de anúncio: respostas novas do atendente (com o chat aberto ou fechado), nunca o
  histórico restaurado nem as mensagens do próprio visitante; axe e console limpos.

`chat-boas-vindas.test.js` (Supabase falso) cobre a primeira mensagem automática do chat por página (melhoria 48):
textos de `config.chat.boasVindas` sem promessa de prazo, planos, pedido/obrigado (`<main data-chat-contexto="pedido">`),
artigo do blog citando o título, padrão nas demais páginas, `config.chat` ausente ou texto vazio caindo no padrão,
conversa já iniciada noutra página abrindo com a saudação geral, 4 larguras, rolagem e axe no painel.

`sem-conexao.test.js` (sem Postgres: RPCs, Edge Functions e Realtime respondidos pelo Playwright) cobre a melhoria 53:
em planos, briefing, pedido e chat, sem internet (`setOffline`) ou com a requisição caindo (`abort('internetdisconnected')`)
aparece "Sem internet: …" com "Tentar de novo", nada do que foi digitado se perde, erros do servidor mantêm as mensagens
próprias, briefing e pedido consultam sozinhos quando a conexão volta (envios nunca são refeitos sozinhos), foco tratado
quando o botão some, 4 larguras, console limpo e axe. A lógica comum fica em `PBRRede` (`assets/js/main.js`).

## Fonte mais leve (melhoria 58)

```bash
pip install fonttools brotli --break-system-packages
python3 testes/fontes/subconjunto.py           # regrava assets/fonts/plus-jakarta-sans-latin-wght.woff2
python3 testes/fontes/subconjunto.py --checar  # confere se o arquivo servido está em dia
```

Parte da fonte original em `testes/fontes/original/` (Plus Jakarta Sans "latin", 27 KB) e gera o subconjunto
pt-BR com o eixo de peso 400–800 (~14 KB, mesmos desenhos: screenshots idênticos pixel a pixel). O teste
`testes/funcoes/fontes.test.mjs` trava o peso máximo, confere o `unicode-range` do `tokens.css` com a fonte e
falha se alguma página usar uma letra latina ou pontuação que a fonte não tenha (aí, acrescente-a à lista do script).

`resumo-erros.test.js` (só o servidor estático; RPCs do briefing respondidas pelo Playwright) cobre a melhoria 59:
resumo "Corrija N campos" no topo de `planos.html` e de cada etapa do `briefing.html` (padrão GOV.UK), com o foco ao
aparecer, um link por campo (Tab + Enter leva ao campo), `aria-invalid` + mensagem na descrição acessível de cada campo,
item que some quando o campo é corrigido, rótulo nos links repetidos ("Referência 1: ..."), movimento reduzido e
4 larguras × claro/escuro sem rolagem horizontal, com axe e console limpos.
