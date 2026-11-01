import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const FORBIDDEN_IN_CORE = {
  group: ['next', 'next/*', 'react', 'react-dom', 'apps/*', '**/apps/*'],
  message: 'Core stays framework-free (NFR-ARCH-1).',
};

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/.next/', '**/.turbo/', '**/coverage/'] },
  js.configs.recommended,
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
          ],
        },
      ],
    },
  },
  prettier,
);
