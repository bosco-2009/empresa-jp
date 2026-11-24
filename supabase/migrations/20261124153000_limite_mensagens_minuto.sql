-- =====================================================================================
-- Melhoria 96: limite de mensagens do chat por visitante, por minuto, no servidor.
-- ADITIVA: só substitui a função public.chat_enviar (mesma assinatura, mesmo retorno, mesmos grants).
-- Nenhuma tabela, coluna, política ou dado existente é alterado ou apagado.
--
-- Antes: no máximo 20 mensagens do visitante por conversa a cada 10 minutos.
-- Agora, além disso: no máximo LIMITE_POR_MINUTO (8) mensagens do visitante no último minuto.
-- Quem passar de qualquer um dos dois recebe o erro 'limite_mensagens' (errcode P0001), que o widget
-- já reconhece e mostra no role="alert" como "Aguarde um pouco antes de enviar de novo".
--
-- Por visitante_id: cada visitante tem uma única conversa (conversas.visitante_id é unique), então
-- contar por conversa é contar por visitante. A conversa é travada (for update) por
-- _chat_conversa_do_visitante antes da contagem, então envios simultâneos do mesmo visitante são
-- serializados e não conseguem furar o limite.
--
-- A contagem usa o índice mensagens_conversa_criado_em_idx (conversa_id, criado_em).
-- Mensagens do admin não contam. Depende de: 20261118120000_chat_ao_vivo.sql. Idempotente.
-- =====================================================================================

create or replace function public.chat_enviar(
  p_visitante_id uuid,
  p_token        text,
  p_texto        text
)
returns table (id uuid, autor text, texto text, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Constantes do anti-spam (mudar aqui e no comentário do topo; testes em 70_limite_mensagens_test.sql).
  c_limite_por_minuto constant integer := 8;
  c_limite_10_minutos constant integer := 20;
  v_conversa public.conversas;
  v_texto    text := btrim(coalesce(p_texto, ''));
  v_ultimo_minuto integer;
  v_ultimos_10    integer;
begin
  if char_length(v_texto) = 0 or char_length(v_texto) > 2000 then
    raise exception 'texto_invalido' using errcode = '22023';
  end if;

  v_conversa := public._chat_conversa_do_visitante(p_visitante_id, p_token);  -- trava a conversa
  if v_conversa.id is null then
    raise exception 'conversa_inexistente' using errcode = 'P0002';
  end if;

  select count(*) filter (where m.criado_em > now() - interval '1 minute'),
         count(*)
    into v_ultimo_minuto, v_ultimos_10
    from public.mensagens m
   where m.conversa_id = v_conversa.id
     and m.autor = 'visitante'
     and m.criado_em > now() - interval '10 minutes';

  if v_ultimo_minuto >= c_limite_por_minuto then
    raise exception 'limite_mensagens' using errcode = 'P0001', hint = 'janela_1_minuto';
  end if;
  if v_ultimos_10 >= c_limite_10_minutos then
    raise exception 'limite_mensagens' using errcode = 'P0001', hint = 'janela_10_minutos';
  end if;

  return query
    insert into public.mensagens as m (conversa_id, autor, texto)
    values (v_conversa.id, 'visitante', v_texto)
    returning m.id, m.autor, m.texto, m.criado_em;
end;
$$;

comment on function public.chat_enviar(uuid, text, text) is
  'Envia mensagem do visitante (visitante_id + token). Anti-spam: 8/minuto e 20/10 minutos -> limite_mensagens.';

revoke all on function public.chat_enviar(uuid, text, text) from public, anon, authenticated;
grant execute on function public.chat_enviar(uuid, text, text) to anon, authenticated;
