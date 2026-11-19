// Edge Function: URL assinada para enviar logo/fotos/PDF do briefing. Lógica em ../_shared/briefing-upload.ts
// Deploy: supabase functions deploy briefing-upload --no-verify-jwt
import { lerAmbiente } from '../_shared/comum.ts';
import { criarHandlerBriefingUpload } from '../_shared/briefing-upload.ts';

Deno.serve(criarHandlerBriefingUpload(lerAmbiente((nome) => Deno.env.get(nome))));
