#!/usr/bin/env python3
"""
Gera as páginas por segmento (melhoria 25): segmentos/<id>.html.

    python3 testes/segmentos/gerar.py

O <head> comum, o cabeçalho e o rodapé são copiados de um artigo do blog (mesma profundidade de pasta),
para continuarem idênticos aos da home (testes/funcoes/paginas.test.mjs confere).
Os textos ficam aqui. Regras: texto original, sem números, clientes, depoimentos ou promessas de resultado.
Preços NÃO entram aqui (vêm do config.js nas páginas de planos e no simulador).
"""
import html
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SITE = 'https://bosco-2009.github.io/empresa-jp/'
MODELO = RAIZ / 'blog' / 'site-ou-instagram.html'

SEGMENTOS = [
    {
        'id': 'restaurante', 'paleta': 'restaurante', 'icone': 'i-prato',
        'curto': 'Restaurantes', 'trilha': 'Sites para restaurantes', 'quem': 'o seu restaurante',
        'title': 'Site para restaurante, lanchonete e delivery',
        'h1': 'Site para restaurante, lanchonete e delivery',
        'description': 'Cardápio sempre à mão no celular, pedido pelo WhatsApp, horários e regiões de entrega num só lugar. Veja o que um site resolve para o seu restaurante.',
        'intro': 'Quem está com fome quer resolver rápido: ver o cardápio, saber se você está aberto e fazer o pedido. Um site deixa essas respostas a um toque, no celular do cliente, sem depender de uma foto de cardápio perdida no feed.',
        'beneficios': [
            ('Cardápio sempre atualizado', 'O cardápio ganha uma página própria, organizada por categoria e fácil de ler no celular. Mudou um preço ou entrou um prato novo? A mudança vale para todo mundo que abrir o link.'),
            ('Pedido direto pelo WhatsApp', 'Os botões de pedido abrem a conversa no WhatsApp do restaurante com a mensagem já começada, sem o cliente precisar baixar nenhum aplicativo.'),
            ('Horário, endereço e entrega claros', 'Dias e horários de funcionamento, endereço, regiões de entrega e formas de pagamento aparecem logo no começo. O cliente não precisa perguntar o básico.'),
            ('Mais chance de ser encontrado', 'Quem pesquisa comida na sua região encontra uma página feita para o Google ler, com o nome do restaurante, o tipo de cozinha e o bairro.'),
        ],
        'itens': ['Cardápio por categorias, com fotos e preços', 'Botão de pedido pelo WhatsApp', 'Dias e horários de funcionamento', 'Endereço, link para o mapa e regiões de entrega', 'Formas de pagamento aceitas', 'Fotos do ambiente e dos pratos'],
        'dica': 'Separe o cardápio atual (pode ser uma foto do impresso), algumas fotos boas dos pratos e a lista de bairros que você atende. Com isso em mãos, o briefing fica rápido de preencher.',
        'exemplo': 'Restaurante fictício com cardápio do dia, horários e pedido pelo WhatsApp.',
        'og': ([['Site para', False]], [['restaurante', True]], [['e delivery', False]]), 'og_linha': 'Cardápio no celular e pedido pelo WhatsApp',
    },
    {
        'id': 'moda', 'paleta': 'moda', 'icone': 'i-sacola',
        'curto': 'Moda', 'trilha': 'Sites para lojas de moda', 'quem': 'a sua loja',
        'title': 'Site para loja de roupas, moda e acessórios',
        'h1': 'Site para loja de roupas, moda e acessórios',
        'description': 'Vitrine organizada com fotos, tamanhos e cores, e a venda continuando no WhatsApp. Veja o que um site resolve para a sua loja de moda.',
        'intro': 'Na moda, a cliente quer ver a peça, conferir tamanho e cor e perguntar se ainda tem. Um site vira a sua vitrine aberta o dia todo: os produtos ficam organizados e a conversa de venda continua no WhatsApp, do jeito que você já atende.',
        'beneficios': [
            ('Vitrine organizada', 'Produtos separados por categoria, com fotos, tamanhos, cores e preço. A cliente encontra o que procura sem rolar meses de posts.'),
            ('Menos perguntas repetidas', 'Tabela de medidas, prazo de envio, trocas e formas de pagamento ficam escritos no site. As mensagens que chegam passam a ser de quem já está decidindo comprar.'),
            ('Compra pelo WhatsApp com a peça certa', 'O botão de cada produto abre o WhatsApp com o nome da peça na mensagem, e você já sabe do que a cliente está falando.'),
            ('Um link só para divulgar', 'Bio do Instagram, status do WhatsApp, sacola e etiqueta: um único endereço leva para a coleção inteira.'),
        ],
        'itens': ['Catálogo por categorias (vestidos, calças, acessórios…)', 'Fotos, tamanhos, cores e preço de cada peça', 'Tabela de medidas', 'Política de trocas e prazos de envio', 'Botão de compra pelo WhatsApp em cada produto', 'Link para o Instagram da loja'],
        'dica': 'Se você vende para outras cidades, conte no briefing como funcionam o envio e as trocas. Esses detalhes ganham uma seção própria e passam segurança para quem ainda não conhece a loja.',
        'exemplo': 'Loja fictícia com vitrine de produtos, tamanhos e compra pelo WhatsApp.',
        'og': ([['Site para', False]], [['loja de roupas', True]], [['e moda', False]]), 'og_linha': 'Vitrine no celular e venda pelo WhatsApp',
    },
    {
        'id': 'beleza', 'paleta': 'salao', 'icone': 'i-tesoura',
        'curto': 'Beleza', 'trilha': 'Sites para salões e barbearias', 'quem': 'o seu salão',
        'title': 'Site para salão de beleza, barbearia e estética',
        'h1': 'Site para salão de beleza, barbearia e estética',
        'description': 'Serviços com duração e valor, galeria dos seus trabalhos e agendamento pelo WhatsApp. Veja o que um site resolve para o seu salão ou barbearia.',
        'intro': 'Quem procura um salão quer saber três coisas: o que você faz, quanto tempo leva e como marcar. Um site responde tudo isso de uma vez e deixa o agendamento a um toque, pelo WhatsApp.',
        'beneficios': [
            ('Serviços com duração e valor', 'Corte, coloração, manicure, sobrancelha, barba: cada serviço com uma descrição curta, o tempo médio e o valor, se você quiser mostrar.'),
            ('Agendamento sem vai e volta', 'O botão de agendar abre o WhatsApp já dizendo qual serviço a pessoa quer. A conversa começa no ponto certo.'),
            ('Seu trabalho em destaque', 'Uma galeria com fotos dos seus trabalhos, separada por tipo de serviço, mostra o seu estilo para quem ainda não conhece você.'),
            ('Equipe e espaço apresentados', 'Quem são os profissionais, a especialidade de cada um e como é o espaço. Isso ajuda quem chega pela primeira vez a escolher com confiança.'),
        ],
        'itens': ['Lista de serviços com duração e valor', 'Botão de agendamento pelo WhatsApp', 'Galeria de trabalhos', 'Equipe e especialidades', 'Endereço, horários e link para o mapa', 'Formas de pagamento e regras de atraso ou cancelamento'],
        'dica': 'Use fotos de trabalhos feitos por você, com autorização de quem aparece nelas. Fotos de banco de imagens ou de outros salões passam a impressão errada sobre o seu trabalho.',
        'exemplo': 'Salão fictício com serviços, duração e agendamento rápido.',
        'og': ([['Site para salão,', False]], [['barbearia', True]], [['e estética', False]]), 'og_linha': 'Serviços, galeria e agendamento pelo WhatsApp',
    },
    {
        'id': 'saude', 'paleta': 'saude', 'icone': 'i-saude',
        'curto': 'Saúde', 'trilha': 'Sites para consultórios e clínicas', 'quem': 'o seu consultório',
        'title': 'Site para consultório, clínica e profissionais de saúde',
        'h1': 'Site para consultório, clínica e profissionais de saúde',
        'description': 'Especialidades explicadas com clareza, equipe apresentada e primeira consulta sem dúvidas. Veja o que um site resolve para o seu consultório ou clínica.',
        'intro': 'Antes de marcar a primeira consulta, o paciente quer saber quem vai atendê-lo, onde fica e como agendar. Um site sóbrio e bem organizado reúne essas informações e transmite a seriedade que a área pede.',
        'beneficios': [
            ('Especialidades explicadas com clareza', 'Cada especialidade ou tratamento com uma explicação simples, em linguagem que o paciente entende, sem promessas de resultado.'),
            ('Profissionais apresentados', 'Nome, formação e registro profissional de cada pessoa da equipe, como o paciente espera encontrar.'),
            ('Primeira consulta sem dúvidas', 'Como agendar, o que levar, convênios aceitos ou atendimento particular e formas de pagamento ficam explicados antes do primeiro contato.'),
            ('Localização e acesso', 'Endereço, link para o mapa, horários e informações de acesso, como estacionamento e acessibilidade do prédio.'),
        ],
        'itens': ['Especialidades e tratamentos', 'Profissionais com formação e registro', 'Como agendar a primeira consulta', 'Convênios aceitos ou atendimento particular', 'Endereço, horários e informações de acesso', 'Política de privacidade para os dados de contato'],
        'dica': 'Os conselhos profissionais da área da saúde costumam ter regras próprias para publicidade. Vale conferir as do seu conselho antes de começar; o texto do site só vai ao ar depois da sua aprovação.',
        'exemplo': 'Clínica fictícia com especialidades, primeira consulta e agendamento.',
        'og': ([['Site para', False]], [['consultório', True]], [['e clínica', False]]), 'og_linha': 'Especialidades, equipe e agendamento',
    },
    {
        'id': 'servicos', 'paleta': 'servicos', 'icone': 'i-chave',
        'curto': 'Serviços', 'trilha': 'Sites para prestadores de serviço', 'quem': 'o seu negócio',
        'title': 'Site para oficina, reformas e prestadores de serviço',
        'h1': 'Site para oficina, reformas e prestadores de serviço',
        'description': 'Serviços bem descritos, área de atendimento clara e pedido de orçamento organizado pelo WhatsApp. Veja o que um site resolve para quem presta serviço.',
        'intro': 'Quem precisa de um eletricista, de um mecânico ou de uma reforma quer confiar em quem vai entrar em casa ou cuidar do carro. Um site mostra o que você faz, onde atende e facilita o pedido de orçamento.',
        'beneficios': [
            ('Serviços bem descritos', 'Cada serviço com uma explicação do que está incluído. O cliente entende se você resolve o problema dele antes de chamar.'),
            ('Área de atendimento clara', 'Bairros e cidades atendidos ficam escritos no site, e você recebe menos pedidos de lugares onde não atende.'),
            ('Pedido de orçamento organizado', 'O botão de orçamento abre o WhatsApp com uma mensagem que já pede o que você precisa saber: o tipo de serviço, o bairro e uma foto do problema.'),
            ('Trabalhos que falam por você', 'Fotos de serviços que você já fez, de antes e depois, mostram o capricho melhor do que qualquer frase.'),
        ],
        'itens': ['Lista de serviços com o que está incluído', 'Bairros e cidades atendidos', 'Botão de orçamento pelo WhatsApp', 'Fotos de trabalhos já feitos', 'Horário de atendimento e atendimento de urgência, se houver', 'Formas de pagamento e garantia do serviço, se houver'],
        'dica': 'Comece a fotografar os trabalhos que você faz desde já, com autorização do cliente. Algumas fotos boas de antes e depois valem mais do que muitas fotos genéricas.',
        'exemplo': 'Prestador de serviços fictício com área atendida e pedido de orçamento.',
        'og': ([['Site para', False]], [['prestadores', True]], [['de serviço', False]]), 'og_linha': 'Serviços, área atendida e orçamento',
    },
    {
        'id': 'pet', 'paleta': 'pet', 'icone': 'i-pata',
        'curto': 'Pet shop', 'trilha': 'Sites para pet shops', 'quem': 'o seu pet shop',
        'title': 'Site para pet shop e banho e tosa',
        'h1': 'Site para pet shop e banho e tosa',
        'description': 'Serviços por porte, agendamento pelo WhatsApp e vitrine de produtos. Veja o que um site resolve para o seu pet shop ou banho e tosa.',
        'intro': 'Para deixar o pet com alguém, o tutor quer conhecer o lugar, entender os serviços e marcar sem complicação. Um site apresenta tudo com carinho e deixa o agendamento a um toque, pelo WhatsApp.',
        'beneficios': [
            ('Serviços por porte e tipo', 'Banho, tosa, hidratação, leva e traz: cada serviço explicado, com valores por porte se você quiser mostrar.'),
            ('Agendamento pelo WhatsApp', 'O botão de agendar já diz qual serviço o tutor quer, e o horário é combinado sem vai e volta.'),
            ('Confiança para o tutor', 'Fotos do espaço, como os pets são cuidados durante o banho e quais produtos são usados. Quem ama o seu bicho quer saber.'),
            ('Produtos em destaque', 'Rações, petiscos e acessórios que você vende podem ganhar uma vitrine com pedido pelo WhatsApp.'),
        ],
        'itens': ['Banho e tosa com serviços por porte', 'Botão de agendamento pelo WhatsApp', 'Leva e traz e regiões atendidas, se houver', 'Fotos do espaço', 'Vitrine de produtos', 'Endereço, horários e formas de pagamento'],
        'dica': 'Fotos dos pets atendidos só com autorização dos tutores. Fotos do espaço, da equipe e dos produtos já mostram bastante e não dependem de ninguém.',
        'exemplo': 'Pet shop fictício com banho e tosa, produtos e agendamento.',
        'og': ([['Site para', False]], [['pet shop', True]], [['e banho e tosa', False]]), 'og_linha': 'Serviços, produtos e agendamento',
    },
]

e = html.escape


def json_ld(s, url):
    dados = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Service',
                '@id': url + '#servico',
                'name': s['h1'],
                'serviceType': 'Criação de site profissional',
                'description': s['description'],
                'url': url,
                'inLanguage': 'pt-BR',
                # SEO local sem inventar (melhoria 40): atendimento online para todo o Brasil,
                # sem cidade, endereço ou números. Detalhes da empresa ficam no nó da home (#organizacao).
                'areaServed': {'@type': 'Country', 'name': 'Brasil'},
                'availableChannel': {
                    '@type': 'ServiceChannel',
                    'name': 'Atendimento online',
                    'serviceUrl': SITE + 'planos.html',
                    'availableLanguage': 'pt-BR',
                },
                'audience': {'@type': 'BusinessAudience', 'name': s['trilha'].replace('Sites para ', '').capitalize()},
                'provider': {
                    '@type': 'Organization',
                    '@id': SITE + '#organizacao',
                    'name': 'Portfólio BR',
                    'url': SITE,
                    'logo': SITE + 'assets/img/icon-512.png',
                    'knowsAbout': ['Criação de sites profissionais', s['trilha']],
                },
                'image': f"{SITE}assets/img/og/segmento-{s['id']}.png",
            },
            {
                '@type': 'BreadcrumbList',
                'itemListElement': [
                    {'@type': 'ListItem', 'position': 1, 'name': 'Início', 'item': SITE},
                    {'@type': 'ListItem', 'position': 2, 'name': s['trilha'], 'item': url},
                ],
            },
        ],
    }
    corpo = json.dumps(dados, ensure_ascii=False, indent=2)
    return '  <script type="application/ld+json">\n  ' + corpo.replace('\n', '\n  ') + '\n  </script>\n'


def cabeca(s, modelo_head):
    url = f"{SITE}segmentos/{s['id']}.html"
    titulo = f"{s['title']} — Portfólio BR"
    alt = f"{s['h1']}: Portfólio BR"
    h = modelo_head
    troca = [
        ('<title>Site ou só Instagram? — Blog Portfólio BR</title>', f'<title>{e(titulo)}</title>'),
        ('content="Instagram e site têm papéis diferentes. Veja o que cada um faz bem, onde o Instagram sozinho deixa a desejar e por que os dois juntos funcionam melhor."', f'content="{e(s["description"])}"'),
        ('blog/site-ou-instagram.html', f"segmentos/{s['id']}.html"),
        ('<meta property="og:type" content="article">', '<meta property="og:type" content="website">'),
        ('content="Site ou só Instagram? — Blog Portfólio BR"', f'content="{e(titulo)}"'),
        ('og/blog-site-ou-instagram.png', f"og/segmento-{s['id']}.png"),
        ('content="Artigo: Site ou só Instagram? O que faz sentido para o seu negócio"', f'content="{e(alt)}"'),
        ('  <link rel="stylesheet" href="../assets/css/blog.css">\n',
         '  <link rel="stylesheet" href="../assets/css/blog.css">\n  <link rel="stylesheet" href="../assets/css/exemplos.css">\n  <link rel="stylesheet" href="../assets/css/segmentos.css">\n'),
    ]
    for velho, novo in troca:
        assert velho in h, velho
        h = h.replace(velho, novo)
    inicio = h.index('  <script type="application/ld+json">')
    fim = h.index('</script>\n', inicio) + len('</script>\n')
    return h[:inicio] + json_ld(s, url) + h[fim:]


def icone(nome, classe='icone'):
    return f'<svg class="{classe}" aria-hidden="true" focusable="false"><use href="#{nome}"/></svg>'


def corpo(s):
    sid = s['id']
    outros = [o for o in SEGMENTOS if o['id'] != sid]
    beneficios = '\n'.join(
        f'''            <li class="seg-beneficio">
              <h3 class="seg-beneficio__titulo">{e(t)}</h3>
              <p>{e(p)}</p>
            </li>''' for t, p in s['beneficios'])
    itens = '\n'.join(f'            <li>{icone("i-check")}<span>{e(i)}</span></li>' for i in s['itens'])
    links_outros = '\n'.join(
        f'''            <li><a class="seg-outros__link" href="{o['id']}.html">{icone(o['icone'])}<span>{e(o['trilha'])}</span></a></li>''' for o in outros)
    sim = f'../index.html?segmento={sid}#simulador'
    return f'''  <main id="conteudo" tabindex="-1" data-whats-contexto="segmento">
    <article class="artigo seg" aria-labelledby="seg-titulo">
      <header class="pagina-topo seg__topo">
        <div class="container container--estreito">
          <nav class="migalhas" aria-label="Trilha"><ol role="list"><li><a href="../index.html">Início</a></li><li aria-current="page">{e(s['trilha'])}</li></ol></nav>
          <p class="seg__selo">{icone(s['icone'])}<span>{e(s['trilha'])}</span></p>
          <h1 id="seg-titulo" class="pagina-topo__titulo">{e(s['h1'])}</h1>
          <p class="pagina-topo__texto">{e(s['intro'])}</p>
          <p class="artigo__acoes seg__acoes">
            <a class="botao botao--primario" href="{sim}">Qual plano é para mim?</a>
            <a class="botao botao--contorno" href="../exemplos/{sid}.html">Ver um site de exemplo</a>
          </p>
        </div>
      </header>
      <div class="container container--estreito artigo__corpo">
        <section aria-labelledby="seg-resolve">
          <h2 id="seg-resolve">O que um site resolve para {e(s['quem'])}</h2>
          <ul class="seg-beneficios" role="list">
{beneficios}
          </ul>
        </section>

        <section aria-labelledby="seg-itens">
          <h2 id="seg-itens">O que costuma entrar no site</h2>
          <p>Cada negócio é de um jeito, e o briefing define o que entra no seu. Estes são os itens que mais aparecem:</p>
          <ul class="seg-lista" role="list">
{itens}
          </ul>
          <aside class="seg-dica" aria-label="Dica antes de começar">
            <p><strong>Dica antes de começar:</strong> {e(s['dica'])}</p>
          </aside>
        </section>

        <section aria-labelledby="seg-exemplo">
          <h2 id="seg-exemplo">Veja um site de exemplo</h2>
          <div class="ex-cartao seg-exemplo">
            <div class="ex-mini ex--{s['paleta']}" aria-hidden="true"><span class="ex-mini__barra"></span><span class="ex-mini__capa"></span><span class="ex-mini__bloco"></span><span class="ex-mini__bloco"></span><span class="ex-mini__bloco"></span></div>
            <div class="ex-cartao__texto">
              <p class="ex-cartao__rotulo">site de exemplo</p>
              <p class="seg-exemplo__resumo">{e(s['exemplo'])} O negócio, os preços e os textos são fictícios.</p>
              <a class="ex-cartao__link" href="../exemplos/{sid}.html">Abrir o site de exemplo<span class="visualmente-oculto">: {e(s['curto'].lower())}</span></a>
            </div>
          </div>
        </section>

        <section aria-labelledby="seg-plano">
          <h2 id="seg-plano">Qual plano escolher?</h2>
          <p>Os planos mudam conforme o número de páginas e o que o site precisa fazer, como ter catálogo ou cardápio com pedido. Responda 4 perguntas rápidas no simulador e veja qual plano faz sentido para o seu caso, ou compare todos lado a lado.</p>
          <p>Quer entender o caminho do pagamento até o site no ar? Leia <a href="../blog/como-funciona-a-criacao-do-seu-site.html">como funciona a criação do seu site</a>.</p>
        </section>

        <aside class="artigo__chamada" aria-labelledby="seg-chamada">
          <h2 id="seg-chamada" class="artigo__chamada-titulo">Vamos colocar {e(s['quem'])} na internet?</h2>
          <p>Descubra o plano indicado em poucos cliques, compare os preços ou fale com a gente pelo chat.</p>
          <p class="artigo__acoes">
            <a class="botao botao--primario" href="{sim}">Qual plano é para mim?</a>
            <a class="botao botao--contorno" href="../planos.html">Ver planos e preços</a>
            <a class="botao botao--whatsapp" href="#" target="_blank" rel="noopener" data-whats="segmento" hidden>{icone("i-whatsapp")}Conversar no WhatsApp<span class="visualmente-oculto"> (abre em nova aba)</span></a>
          </p>
        </aside>

        <nav class="artigo__mais seg-outros" aria-labelledby="seg-outros">
          <h2 id="seg-outros" class="artigo__mais-titulo">Outros segmentos</h2>
          <ul role="list">
{links_outros}
          </ul>
          <p>Não achou o seu? Atendemos pequenos negócios de qualquer área: <a href="../index.html#para-quem">veja para quem é</a>.</p>
        </nav>
      </div>
    </article>
  </main>
'''


def main():
    modelo = MODELO.read_text(encoding='utf-8')
    head_fim = modelo.index('  <main id="conteudo"')
    main_fim = modelo.index('  </main>\n') + len('  </main>\n')
    pasta = RAIZ / 'segmentos'
    pasta.mkdir(exist_ok=True)
    for s in SEGMENTOS:
        pagina = cabeca(s, modelo[:head_fim]) + corpo(s) + modelo[main_fim:]
        (pasta / f"{s['id']}.html").write_text(pagina, encoding='utf-8')
        print(f"segmentos/{s['id']}.html")
    # Dados das imagens OG, lidos por testes/og/gerar.mjs
    og = [{'nome': f"segmento-{s['id']}", 'titulo': s['og'], 'linha': s['og_linha'], 'alt': f"{s['h1']}: Portfólio BR"} for s in SEGMENTOS]
    (Path(__file__).parent / 'og.json').write_text(json.dumps(og, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
