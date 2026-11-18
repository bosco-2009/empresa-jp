# CLAUDE.md — Site da Portfólio BR

Guia de trabalho para quem programa este repositório (humano ou IA). Leia inteiro antes de mexer.

## O negócio

A **Portfólio BR** (Instagram [@portifolio_br](https://instagram.com/portifolio_br)) é uma microempresa que vende
sites profissionais para pequenos negócios do Brasil. Este repositório é o site da própria empresa:
ele vende os planos, recebe o pagamento, coleta o briefing e permite atendimento por chat ao vivo.

Um coordenador manda as tarefas por fases e revisa os PRs. **Ninguém faz merge do próprio PR.**

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

## Estrutura de pastas (planejada)

```
/
├── index.html                 # Home de vendas (Fase 1)
├── portfolio.html             # Portfólio (Fase 4)
├── planos.html                # Planos + checkout Mercado Pago (Fase 3)
├── obrigado.html              # Retorno do checkout (Fase 3)
├── briefing.html              # Briefing pós-compra (Fase 4)
├── termos.html                # Termos de uso (Fase 4)
├── privacidade.html           # Política de privacidade / LGPD (Fase 4)
├── 404.html                   # Página de erro do GitHub Pages (Fase 5)
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
│   │   └── main.css           # Reset, layout e componentes
│   ├── js/
│   │   ├── main.js            # Renderiza conteúdo do config.js, menu, utilidades
│   │   ├── chat-widget.js     # Widget do chat (Fase 2)
│   │   └── supabase-client.js # Cliente Supabase via CDN com versão fixa (Fase 2)
│   ├── fonts/                 # Fontes self-hosted (sem Google Fonts: LGPD + desempenho)
│   └── img/                   # Logo, favicon, ícones, imagem Open Graph
└── supabase/
    ├── migrations/            # SQL versionado (tabelas, RLS, políticas) (Fase 2+)
    └── functions/
        ├── criar-pagamento/        # Edge Function (Fase 3)
        └── webhook-mercadopago/    # Edge Function (Fase 3)
```

## Identidade visual (definida na Fase 1)

- Tokens em `assets/css/tokens.css`. Componentes usam os papéis semânticos (`--cor-acao`, `--cor-texto`...).
- **Azul-noite** `#0B1630` (texto, fundos escuros) · **Verde-mata** `#077A57` (ação principal) ·
  **Amarelo-sol** `#FFC83D` (destaques pontuais, foco) · neutros frios `#F6F7FA` / `#DCE1EA` / `#566074`.
- Fonte única: **Plus Jakarta Sans** (variável, self-hosted, licença OFL em `assets/fonts/`).
- Convenções: classes em português no estilo BEM (`bloco__elemento--modificador`);
  ganchos de JS em atributos `data-*`, nunca em classes de estilo.

## Regras de qualidade

**Geral**
- Sem dependências de build. Bibliotecas externas só via CDN com **versão exata** e, quando possível, SRI.
- Sem segredos no repositório. Chaves de serviço (`service_role`, `MP_ACCESS_TOKEN`) só em secrets do Supabase.
- Código e comentários em português quando falarem do negócio; nomes de variáveis claros.
- Todo conteúdo dinâmico vindo de usuário é inserido com `textContent` (nunca `innerHTML` com dados externos).

**Layout e responsividade**
- Mobile-first: CSS base para celular, `min-width` nas media queries.
- **Sem rolagem horizontal a 320 px.** Testar pelo menos em 320, 375, 768 e 1280 px.
- Usar só as variáveis de `assets/css/tokens.css` para cor, fonte, espaçamento, raio e sombra.

**Acessibilidade (WCAG 2.1 AA como meta)**
- `lang="pt-BR"`, landmarks (`header`, `nav`, `main`, `footer`), um único `h1` por página, hierarquia de títulos.
- Link "Pular para o conteúdo", foco visível, navegação completa por teclado.
- Contraste mínimo 4,5:1 em texto normal e 3:1 em texto grande/ícones.
- Imagens com `alt` (vazio quando decorativas), botões com rótulo acessível.
- Respeitar `prefers-reduced-motion`.

**SEO e desempenho**
- Cada página com `title`, `meta description`, Open Graph, `canonical`, favicon e manifest.
- Fonte self-hosted com `font-display: swap`; scripts com `defer`; imagens com `width`/`height` e `loading="lazy"` abaixo da dobra.
- Enquanto `config.js` tiver `rascunho: true`, a página mostra o aviso de rascunho e mantém `noindex`.

**Antes de abrir um PR**
- Zero erros no console em todas as páginas alteradas.
- Teste em largura de celular (320 e 375 px) e desktop (1280 px), sem rolagem horizontal.
- Verificação automática de acessibilidade (axe) sem violações sérias/críticas.
- Descrever no PR o que foi feito, como testar e o que ficou `[PROVISÓRIO]`.

**Supabase (a partir da Fase 2)**
- Toda tabela nasce com `alter table ... enable row level security` e políticas na mesma migration.
- Visitante anônimo só lê/escreve o que é dele (filtrado pelo id anônimo); admin identificado por Auth.
- Pedidos só mudam de status pelo webhook (service role dentro da Edge Function), nunca pelo front.
- Webhook do MP valida a assinatura (`x-signature`) e confere o pagamento consultando a API do MP.

## Fases

1. **Estrutura e home** — CLAUDE.md, identidade visual (tokens CSS), home de vendas completa,
   `config.js`, SEO básico, acessibilidade, botão flutuante reservado para o chat.
2. **Supabase e chat ao vivo** — migrations com RLS, widget de chat em todas as páginas,
   painel admin com login e respostas em tempo real, horário de atendimento e fallback para WhatsApp, leads.
3. **Planos e checkout Mercado Pago** — página de planos, Edge Functions `criar-pagamento` e
   `webhook-mercadopago`, tabela de pedidos, página de retorno, pedidos no admin.
4. **Briefing, páginas legais e portfólio** — formulário de briefing pós-compra ligado ao pedido,
   termos de uso, política de privacidade (LGPD), página de portfólio (oculta sem projetos reais).
5. **Revisão final e publicação** — revisão completa (acessibilidade, SEO, segurança, RLS),
   preenchimento dos itens `[PROVISÓRIO]` pelo dono, `rascunho: false`, remoção do `noindex`,
   `404.html`, sitemap final e publicação no GitHub Pages.

## Como rodar localmente

Não há build. Sirva a pasta raiz com qualquer servidor estático, por exemplo:

```bash
python3 -m http.server 8080
```

e abra http://localhost:8080.
