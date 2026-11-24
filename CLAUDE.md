# CLAUDE.md — Site da Portfólio BR

Guia de trabalho para quem programa este repositório (humano ou IA). Leia inteiro antes de mexer.

## O negócio

A **Portfólio BR** (Instagram [@portifolio_br](https://instagram.com/portifolio_br)) é uma microempresa que vende
sites profissionais para pequenos negócios do Brasil. Este repositório é o site da própria empresa:
ele vende os planos, recebe o pagamento, coleta o briefing e permite atendimento por chat ao vivo.

Um coordenador manda as tarefas por fases e revisa os PRs. **Ninguém faz merge do próprio PR** (o merge é feito
por quem revisa ou por pedido explícito do coordenador).

## Decisões fixas (não mudar sem aprovação do coordenador)

1. **Front:** HTML, CSS e JavaScript puros. Sem build, sem framework, sem bundler, sem npm em produção.
   Mobile-first. Hospedado no **GitHub Pages** (arquivos estáticos servidos da raiz da branch `main`).
2. **Back:** **Supabase**.
   - Banco Postgres com **RLS habilitado em todas as tabelas**, sem exceção. Políticas mínimas e explícitas.
   - **Auth só para o admin** (dono). Visitantes nunca fazem login.
   - **Realtime** para o chat ao vivo.
   - **Edge Functions** para o Mercado Pago:
     - `criar-pagamento`: cria a preferência do **Checkout Pro** e devolve a URL de pagamento.
     - `webhook-mercadopago`: recebe as notificações do MP, consulta o pagamento na API do MP e atualiza o pedido.
   - O **`MP_ACCESS_TOKEN` fica só nos secrets da Edge Function**. Nunca no front, nunca no repositório.
     No front só podem existir a URL do projeto Supabase e a chave pública (anon/publishable).
3. **Chat ao vivo:**
   - Widget flutuante em **todas** as páginas públicas.
   - Visitante identificado por um **id anônimo** gerado e salvo no navegador (`localStorage`).
   - Nome e WhatsApp do visitante são **opcionais**.
   - O dono responde por um **painel admin em tempo real**.
   - **Fora do horário de atendimento**, o widget oferece o WhatsApp.
4. **Páginas finais:** home de vendas, portfólio, planos com checkout, briefing pós-compra,
   termos de uso e política de privacidade (LGPD) e admin (chat, pedidos, leads).
5. **Honestidade:** nunca inventar depoimentos, números, estatísticas, logos ou clientes.
   Seções sem dados reais ficam **ocultas** (ex.: portfólio e depoimentos só aparecem com itens reais).
   Textos e preços provisórios são marcados com **`[PROVISÓRIO]`** e ficam **num único objeto de
   configuração: `config.js`** (raiz do projeto).
6. **Fluxo Git:** o commit inicial na `main` tem só `README.md` e `CLAUDE.md`. Cada fase vai numa
   branch própria com PR para a `main`. Não fazer merge: o coordenador revisa.

## Estado atual

As 5 fases estão concluídas. O site está pronto e em **rascunho** (`rascunho: true` + `noindex`) até o dono
preencher os itens `[PROVISÓRIO]` do `config.js`. Para publicar, siga o **`PUBLICAR.md`**.

## Estrutura de pastas

```
/
├── index.html                 # Home de vendas (Fase 1)
├── portfolio.html             # Portfólio (Fase 4)
├── exemplos.html              # 6 sites de EXEMPLO por segmento (melhoria 3)
├── exemplos/                  # moda, restaurante, beleza, saude, servicos, pet: fictícios, sempre noindex
├── blog/                      # index.html + 3 artigos + autor.html (ProfilePage) + feed.xml (RSS); JSON-LD validado em testes/funcoes/blog-seo.test.mjs
├── segmentos/                 # 6 páginas de SEO por segmento (JSON-LD Service), geradas por testes/segmentos/gerar.py
├── planos.html                # Planos + checkout Mercado Pago (Fase 3)
├── obrigado.html              # Retorno do checkout: status pela RPC pedido_consultar (Fase 3)
├── pedido.html                # Cliente acompanha as etapas (RPC pedido_acompanhar, código + token; melhoria 30)
├── briefing.html              # Briefing pós-compra (Fase 4)
├── termos.html                # Termos de uso (Fase 4)
├── privacidade.html           # Política de privacidade / LGPD (Fase 4)
├── 404.html                   # Página de erro do GitHub Pages: caminhos ABSOLUTOS /empresa-jp/ (Fase 5)
├── PUBLICAR.md                # Checklist para tirar o rascunho e publicar
├── admin/
│   └── index.html             # Painel do dono: chat, pedidos, leads (Fase 2+)
├── config.js                  # ÚNICO lugar de textos/preços/contatos provisórios
├── manifest.webmanifest
├── robots.txt
├── sitemap.xml
├── .nojekyll                  # GitHub Pages serve os arquivos como estão
├── assets/
│   ├── css/
│   │   ├── tokens.css         # Variáveis: cores, tipografia, espaçamento, raios, sombras
│   │   ├── main.css           # Reset, layout e componentes comuns a todas as páginas
│   │   ├── home.css           # Só da home (hero/mockup, para quem, passos, simulador, CTA, abertura): logo após main.css
│   │   ├── chat.css           # Widget do chat (Fase 2)
│   │   ├── movimento.css      # Animações de rolagem comuns (a abertura de marca fica em home.css)
│   │   ├── checkout.css       # planos.html, obrigado.html, pedido.html e portfolio.html (Fase 3)
│   │   ├── briefing.css       # briefing.html em etapas (Fase 4)
│   │   ├── legal.css          # termos.html e privacidade.html (Fase 4)
│   │   ├── exemplos.css       # exemplos.html e exemplos/*.html (paletas --exemplo-* em tokens.css)
│   │   ├── blog.css           # blog/: lista de artigos e texto longo legível
│   │   ├── segmentos.css      # segmentos/: benefícios, checklist e cartão do exemplo (usa blog.css + exemplos.css)
│   │   └── admin.css          # Painel /admin/ (Fase 2+)
│   ├── js/
│   │   ├── inicio.js          # Síncrono no <head>: classes sem-js/modo-rascunho antes da 1ª pintura
│   │   ├── main.js            # Renderiza conteúdo do config.js, menu, JSON-LD dos planos, utilidades, prefetch de planos/exemplos
│   │   ├── abertura.js        # Pular/encerrar a abertura de marca (a animação é CSS)
│   │   ├── revelar.js         # Rolagem: seções/cards revelados, sublinhado dos títulos, celular 3D, linha do tempo
│   │   ├── mockup.js          # Celular do hero alterna 3 sites de EXEMPLO (com botão de pausa)
│   │   ├── simulador.js       # Home: "Qual plano é para mim?" (regras em config.simulador)
│   │   ├── comparativo.js     # planos.html#comparativo: tabela (≥48rem) e abas no celular (config.comparativo)
│   │   ├── tema.js            # Botão do modo escuro (a escolha é aplicada antes da pintura pelo inicio.js)
│   │   ├── origem.js          # utm_* + domínio de referência na chegada → chat (pagina_origem) e pedido (origem)
│   │   ├── chat.js            # Widget do chat ao vivo (Fase 2); supabase-js só ao abrir/intenção ou com conversa salva; boas-vindas por página (config.chat, melhoria 48)
│   │   ├── planos.js          # Formulário de contratação → Edge Function criar-pagamento (Fase 3) + aviso de pedido em aberto (reabrir, melhoria 39) + máscara/validação ao sair (46)
│   │   ├── obrigado.js        # Retorno do Mercado Pago e consulta do status (Fase 3)
│   │   ├── pedido.js          # Etapas do pedido para o cliente (pago → briefing → produção → entregue)
│   │   ├── admin.js           # Painel: login, abas, conversas em tempo real (Fase 2+)
│   │   ├── admin-respostas.js # Respostas rápidas do chat do painel (localStorage do admin)
│   │   ├── admin-pedidos.js   # Aba Pedidos do painel (Fase 3) + checkout abandonado/WhatsApp (melhoria 23)
│   │   ├── admin-briefings.js # Aba Briefings do painel (Fase 4)
│   │   ├── admin-avisos.js    # Painel: não lidas no título/favicon e notificações do navegador (melhoria 8)
│   │   ├── admin-exportar.js  # Painel: filtros de período/origem e CSV gerado no navegador (melhoria 20)
│   │   ├── admin-resumo.js    # Painel: aba Resumo do mês (cartões e comparação, só com dados já carregados; melhoria 32)
│   │   ├── admin-busca.js     # Painel: busca global nas três abas (dados já carregados, teclado; melhoria 37)
│   │   ├── admin-paginacao.js # Painel: listas em páginas de 50, "Mostrando X de Y" e "Carregar mais" (melhoria 49)
│   │   ├── admin-atalhos.js   # Painel: atalhos g c/p/b/r, /, j/k e ? (desligáveis, WCAG 2.1.4); foco mantido no redesenho (melhoria 41)
│   │   ├── briefing.js        # Briefing em etapas + upload por URL assinada (Fase 4); rascunho local com retomada da etapa (melhoria 43)
│   │   ├── legal.js           # Preenche termos/privacidade com dados do config.js (Fase 4)
│   │   └── supabase-client.js # Carrega supabase-js do CDN (versão fixa + SRI) sob demanda
│   ├── fonts/                 # Fontes self-hosted (sem Google Fonts: LGPD + desempenho)
│   └── img/                   # Logo, favicon, ícones, imagem Open Graph (og/: uma por página, gerada por testes/og/gerar.mjs)
│                              #   peso/dimensões checados por testes/funcoes/imagens.test.mjs; otimizar: testes/imagens/otimizar.mjs
├── testes/                    # Testes locais (Node/Playwright, MP e Supabase falsos) — não publicados
│                              #   portfolio/gerar.py: imagens responsivas do portfólio (WebP+PNG 480/800/1200, sem EXIF)
└── supabase/
    ├── README.md              # Ordem das migrations, configurações e primeiro admin
    ├── migrations/            # SQL versionado e idempotente (tabelas, RLS, políticas) (Fase 2+)
    ├── tests/                 # Stubs do Supabase + testes SQL para Postgres local
    ├── config.toml            # verify_jwt = false nas Edge Functions (validam por conta própria)
    └── functions/
        ├── _shared/                # Lógica testável (só APIs Web; roda no Deno e no Node 22+)
        ├── criar-pagamento/        # Edge Function (Fase 3)
        ├── webhook-mercadopago/    # Edge Function (Fase 3)
        └── briefing-upload/        # Edge Function: URL assinada do Storage (Fase 4)
```

## Identidade visual (definida na Fase 1)

- Tokens em `assets/css/tokens.css`. Componentes usam os papéis semânticos (`--cor-acao`, `--cor-texto`...).
- **Azul-noite** `#0B1630` (texto, fundos escuros) · **Verde-mata** `#077A57` (ação principal) ·
  **Amarelo-sol** `#FFC83D` (destaques pontuais, foco) · neutros frios `#F6F7FA` / `#DCE1EA` / `#566074`.
- Fonte única: **Plus Jakarta Sans** (variável, self-hosted, licença OFL em `assets/fonts/`).
- Convenções: classes em português no estilo BEM (`bloco__elemento--modificador`);
  ganchos de JS em atributos `data-*`, nunca em classes de estilo.

## Regras de qualidade

**Páginas estáticas (sem build)**
- `<head>`, cabeçalho e rodapé se repetem em todas as páginas. Ao mudar um deles, mude em **todas**; o teste
  `testes/funcoes/paginas.test.mjs` compara cada página com a home (CSP, cabeçalho, rodapé, canonical, OG, noindex).
- `config.js` e `assets/js/inicio.js` são os **únicos** scripts síncronos; todo o resto com `defer`.

**Segurança**
- **CSP** por `<meta http-equiv>` em todas as páginas (o GitHub Pages não permite cabeçalhos): sem `unsafe-inline`,
  sem `unsafe-eval`. Nada de `<script>` ou `style=""` inline (o JSON-LD é permitido por não ser executado).
  `connect-src` lista o Supabase do `config.js`; `script-src` lista a versão exata do supabase-js.
- Links externos com `target="_blank"` sempre com `rel="noopener"`.
- Imagens com limite de bytes por tipo, `width`/`height` sempre (inclusive as criadas pelo JS) e SVG sem script/recurso
  externo (`testes/funcoes/imagens.test.mjs`); antes de commitar imagem nova, rode `node testes/imagens/otimizar.mjs`.
- Imagens só da própria origem (`img-src 'self' data:`): portfólio em `assets/img/portfolio/`, geradas por
  `testes/portfolio/gerar.py` e usadas pelo campo `foto` (`<picture>` com `srcset`/`sizes`, WebP + PNG).

**Geral**
- Sem dependências de build. Bibliotecas externas só via CDN com **versão exata** e, quando possível, SRI.
- Sem segredos no repositório. Chaves de serviço (`service_role`, `MP_ACCESS_TOKEN`) só em secrets do Supabase.
- Código e comentários em português quando falarem do negócio; nomes de variáveis claros.
- Todo conteúdo dinâmico vindo de usuário é inserido com `textContent` (nunca `innerHTML` com dados externos).

**Layout e responsividade**
- Mobile-first: CSS base para celular, `min-width` nas media queries.
- **Sem rolagem horizontal a 320 px.** Testar pelo menos em 320, 375, 768 e 1280 px.
- Usar só as variáveis de `assets/css/tokens.css` para cor, fonte, espaçamento, raio e sombra.
- **Modo escuro:** só os papéis semânticos (`--cor-fundo`, `--cor-texto`, `--cor-acao`...) mudam no escuro. Componentes
  usam papéis, não a paleta crua (`--cor-noite-900` etc.), exceto o que é fixo de propósito (selos amarelos, telas de
  exemplo). Sites de exemplo e `/admin/` têm `data-tema-fixo` (sempre claros). `testes/e2e/tema.test.js` roda o axe no escuro.

**Acessibilidade (WCAG 2.1 AA como meta)**
- `lang="pt-BR"`, landmarks (`header`, `nav`, `main`, `footer`), um único `h1` por página, hierarquia de títulos.
- Link "Pular para o conteúdo", foco visível, navegação completa por teclado.
- Contraste mínimo 4,5:1 em texto normal e 3:1 em texto grande/ícones.
- Imagens com `alt` (vazio quando decorativas), botões com rótulo acessível.
- Respeitar `prefers-reduced-motion`.

**Animações**
- Só CSS/JS próprios (sem bibliotecas; a CSP bloqueia CDNs novos). Animações contínuas só com `transform`/`opacity`.
- Nada fica escondido sem JavaScript: os estados iniciais ocultos dependem de classes postas pelo JS
  (`com-abertura` pelo `inicio.js`, `revelar-ativo` pelo `revelar.js`).
- Com `prefers-reduced-motion`: sem abertura e sem animações de rolagem.
- Transições de "aparecer" ficam só no estado final (esconder é instantâneo), para nada esmaecer na carga
  nem ser pego pelo axe/Lighthouse no meio da transição. CLS sempre 0 (`testes/e2e/movimento.test.js`).
- A abertura é `aria-hidden`, uma vez por sessão (`sessionStorage`), pulável por toque, clique ou tecla.
- Movimento automático com mais de 5 s precisa de botão de pausa (WCAG 2.2.2), como no mockup do hero.
- Hover de cards usa a propriedade `translate` (não `transform`), para somar com a revelação da rolagem.
  Botões com envio demorado ganham `data-carregando` (indicador no lugar do ícone; parado com movimento reduzido).
- Exemplos fictícios (ex.: telas do mockup) sempre com o rótulo "exemplo" visível e nomes genéricos ("Sua Loja").

**SEO e desempenho**
- Cada página com `title`, `meta description`, Open Graph, `canonical`, favicon e manifest.
- CSS por página: regra usada só numa página vai no CSS dela (`home.css`, `checkout.css`...), não em `main.css`
  (teste `testes/e2e/css-critico.test.js`). Conteúdo preenchido pelo JS acima da dobra reserva o espaço (CLS 0).
- Fonte self-hosted com `font-display: swap`; scripts com `defer`; imagens com `width`/`height` e `loading="lazy"` abaixo da dobra.
- Enquanto `config.js` tiver `rascunho: true`, a página mostra o aviso de rascunho e mantém `noindex`.
- Meta: Lighthouse mobile ≥ 90 nas quatro categorias (medido na Fase 5: 99/100/100/100 nas páginas públicas).

**Antes de abrir um PR**
- Rodar a auditoria (`testes/e2e/auditoria.test.js`): todas as páginas × 4 larguras, axe, teclado, console, rolagem.
- Zero erros no console em todas as páginas alteradas (inclusive violações de CSP).
- Teste em largura de celular (320 e 375 px) e desktop (1280 px), sem rolagem horizontal.
- Verificação automática de acessibilidade (axe) sem violações sérias/críticas.
- Descrever no PR o que foi feito, como testar e o que ficou `[PROVISÓRIO]`.

**Supabase (a partir da Fase 2)**
- Migrations idempotentes (`if not exists`, `create or replace`, `drop policy if exists`), testadas com
  `supabase/tests/rodar_local.sh` (aplica duas vezes e roda os testes).
- Toda tabela nasce com `alter table ... enable row level security` e políticas na mesma migration.
- Funções `security definer` sempre com `set search_path = ''` e nomes qualificados; `revoke ... from public`
  e `grant execute` só para quem precisa.
- Visitante anônimo nunca acessa tabelas diretamente: só RPCs que validam o token secreto do navegador.
- Visitante anônimo só lê/escreve o que é dele (filtrado pelo id anônimo); admin identificado por Auth.
- Pedidos só mudam de status pelo webhook (service role dentro da Edge Function), nunca pelo front.
- Webhook do MP valida a assinatura (`x-signature`) e confere o pagamento consultando a API do MP.
- Arquivos de clientes só em bucket **privado**, enviados por URL assinada criada por Edge Function após validar
  código + token, tipo e tamanho; leitura só para admin.
- Páginas legais leem os dados do controlador do `config.js` e mostram `[PROVISÓRIO: ...]` quando faltam.
- O preço cobrado vem da tabela `planos`, nunca do front; `config.js` só exibe (teste `precos.test.mjs` compara).
- Edge Functions: lógica em `functions/_shared/*.ts` sem imports externos (só `fetch`/`crypto.subtle`), para
  rodar no Deno e ser testada no Node (`node --test testes/funcoes/`).

## Fases

1. **Estrutura e home** — CLAUDE.md, identidade visual (tokens CSS), home de vendas completa,
   `config.js`, SEO básico, acessibilidade, botão flutuante reservado para o chat.
2. **Supabase e chat ao vivo** — migrations com RLS, widget de chat em todas as páginas,
   painel admin com login e respostas em tempo real, horário de atendimento e fallback para WhatsApp, leads.
3. **Planos e checkout Mercado Pago** — página de planos, Edge Functions `criar-pagamento` e
   `webhook-mercadopago`, tabela de pedidos, página de retorno, pedidos no admin.
4. **Briefing, páginas legais e portfólio** — formulário de briefing pós-compra ligado ao pedido,
   termos de uso, política de privacidade (LGPD), página de portfólio (oculta sem projetos reais).
5. **Revisão final e publicação** — auditoria completa (acessibilidade, teclado, console), CSP, SEO
   (404, sitemap, robots, canonical/OG, JSON-LD), desempenho (Lighthouse mobile ≥ 90) e `PUBLICAR.md`.
   O rascunho continua até o dono preencher os `[PROVISÓRIO]`; a publicação segue o `PUBLICAR.md`.

Todas as fases (1–5) estão concluídas.

## Como rodar localmente

Não há build. Sirva a pasta raiz com qualquer servidor estático, por exemplo:

```bash
python3 -m http.server 8080
```

e abra http://localhost:8080.
