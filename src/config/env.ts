// Loads and validates environment variables at startup.
// If a required variable is missing, the process exits immediately
// with a clear message rather than failing silently later.

import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  supabaseUrl:             requireEnv('SUPABASE_URL'),
  supabaseAnonKey:         requireEnv('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey:  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  databaseUrl:             requireEnv('DATABASE_URL'),
};
