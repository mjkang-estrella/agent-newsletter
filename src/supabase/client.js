import { createClient } from "@supabase/supabase-js";

import { resolveSupabaseServerConfig } from "./shared.js";

export function createSupabaseAdminClient({
  env = process.env,
  url,
  secretKey,
  serviceRoleKey,
  clientFactory = createClient,
} = {}) {
  if (typeof clientFactory !== "function") {
    throw new TypeError("clientFactory must be a function");
  }

  const config = resolveSupabaseServerConfig({
    ...env,
    ...(url ? { SUPABASE_URL: url } : {}),
    ...(secretKey ? { SUPABASE_SECRET_KEY: secretKey } : {}),
    ...(serviceRoleKey ? { SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey } : {}),
  });

  return clientFactory(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "x-client-info": "agent-newsletter",
      },
    },
  });
}
