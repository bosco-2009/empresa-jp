// Edge Function: cria o pedido e a preferência do Checkout Pro. Lógica em ../_shared/criar-pagamento.ts
// Deploy: supabase functions deploy criar-pagamento --no-verify-jwt
import { lerAmbiente } from '../_shared/comum.ts';
import { criarHandlerCriarPagamento } from '../_shared/criar-pagamento.ts';

Deno.serve(criarHandlerCriarPagamento(lerAmbiente((nome) => Deno.env.get(nome))));
