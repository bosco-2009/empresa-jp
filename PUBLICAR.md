# Checklist de publicação — Portfólio BR

Hoje o site está em **rascunho**:
- `config.js` com `rascunho: true`;
- faixa amarela no topo das páginas;
- `<meta name="robots" content="noindex, nofollow">` nas páginas públicas.

Siga os passos **na ordem**. Cada passo diz o arquivo e o que mudar.

---

## 1. Preencher os dados do negócio (`config.js`)

Procure por `[PROVISÓRIO]` no `config.js`. Todos precisam ser **confirmados ou preenchidos**. Ao terminar, apague
o comentário `// [PROVISÓRIO]` de cada linha revisada.

| Campo | Onde aparece | Exemplo |
|---|---|---|
| `empresa.razaoSocial` | rodapé, termos, privacidade, dados estruturados | `'Fulano de Tal ME'` |
| `empresa.cnpj` | rodapé, termos, privacidade | `'00.000.000/0001-00'` |
| `empresa.cidade` | rodapé, termos, privacidade | `'São Paulo/SP'` |
| `contato.whatsapp` | botões, chat fora do horário, rodapé, termos, privacidade | `'5511999999999'` (só dígitos, com 55 e DDD) |
| `contato.whatsappMensagem` | mensagem pronta do WhatsApp | texto livre |
| `contato.email` | rodapé, termos, privacidade (contato do controlador LGPD) | `'contato@seudominio.com.br'` |
| `atendimento.horarios` e `atendimento.textoHorario` | chat (online/offline) | dias 0–6, `'HH:MM'` |
| `pagamento.textoParcelamento` | planos | confirmar as parcelas configuradas no Mercado Pago |
| `planos` (nomes, preços, itens, prazos, ajustes) | home, planos, termos, dados estruturados | ver o passo 2 |
| `garantias` | home | confirmar cada política |
| `faq` | home | revisar as respostas |
| `legal.*` (data, retenção, suporte, prazos, cancelamento) | termos e privacidade | ver o passo 3 |
| `portfolio.projetos` | home, menu, portfólio | só projetos **reais e autorizados** (ver o passo 5) |
| `depoimentos` | home | só depoimentos **reais e autorizados** |

Depois de preenchido, termos e privacidade não podem mais mostrar nenhum `[PROVISÓRIO: …]` na tela.

## 2. Preços: `config.js` **e** banco

O preço **exibido** vem do `config.js`; o preço **cobrado** vem da tabela `public.planos` do Supabase.
Se mudar algum preço, nome ou id de plano, rode no SQL Editor do Supabase (ajuste os valores):

```sql
update public.planos set nome = 'Essencial', valor_centavos = 49700, atualizado_em = now() where id = 'essencial';
```

O teste `node --test testes/funcoes/precos.test.mjs` compara o `config.js` com os valores das migrations. Se o banco
de produção foi alterado só pelo SQL Editor, confira à mão: `select id, nome, valor_centavos, ativo from public.planos;`

## 3. Textos legais

- Revisar `termos.html` e `privacidade.html` com um(a) advogado(a), principalmente `legal.cancelamentoApos7Dias` e os
  prazos de retenção (`legal.retencao*`; o de pedidos, com o contador).
- Atualizar `legal.atualizadoEm` com a data da revisão.

## 4. Mercado Pago em produção

1. Supabase → Edge Functions → Secrets:
   - `MP_ACCESS_TOKEN` com o token de **produção** (`APP_USR-...`);
   - `MP_WEBHOOK_SECRET` com a assinatura do webhook de produção.
2. Mercado Pago → Suas integrações → Webhooks (**modo produção**):
   - URL: `https://mqjpccrxsyajcgbdifld.supabase.co/functions/v1/webhook-mercadopago`
   - Evento: **Pagamentos**
3. Se `MP_SANDBOX=true` foi usado nos testes, **remova** esse secret.
4. Teste com uma compra real de valor baixo (plano temporário ativo só para o teste) e confira:
   - o status em `obrigado.html`;
   - o pedido na aba Pedidos do painel;
   - o reembolso pelo painel do MP, que deve mudar o pedido para "reembolsado".

**Origem dos clientes (melhoria 10):** confira se a migration `20261121120000_origem_visitante.sql` foi aplicada
(SQL Editor: `select origem from public.pedidos limit 1;` não pode dar erro) e publique de novo a `criar-pagamento`
(`supabase functions deploy criar-pagamento --no-verify-jwt`). Para links de divulgação, use parâmetros de campanha,
por exemplo na bio do Instagram: `…/empresa-jp/?utm_source=instagram&utm_medium=bio`. O painel mostra a origem em
cada pedido e no "veio de" de cada conversa.

## 5. Portfólio (quando houver projetos)

1. Salve a captura de tela do site (PNG ou JPG, de preferência com 1200 px de largura ou mais) em
   `testes/portfolio/originais/<nome>.png`, com o nome só em minúsculas, números e hífen (ex.: `loja-da-ana.png`).
   Essa pasta fica fora do Git. Depois rode `python3 testes/portfolio/gerar.py`: ele corta em 4:3, remove os
   metadados e grava `assets/img/portfolio/<nome>-480|800|1200.webp|png` (o navegador escolhe o tamanho certo).
   **Imagens externas são bloqueadas pela CSP.**
2. Adicione o projeto em `config.js` (`foto` é o nome sem extensão):
   ```js
   { nome: 'Nome do cliente', segmento: 'Segmento', url: 'https://...', foto: 'loja-da-ana', alt: 'Página inicial do site da …' }
   ```
   Rode `node --test testes/funcoes/*.test.mjs`: ele confere se as 6 imagens de cada `foto` existem.
3. Inclua `portfolio.html` no `sitemap.xml`:
   ```xml
   <url><loc>https://bosco-2009.github.io/empresa-jp/portfolio.html</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
   ```
O link "Portfólio" aparece sozinho no menu e no rodapé quando a lista deixa de estar vazia.

## 6. Tirar o rascunho

1. `config.js` → `rascunho: false`.
2. Remover estas duas linhas de **`index.html`, `planos.html`, `termos.html`, `privacidade.html` e `portfolio.html`**:
   ```html
   <!-- Rascunho: remover esta linha ao publicar, junto com rascunho: false no config.js (ver PUBLICAR.md) -->
   <meta name="robots" content="noindex, nofollow">
   ```
   **Não** remova o `noindex` de `obrigado.html`, `briefing.html`, `pedido.html`, `404.html` e `admin/index.html`: elas nunca
   devem ser indexadas (o comentário delas é diferente).
3. Rode `node --test testes/funcoes/*.test.mjs`. O teste "noindex" confere se as páginas certas ficaram com ou sem `noindex`.

## 7. Publicar no GitHub Pages

1. GitHub → repositório → Settings → Pages:
   - **Source:** Deploy from a branch;
   - **Branch:** `main`, pasta `/ (root)`.
2. Aguarde o deploy e abra `https://bosco-2009.github.io/empresa-jp/`.
3. Marque **Enforce HTTPS**.

### Se usar domínio próprio (opcional)

Troque `https://bosco-2009.github.io/empresa-jp/` pelo novo endereço em **todos** estes lugares:
- `config.js` → `site.url`;
- `canonical`, `og:url`, `og:image` e o JSON-LD nas páginas (procure por `bosco-2009.github.io`);
- `sitemap.xml` e `robots.txt`;
- `404.html`: troque o prefixo `/empresa-jp/` por `/` em todos os `href`/`src`;
- Supabase → secrets `SITE_URL` e `ORIGENS_PERMITIDAS` (CORS das Edge Functions);
- Supabase → Authentication → URL Configuration → Site URL.

Depois crie o arquivo `CNAME` com o domínio e configure o DNS conforme a documentação do GitHub Pages.

## 8. Conferir depois de publicar

- [ ] Home, planos, termos, privacidade e portfólio abrem sem a faixa de rascunho e sem `[PROVISÓRIO]` na tela.
- [ ] Console do navegador sem erros (inclusive avisos de CSP) em todas as páginas.
- [ ] Chat:
  - [ ] mensagem enviada aparece no painel `/admin/`;
  - [ ] a resposta do painel chega ao visitante em tempo real;
  - [ ] fora do horário, o widget oferece o WhatsApp.
- [ ] Compra real de teste (passo 4):
  - [ ] o pagamento aprovado aparece na aba Pedidos;
  - [ ] `obrigado.html` mostra o botão do briefing e o link "Acompanhar meu pedido";
  - [ ] `pedido.html` mostra as etapas, e mudar a etapa no detalhe do pedido do painel aparece para o cliente ao atualizar;
  - [ ] o briefing com upload de uma imagem aparece na aba Briefings, e o arquivo baixa.
- [ ] `https://bosco-2009.github.io/empresa-jp/qualquer-coisa` mostra a página 404 do site, com estilo e links funcionando.
- [ ] [Rich Results Test](https://search.google.com/test/rich-results) na home: Organization e Service sem erros.
- [ ] Prévia de compartilhamento (WhatsApp/Instagram/[opengraph.xyz](https://www.opengraph.xyz/)) com a imagem 1200×630.
- [ ] Google Search Console: adicionar a propriedade e enviar `https://bosco-2009.github.io/empresa-jp/sitemap.xml`.
- [ ] Lighthouse mobile (aba anônima) em home e planos: desempenho, acessibilidade, boas práticas e SEO ≥ 90.

## 9. Manutenção

- **Projeto Supabase ou versão do supabase-js mudou?** Atualize a CSP (`<meta http-equiv="Content-Security-Policy">`)
  em todas as páginas e no `admin/index.html`. O teste `paginas.test.mjs` confere se estão iguais e coerentes com o `config.js`.
- **Retenção de dados:** a rotina automática de limpeza (conversas, briefings e arquivos antigos, conforme `legal.retencao*`)
  ainda não existe. Até lá, faça a limpeza manualmente a cada trimestre pelo SQL Editor e pelo Storage.
