-- =====================================================================================
-- Melhoria 39: o visitante que voltou do Mercado Pago sem pagar pode concluir o MESMO pedido.
-- ADITIVA: só cria uma função. Nenhuma tabela, coluna ou dado existente é alterado ou apagado.
--
-- A Edge Function criar-pagamento (modo "reabrir") chama esta função com a service role para achar a
-- preferência do Checkout Pro já criada para o pedido e devolver o link de pagamento ao navegador.
-- Assim não nasce um pedido duplicado e nenhum dado pessoal é pedido de novo nem guardado no navegador.
--
-- Regras:
--   * Código + token secreto do navegador (mesma validação de _pedido_do_cliente: "acesso_negado").
--   * Só pedido 'pendente', SEM pagamento registrado (mp_payment_id nulo). Se já existe um pagamento
--     em processamento (Pix/boleto gerado), reabrir poderia levar a uma cobrança em dobro:
--     erro 'pagamento_em_andamento'. Pedido aprovado, recusado etc.: 'pedido_nao_pendente'.
--   * Só pedidos com até 30 dias e com preferência gravada: senão 'pedido_nao_reabrivel'.
--   * Devolve só o id da preferência (nada de nome, e-mail ou WhatsApp).
--   * Execução só para service_role (o navegador nunca chama direto).
--
-- Depende de: 20261119120000_pedidos.sql e 20261120120000_briefings.sql (_pedido_do_cliente). Idempotente.
-- =====================================================================================

create or replace function public.pedido_preferencia_para_reabrir(p_codigo text, p_token text)
returns table (codigo text, mp_preference_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos;
begin
  -- Valida o formato e o token (levanta acesso_negado, errcode 42501).
  v_pedido := public._pedido_do_cliente(p_codigo, p_token);

  if v_pedido.status <> 'pendente' then
    raise exception 'pedido_nao_pendente' using errcode = '22023';
  end if;
  if v_pedido.mp_payment_id is not null then
    raise exception 'pagamento_em_andamento' using errcode = '22023';
  end if;
  if v_pedido.mp_preference_id is null or v_pedido.criado_em < now() - interval '30 days' then
    raise exception 'pedido_nao_reabrivel' using errcode = '22023';
  end if;

  return query select v_pedido.codigo, v_pedido.mp_preference_id;
end;
$$;

comment on function public.pedido_preferencia_para_reabrir(text, text) is
  'Preferência do Checkout Pro de um pedido pendente sem pagamento (código + token). Só service_role (Edge Function criar-pagamento).';

revoke all on function public.pedido_preferencia_para_reabrir(text, text) from public, anon, authenticated;
grant execute on function public.pedido_preferencia_para_reabrir(text, text) to service_role;
