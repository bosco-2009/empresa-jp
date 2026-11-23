# Portfólio BR — site oficial

Site da **Portfólio BR** ([@portifolio_br](https://instagram.com/portifolio_br)), microempresa que cria sites
profissionais para pequenos negócios do Brasil.

**Endereço:** https://bosco-2009.github.io/empresa-jp/
**Estado:** pronto, em **rascunho** (`noindex`), aguardando os dados do dono. Para publicar, siga o [PUBLICAR.md](PUBLICAR.md).

## O que o site faz

| Página | Para quê |
|---|---|
| `index.html` | Home de vendas: serviços, como funciona, planos, garantias, dúvidas |
| `planos.html` | Escolha do plano e checkout pelo **Mercado Pago** (Pix, boleto, cartão) |
| `obrigado.html` | Retorno do pagamento: status real do pedido e acesso ao briefing |
| `pedido.html` | O cliente acompanha as etapas do pedido (pago → briefing recebido → em produção → entregue) |
| `briefing.html` | Briefing pós-compra em 5 etapas, com envio de logo, fotos e PDFs |
| `portfolio.html` | Projetos reais (página e link do menu ocultos enquanto não houver projetos) |
| `termos.html` / `privacidade.html` | Termos de uso (CDC) e política de privacidade (LGPD) |
| `404.html` | Página de erro do GitHub Pages |
| `admin/` | Painel do dono: **Conversas** (chat em tempo real), **Pedidos** e **Briefings** |

Em todas as páginas públicas há um **chat ao vivo**. Fora do horário de atendimento, ele oferece o WhatsApp.

## Como funciona

- **Front:**
  - HTML, CSS e JavaScript puros, sem build, mobile-first;
  - publicado no GitHub Pages a partir da raiz da `main`;
  - CSP por meta tag, fonte self-hosted, sem cookies nem analytics.
- **Back:** Supabase (projeto `mqjpccrxsyajcgbdifld`):
  - Postgres com **RLS em todas as tabelas**: o visitante só acessa por funções que validam um token secreto do navegador;
  - Auth só para o admin;
  - Realtime no chat e no painel;
  - Storage privado para os arquivos do briefing;
  - Edge Functions:
    - `criar-pagamento`: Checkout Pro, com o preço vindo do servidor;
    - `webhook-mercadopago`: valida `x-signature`, consulta a API do MP e é idempotente;
    - `briefing-upload`: URL assinada do Storage.
- **Segredos** (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, chave de serviço) ficam **só** nos secrets do Supabase.
  No front existem apenas a URL do projeto e a chave publicável.

## Onde editar

- **Textos, preços, contatos, horários, políticas, portfólio:** `config.js`. Tudo que ainda depende do dono está marcado `[PROVISÓRIO]`.
- **Banco, Edge Functions e deploy:** [`supabase/README.md`](supabase/README.md) (ordem das migrations, secrets, webhook, primeiro admin).
- **Publicação:** [`PUBLICAR.md`](PUBLICAR.md).
- **Regras para quem programa:** [`CLAUDE.md`](CLAUDE.md).

## Rodar localmente

Não há build. Sirva a pasta raiz com um servidor estático:

```bash
python3 -m http.server 8080
```

Depois abra http://localhost:8080.

## Testes

Veja [`testes/README.md`](testes/README.md). Resumo:
- **SQL:** migrations, RLS e limites num Postgres local.
- **Unitários:** Edge Functions, preços `config.js` × banco e consistência entre as páginas.
- **Ponta a ponta:** chat, checkout com Mercado Pago falso, briefing com upload e painel, com Playwright e um Supabase
  falso sobre o Postgres real.
- **Auditoria:** todas as páginas em 320/375/768/1280 px (axe, teclado, console, rolagem horizontal).
