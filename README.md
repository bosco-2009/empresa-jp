# Portfólio BR — site oficial

Site da **Portfólio BR** ([@portifolio_br](https://instagram.com/portifolio_br)), microempresa que cria sites
profissionais para pequenos negócios do Brasil.

- **Front:** HTML, CSS e JavaScript puros, mobile-first, publicado no GitHub Pages.
- **Back:** Supabase (banco com RLS, Auth do admin, Realtime para o chat, Edge Functions para o Mercado Pago).

## Rodar localmente

Não há etapa de build. Sirva a pasta raiz com um servidor estático:

```bash
python3 -m http.server 8080
```

Depois abra http://localhost:8080.

## Onde editar textos, preços e contatos

Tudo que é provisório ou depende de decisão do dono fica em **`config.js`**, marcado com `[PROVISÓRIO]`.

## Documentação para desenvolvimento

Veja [`CLAUDE.md`](CLAUDE.md): decisões fixas, estrutura de pastas, regras de qualidade e fases do projeto.
