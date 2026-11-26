import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/vendor/**', 'tests/e2e/**', 'scripts/gen-icons.cjs']),
  {
    // Stricter than Next's defaults, for all source and unit tests, workspace modules included.
    files: ['src/**/*.{ts,tsx}', 'tests/unit/**/*.ts'],
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // CLAUDE.md rule 2: server code (model calls, keys, guard rails) never reaches the browser bundle. Browser-side
    // and shared code may not import it. Server components under src/app may.
    files: ['src/platform/**', 'src/workspace/**', 'src/shared/**', 'src/app/(workspace)/WorkspaceLoader.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server',
                '@/server/**',
                '@/lib/model',
                '**/src/server/**',
                '../server/**',
                '../../server/**',
                '../../../server/**',
              ],
              message: 'Browser and shared code may not import server code (CLAUDE.md rule 2). Call an API route instead.',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
