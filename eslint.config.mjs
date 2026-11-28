import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const REACT_FILES = ['apps/web/**/*.{ts,tsx,js,mjs}', 'packages/ui/**/*.{ts,tsx}'];

// Next and React rules (ADR-007), scoped to the React code. Our own TypeScript setup
// below replaces next/typescript, which would register the plugin a second time.
const nextConfigs = nextVitals
  .filter((config) => config.name !== 'next/typescript')
  .map((config) => (config.ignores && !config.name ? config : { ...config, files: REACT_FILES }));

const FORBIDDEN_IN_CORE = {
  group: ['next', 'next/*', 'react', 'react-dom', 'apps/*', '**/apps/*'],
  message: 'Core stays framework-free (NFR-ARCH-1).',
};

// ADR-015, ADR-037: every email leaves through the one provider the worker builds, wrapped by
// the redirect and the staging banner. Nothing else may build a sender, so an override such as
// EMAIL_REDIRECT_TO can't be bypassed.
const PROVIDER_BUILDERS = [
  'createMailgunProvider',
  'createLogProvider',
  'createNoEmailProvider',
  'withRedirect',
  'withTestBanner',
];
const PROVIDER_MESSAGE =
  'Only the worker builds the email provider; everything else enqueues email.send (ADR-037).';
// The calls that take SQL as plain text: pg's client.query and the transaction's executeSql.
const RAW_SQL_CALL =
  ':matches(CallExpression[callee.property.name=/^(query|executeSql)$/], CallExpression[callee.name="executeSql"])';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.vitepress/cache/',
      '**/.next/',
      '**/.turbo/',
      '**/coverage/',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...nextConfigs,
  { settings: { next: { rootDir: 'apps/web' } } },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // ADR-008: packages/config is the only reader of process.env
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: ['packages/config/src/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Read env in packages/config (ADR-008).' },
      ],
    },
  },
  {
    // Rule 13, ADR-004: SQL text is never built from values, so injection can't reach the
    // app.rls_system switch. Values go in as parameters; the schema's CHECKs are built from
    // our own constants.
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: ['packages/db/src/schema/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='sql'][property.name='raw']",
          message: 'No sql.raw: pass values as sql`…${value}` parameters (rule 13, ADR-004).',
        },
        {
          selector: `${RAW_SQL_CALL} > TemplateLiteral:first-child[expressions.length>0]`,
          message: 'SQL text with ${…} in it: pass values as $1, $2 parameters (rule 13, ADR-004).',
        },
        {
          selector: `${RAW_SQL_CALL} > :first-child:not(Literal, TemplateLiteral)`,
          message:
            'Write the SQL in place, as one literal, so lint can see it holds no values (rule 13, ADR-004).',
        },
      ],
    },
  },
  {
    // NFR-ARCH-1, NFR-ARCH-5
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [FORBIDDEN_IN_CORE] }],
    },
  },
  {
    // NFR-ARCH-4: sibling modules only through their index.ts
    files: ['packages/core/src/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            FORBIDDEN_IN_CORE,
            {
              regex: '^\\.\\./[^/]+/.+',
              message: 'Import a sibling module through its index.ts (NFR-ARCH-4).',
            },
            { regex: '^\\.\\./email$', importNames: PROVIDER_BUILDERS, message: PROVIDER_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    // The web only enqueues emails; the worker is the one place a provider is built.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@comprobify/core', importNames: PROVIDER_BUILDERS, message: PROVIDER_MESSAGE },
          ],
        },
      ],
    },
  },
  prettier,
);
