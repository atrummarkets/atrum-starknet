import { Pool } from "pg";

/**
 * Waitlist storage.
 *
 * Postgres when DATABASE_URL is set, and a hard failure when it is not — rather than a
 * silent in-memory fallback that looks like it worked and loses every signup on the next
 * deploy. A landing page that pretends to capture emails is worse than one that says it
 * cannot.
 */
let pool: Pool | null = null;

function db(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export async function joinWaitlist(email: string): Promise<{ position: number }> {
  const normalized = email.trim().toLowerCase();
  const client = db();

  await client.query(`
    CREATE TABLE IF NOT EXISTS strk20_waitlist (
      id               SERIAL PRIMARY KEY,
      email            TEXT NOT NULL,
      email_normalized TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS strk20_waitlist_email_key
      ON strk20_waitlist (email_normalized)
  `);

  // ON CONFLICT so a second signup with the same address is idempotent and still returns
  // a position, rather than reading as an error to someone who simply forgot.
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO strk20_waitlist (email, email_normalized)
     VALUES ($1, $2)
     ON CONFLICT (email_normalized) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email.trim(), normalized]
  );

  return { position: rows[0].id };
}
