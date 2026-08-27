import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['test/**/*.test.tsx', 'jsdom'],
      ['test/**/*.test.ts', 'node'],
    ],
  },
});
