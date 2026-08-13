// Raw PostgreSQL pool — used only for transactions that need
// SELECT ... FOR UPDATE (row-level locking for concurrency).
// The Supabase JS client doesn't expose transaction control.

import pg from 'pg';
import { config } from './env.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });
