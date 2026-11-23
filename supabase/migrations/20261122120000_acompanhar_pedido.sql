-- =====================================================================================
-- Melhoria 30: o cliente acompanha as etapas do pedido (pedido.html).
-- ADITIVA: só cria uma função. Nenhuma tabela, coluna ou dado existente é alterado ou apagado.
--
-- A etapa NÃO é guardada numa coluna nova: ela é derivada do que já existe, para nunca divergir
-- do que o dono vê no painel:
--   pedido.status <> 'aprovado'                  → 'nao_pago'   (o front mostra o status do pagamento)
--   aprovado e sem briefing                      → 'pago'
--   briefing.status = 'novo'                     → 'briefing_recebido'
--   briefing.status in (em_producao, em_revisao) → 'em_producao'
--   briefing.status = 'entregue'                 → 'entregue'
-- O dono muda a etapa no painel mudando o status do briefing (aba Briefings ou detalhe do pedido),
-- o que já é permitido ao admin pela política briefings_admin_status.
--
-- Acesso: anon/authenticated, só com código + token secreto do navegador (mesma validação de
-- _pedido_do_cliente; mesmo erro "acesso_negado" para código inexistente e token errado).
-- Não devolve dados pessoais (nome, e-mail, WhatsApp, conteúdo do briefing): só código, plano,
-- status, etapa e as datas de cada etapa.
--
-- Depende de: 20261119120000_pedidos.sql e 20261120120000_briefings.sql. Idempotente.
-- =====================================================================================

create or replace function public.pedido_acompanhar(p_codigo text, p_token text)
returns table (
  codigo          text,
  plano_id        text,
  plano_nome      text,
  pedido_status   text,
  etapa           text,
  briefing_status text,
  pago_em         timestamptz,
  briefing_em     timestamptz,
  etapa_em        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos;
  v_b      public.briefings;
  v_etapa  text;
begin
  -- Valida o formato e o token (levanta acesso_negado, errcode 42501).
  v_pedido := public._pedido_do_cliente(p_codigo, p_token);

  if v_pedido.status = 'aprovado' then
    select * into v_b from public.briefings b where b.pedido_id = v_pedido.id;
  end if;

  v_etapa := case
    when v_pedido.status <> 'aprovado' then 'nao_pago'
    when v_b.id is null                then 'pago'
    when v_b.status = 'novo'           then 'briefing_recebido'
    when v_b.status = 'entregue'       then 'entregue'
    else 'em_producao'
  end;

  return query select
    v_pedido.codigo,
    v_pedido.plano_id,
    v_pedido.plano_nome,
    v_pedido.status,
    v_etapa,
    v_b.status,
    case when v_pedido.status = 'aprovado' then v_pedido.pago_em end,
    v_b.criado_em,
    case when v_b.status in ('em_producao', 'em_revisao', 'entregue') then v_b.status_atualizado_em end;
end;
$$;

comment on function public.pedido_acompanhar(text, text) is
  'Etapa do pedido para o cliente (código + token do navegador). Sem dados pessoais.';

revoke all on function public.pedido_acompanhar(text, text) from public, anon, authenticated;
grant execute on function public.pedido_acompanhar(text, text) to anon, authenticated;
