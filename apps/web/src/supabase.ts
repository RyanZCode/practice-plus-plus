import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { WebConfig } from "./config";

let client: SupabaseClient | undefined;

export function getSupabaseClient(config: WebConfig): SupabaseClient {
  client ??= createClient(config.supabaseUrl, config.supabasePublishableKey);

  return client;
}
