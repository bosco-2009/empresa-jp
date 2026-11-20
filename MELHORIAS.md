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
- [x] (concluído 2026-11-19 UTC, merge 378ce8f) 7. **Respostas rápidas no chat do admin**: modelos de resposta (saudação, preços, prazos, pedir WhatsApp) que se inserem com um clique, editáveis e salvos no localStorage do admin.
- [x] (feito 2026-11-19, commit 5e3ac56) 8. **Avisos no painel**: contador de não lidas no título e no favicon, som opcional e notificação do navegador (com permissão) para conversa nova, pedido pago e briefing novo.
- [x] (concluído 2026-11-19 UTC, merge e2958bd) 9. **Blog com 3 artigos originais de SEO**: "Site ou só Instagram?", "O que um site profissional precisa ter", "Como funciona a criação do seu site com a Portfólio BR". Sem estatísticas inventadas. Página `blog/`, JSON-LD Article, sitemap.
- [x] (concluído 2026-11-19 UTC, merge 0566a28) 10. **Origem do visitante**: guardar `utm_*` e o referrer na chegada (localStorage) e enviar junto com `pagina_origem` no chat e nos dados do pedido, para o dono saber de onde vêm os clientes (Instagram, Google…).
- [x] (concluído 2026-11-19 UTC, merge a488ab1) 11. **Modo escuro** automático (`prefers-color-scheme`), com botão para alternar, usando só os tokens.
- [x] (feito 2026-11-19, commit 45c99f6) 12. **Linha do tempo "Como funciona"** animada: do pedido à entrega, com prazos vindos do `config.js`.
- [x] (concluído 2026-11-19 UTC, merge 08cc436) 13. **FAQ com busca** e links diretos para cada pergunta (`#faq-...`), com JSON-LD FAQPage.
- [x] (concluído 2026-11-19 UTC, merge 8590e54) 14. **Imagens Open Graph por página** (1200×630, geradas em SVG→PNG no repositório) para planos, exemplos e blog.
- [~] (início 2026-11-20 00:33 UTC) 15. **PWA**: service worker de cache só para os arquivos estáticos (nunca para o Supabase), com página offline. Ajustar a CSP (`worker-src 'self'`).
- [x] (concluído 2026-11-19 UTC, merge d03c3d2) 16. **Microinterações**: estados de hover, foco e toque nos botões e cards, feedback de carregamento no checkout e no envio do briefing.
- [~] (início 2026-11-19 21:00 UTC) 17. **Captura "Diagnóstico grátis"**: formulário curto (Instagram do negócio + objetivo) que abre uma conversa no chat ao vivo já preenchida, usando as RPCs do chat.
- [~] (início 2026-11-19 21:04 UTC) 18. **Auditoria contínua**: script único `testes/auditoria-rapida.mjs` que roda todas as páginas × 4 larguras e grava um relatório; documentar no README.
- [~] (início 2026-11-20 00:47 UTC) 19. **Botão "Compartilhar" nos artigos do blog**: Web Share API no celular e, sem ela, links de WhatsApp e copiar link (com aviso "Link copiado" em `aria-live`), sem scripts de terceiros.
- [x] (feito 2026-11-20, commit 4adcc41) 20. **Painel: filtros e exportação de pedidos/leads**: filtrar por status, período e origem (`utm_*`) e exportar CSV gerado no navegador (com `textContent`/escape seguro, sem enviar dados a terceiros).
- [ ] 21. **Imagens responsivas do portfólio**: `srcset`/`sizes` com versões WebP e PNG em `assets/img/portfolio/` e script de geração local, para quando os projetos reais entrarem (seção continua oculta sem itens reais).
- [ ] 22. **Breadcrumbs com JSON-LD BreadcrumbList** em blog, artigos, exemplos e planos, visíveis e acessíveis (`nav aria-label="Trilha"`).
- [ ] 23. **Recuperação de checkout abandonado no painel**: listar pedidos `pendente` há mais de 1 hora com botão "Chamar no WhatsApp" (mensagem pronta, só se o cliente deixou o número), sem envio automático.
- [ ] 24. **WhatsApp contextual**: nos cards de plano, no comparativo e nos artigos do blog, o link de WhatsApp leva uma mensagem pronta com o plano ou o assunto da página (texto montado a partir do `config.js`), e o widget fora do horário faz o mesmo. Sem número fixo no código: usa só o WhatsApp do `config.js` e some enquanto ele estiver `[PROVISÓRIO]`.
- [ ] 25. **Páginas por segmento para SEO** (`segmentos/restaurante.html`, `segmentos/moda.html`…): texto original sobre o que um site resolve para aquele tipo de negócio, link para o exemplo correspondente e para o simulador, JSON-LD `Service`, sitemap e OG. Sem números, clientes ou depoimentos inventados.
- [ ] 26. **Reflow e zoom 200% (WCAG 1.4.4 e 1.4.10)**: teste automatizado com zoom de texto 200% e viewport de 320 px CSS em todas as páginas (sem corte nem sobreposição de texto, sem rolagem horizontal), corrigindo o que falhar.
- [ ] 27. **Notas internas no painel**: campo de anotações do dono em cada conversa e pedido (tabela nova `notas` só para admin, RLS e testes SQL; migration aditiva), com data da última edição, salvamento automático e aviso de erro acessível.
- [ ] 28. **Pré-carregamento dos próximos passos**: ao passar o mouse, focar ou tocar nos CTAs para `planos.html` e `exemplos.html`, buscar a página antes do clique (`<link rel="prefetch">` criado por JS próprio, uma vez, respeitando `Save-Data` e conexões lentas), medindo o ganho no Lighthouse.
