// Loaded via --require before any test or source module, so that db.ts reads the
// test connection string when it builds the pool at import time.
export {};

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:55432/pdt_test';

// db.ts only enables SSL in production; keep tests off that path regardless of the
// developer's shell.
delete process.env.NODE_ENV;
