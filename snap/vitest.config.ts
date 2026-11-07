import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@metamask/snaps-sdk',
  },
});
