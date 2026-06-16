import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/main/core/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/main/core/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        'dist-electron/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/todo-mock-db.ts',
        'src/renderer/',
        'src/main/core/vitest.setup.ts'
      ],
      all: true,
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    },
    include: ['src/main/core/**/*.test.ts'],
    exclude: ['node_modules/', 'dist/', 'dist-electron/'],
    testTimeout: 30000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/main'),
      '#testing/*': path.resolve(__dirname, './tests/*'),
      '#testing/scripts/load-test-env': path.resolve(__dirname, './tests/scripts/load-test-env.ts'),
      '#testing/scripts/ensure-test-workspace': path.resolve(__dirname, './tests/scripts/ensure-test-workspace.ts'),
      '#testing/scripts/ai-assistant-test-helper': path.resolve(__dirname, './tests/scripts/ai-assistant-test-helper.ts')
    }
  }
});
