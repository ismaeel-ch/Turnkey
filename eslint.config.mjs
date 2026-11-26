import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/vendor/**', 'tests/e2e/**', 'scripts/gen-icons.cjs']),
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
      'src/workspace/icons.ts',
      'src/workspace/quests.ts',
      'src/workspace/registry.ts',
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
