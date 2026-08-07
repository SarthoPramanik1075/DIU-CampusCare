import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration.
 *
 * Note on scope: ESLint enforces *style and local correctness* here. The
 * architectural rules DR-1…DR-7 (ARCHITECTURE §3.2) are enforced by the
 * architecture test suite, not by lint, because they are assertions about the
 * shape of the whole system rather than about any one file. Two of them —
 * DR-1 and DR-6 — additionally get a cheap lint-level guard below, so a
 * developer sees the violation in their editor rather than in CI.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    rules: {
      // Unused variables are an error, but an underscore prefix opts out —
      // needed for deliberately-ignored callback parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ARCHITECTURE §10.5: domain operations return an explicit Result.
      // Floating promises hide failure paths, which is the same mistake in a
      // different shape.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // NFR-SEC-07: no internal detail may leak. Template-literal coercion of
      // an unknown is a common route for an object to end up in a message.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],

      // Node ESM requires explicit extensions on relative imports.
      'import-x/extensions': ['error', 'ignorePackages', { ts: 'never' }],
      'import-x/no-duplicates': 'error',
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // console is not a logging strategy. ARCHITECTURE §11 specifies three
      // structured streams with a redaction filter; console bypasses all of it.
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': 'error',
      'prefer-const': 'error',
    },
  },

  // DR-1 / DR-6 editor-level guard. The authoritative check is the
  // architecture test suite; this exists so the mistake is visible sooner.
  {
    files: ['apps/*/src/kernel/**/*.ts'],
    rules: {
      'import-x/no-restricted-paths': 'off', // superseded by the architecture suite
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/**'],
              message:
                'DR-1: the kernel may never import from a domain module. See ARCHITECTURE §3.2.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/*/src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['fastify', 'kysely', 'pg', '**/infrastructure/**'],
              message:
                'DR-6: the domain layer has no dependency on any framework, HTTP type or persistence type. See ARCHITECTURE §3.2.',
            },
          ],
        },
      ],
    },
  },

  // Test files: relax the rules that fight test ergonomics without hiding bugs.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // `expect(fake.someMethod).toHaveBeenCalledWith(...)` is the standard
      // vitest mock-assertion shape; the rule is guarding against a real
      // `this` binding hazard that cannot occur here — `someMethod` is
      // never invoked unbound, only referenced for the spy call it already
      // recorded.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // apps/web — React accessibility and hooks correctness. FRONTEND.md's
  // obligations (O1…O6) are largely accessibility requirements, so
  // jsx-a11y's checks are not boilerplate here; they are load-bearing for
  // the same requirements the component API shapes already enforce.
  {
    files: ['apps/web/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Command-line tooling. `no-console` exists because ARCHITECTURE §11
  // specifies three structured log streams with a redaction filter, and a
  // service writing to console bypasses all of it. A migration CLI is not a
  // service: stdout is its interface, and progress output is the point.
  {
    files: ['packages/db-tools/src/**/*.ts', 'tools/**/*.ts', 'tools/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Plain Node scripts (no tsconfig, hence no typed linting and no TS-aware
  // `no-undef` suppression) — declare the two Node globals they use.
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
