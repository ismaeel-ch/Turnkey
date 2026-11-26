import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/vendor/**', 'tests/e2e/**', 'scripts/gen-icons.cjs']),
  {
    // Stricter than Next's defaults for all typed code. The block below still turns some of these off for workspace
    // modules that have not been typed yet.
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
    // The workspace modules came from the prototype by an automatic conversion. They keep one mutable store
    // (core.ts: S, U, notify) that components read and write directly, which these rules forbid. Each module moves to
    // typed code and a proper store; remove a rule from this list once no module needs it.
    files: ['src/workspace/**'],
    // Modules that are typed and pass every rule. Add a module here when its `// @ts-nocheck` goes.
    ignores: [
      'src/workspace/agents.ts',
      'src/workspace/builds.ts',
      'src/workspace/core.ts',
      'src/workspace/db.ts',
      'src/workspace/engine.tsx',
      'src/workspace/icons.ts',
      'src/workspace/quests.ts',
      'src/workspace/registry.ts',
      'src/workspace/viewspec.tsx',
      'src/workspace/changes.ts',
      'src/workspace/team-stream.ts',
      'src/workspace/ui.tsx',
      'src/workspace/tester.tsx',
      'src/workspace/team.tsx',
      'src/workspace/line.ts',
      'src/workspace/release.tsx',
      'src/workspace/custom.tsx',
      'src/workspace/tests.tsx',
      'src/workspace/share.tsx',
      'src/workspace/activity.tsx',
      'src/workspace/guide.tsx',
      'src/workspace/mobile.tsx',
      'src/workspace/flow.tsx',
    ],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react/no-unescaped-entities': 'off',
      'prefer-spread': 'off',
      'prefer-const': 'off',
    },
  },
]);

export default eslintConfig;
