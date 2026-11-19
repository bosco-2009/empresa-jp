# Fila de melhorias — Portfólio BR

Fila de trabalho contínuo. A cada hora, uma execução automática pega o **primeiro item `[ ]`**, implementa,
testa, revisa, faz o merge na `main`, marca como `[x]` (com a data e o commit) e passa para o próximo na hora seguinte.
Quando restarem menos de 5 itens `[ ]`, a execução acrescenta 5 novos itens de valor real no fim da fila.

Regras de toda execução (além do CLAUDE.md):
- Um item por execução, numa branch `melhoria/<numero>-<slug>`, com merge `--no-ff` na `main` só se a auditoria passar:
  zero erros no console (inclusive CSP), sem rolagem horizontal em 320/375/768/1280 px, axe sem violações sérias.
- Nunca mexer nos dados `[PROVISÓRIO]` do dono (WhatsApp, e-mail, CNPJ, cidade) nem tirar o `rascunho`.
- Nunca inventar depoimentos, números, clientes ou logos. Exemplos fictícios só com o rótulo "exemplo".
- Banco: só migrations aditivas, sem DROP/DELETE de dados, testadas antes. Na dúvida, fazer só o front.
- Respeitar `prefers-reduced-motion` em toda animação; animações só com CSS/JS próprios (a CSP bloqueia CDNs novos).
- Depois do merge, sincronizar a prévia em `bosco-2009/dev-marketing` → `previas/portfolio-br/`.

## Fila

- [x] (concluído 2026-11-19 16:06 UTC, merge 8eb75e6) 1. **Entrada animada**: abertura de marca de 2 a 3 s (logo Portfólio BR se montando, frase "Seu negócio com um site profissional", saída com zoom suave para o hero), uma vez por sessão (sessionStorage), pulável ao toque ou tecla, nunca bloqueia o conteúdo para leitores de tela. Depois, animações de rolagem estilo site premium: revelar seções (fade + subida), o mockup do hero ampliando e inclinando levemente com a rolagem e cards entrando em cascata. Tudo com IntersectionObserver, sem bibliotecas.
- [x] (concluído 2026-11-19 16:14 UTC, merge 6e9d4a0) 2. **Mockup vivo no hero**: o celular do hero alterna entre 3 telas de sites de exemplo (loja de roupas, restaurante, salão de beleza) feitas em HTML/CSS, com transição suave e o rótulo "exemplo".
- [x] (concluído 2026-11-19 16:25 UTC, merge 87efd71) 3. **Página "Exemplos"** (`exemplos.html`): 6 demonstrações de sites por segmento (moda, restaurante, beleza, saúde, serviços, pet), cada uma uma página leve em `exemplos/`, com o rótulo "site de exemplo" e um CTA para os planos. Link no menu e no sitemap.
- [x] (concluído 2026-11-19 UTC, merge 7455794) 4. **Simulador "Qual plano é para mim?"**: 4 perguntas (tipo de negócio, precisa vender online?, quantas páginas, já tem domínio?) que recomendam um plano de `config.js` e levam para `planos.html?plano=`.
- [x] (concluído 2026-11-19 UTC, merge 37f4acd) 5. **Comparativo de planos**: tabela acessível com tudo o que cada plano inclui; no celular, cards com abas.
- [x] (concluído 2026-11-19 UTC, merge 43a08be) 6. **Seção "Para quem é"**: segmentos atendidos com ícones SVG próprios e uma frase de benefício por segmento.
- [~] (início 2026-11-19 19:42 UTC) 7. **Respostas rápidas no chat do admin**: modelos de resposta (saudação, preços, prazos, pedir WhatsApp) que se inserem com um clique, editáveis e salvos no localStorage do admin.
- [ ] 8. **Avisos no painel**: contador de não lidas no título e no favicon, som opcional e notificação do navegador (com permissão) para conversa nova, pedido pago e briefing novo.
- [ ] 9. **Blog com 3 artigos originais de SEO**: "Site ou só Instagram?", "O que um site profissional precisa ter", "Como funciona a criação do seu site com a Portfólio BR". Sem estatísticas inventadas. Página `blog/`, JSON-LD Article, sitemap.
- [ ] 10. **Origem do visitante**: guardar `utm_*` e o referrer na chegada (localStorage) e enviar junto com `pagina_origem` no chat e nos dados do pedido, para o dono saber de onde vêm os clientes (Instagram, Google…).
- [ ] 11. **Modo escuro** automático (`prefers-color-scheme`), com botão para alternar, usando só os tokens.
- [ ] 12. **Linha do tempo "Como funciona"** animada: do pedido à entrega, com prazos vindos do `config.js`.
- [ ] 13. **FAQ com busca** e links diretos para cada pergunta (`#faq-...`), com JSON-LD FAQPage.
- [ ] 14. **Imagens Open Graph por página** (1200×630, geradas em SVG→PNG no repositório) para planos, exemplos e blog.
- [ ] 15. **PWA**: service worker de cache só para os arquivos estáticos (nunca para o Supabase), com página offline. Ajustar a CSP (`worker-src 'self'`).
- [ ] 16. **Microinterações**: estados de hover, foco e toque nos botões e cards, feedback de carregamento no checkout e no envio do briefing.
- [ ] 17. **Captura "Diagnóstico grátis"**: formulário curto (Instagram do negócio + objetivo) que abre uma conversa no chat ao vivo já preenchida, usando as RPCs do chat.
- [ ] 18. **Auditoria contínua**: script único `testes/auditoria-rapida.mjs` que roda todas as páginas × 4 larguras e grava um relatório; documentar no README.
