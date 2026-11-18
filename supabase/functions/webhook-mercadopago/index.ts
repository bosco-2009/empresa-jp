// Edge Function: recebe as notificações do Mercado Pago. Lógica em ../_shared/webhook-mercadopago.ts
// Deploy: supabase functions deploy webhook-mercadopago --no-verify-jwt
import { lerAmbiente } from '../_shared/comum.ts';
import { criarHandlerWebhook } from '../_shared/webhook-mercadopago.ts';

Deno.serve(criarHandlerWebhook(lerAmbiente((nome) => Deno.env.get(nome))));
