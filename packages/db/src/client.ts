// The Postgres client (node-postgres + Drizzle, ADR-0012). Stateless web tier and worker both
// import `db`. Connection comes from DATABASE_URL; defaults to the local dev database.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/verdant';

export const pool = new Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool, { schema });
export { schema };
export type Db = typeof db;
