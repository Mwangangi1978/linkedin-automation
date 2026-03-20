import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Important: do NOT throw at module import time.
// Edge Functions can crash during cold start, before the `serve(...)` handler runs,
// which would drop any CORS headers returned by the handler.
export const supabaseAdmin: any = (supabaseUrl && serviceRoleKey)
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  : null;
