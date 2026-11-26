import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // The workspace modules are the prototype's source, kept as written and covered by the browser tests.
    'src/legacy/**',
    'src/platform/generated/**',
    'public/vendor/**',
    'tests/e2e/**',
    'scripts/gen-icons.cjs',
  ]),
]);

export default eslintConfig;
