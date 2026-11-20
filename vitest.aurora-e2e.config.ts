import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Aurora end-to-end suite: runs against a live server + real Postgres.
// Use `pnpm test:aurora:e2e` (scripts/aurora-e2e.ts starts everything).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/aurora/**/*.e2e.test.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
