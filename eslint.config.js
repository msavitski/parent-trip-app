// ESLint for the app (web/js), the service worker and this config.
import js from '@eslint/js';
import importX, { createNodeResolver } from 'eslint-plugin-import-x';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.venv/', 'types/'] },

  js.configs.recommended,

  {
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
    },
  },

  {
    files: ['web/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
    plugins: { 'import-x': importX },
    settings: { 'import-x/resolver-next': [createNodeResolver()] },
    rules: {
      // shared state lives in state.js so modules never need to import each other in a circle
      'import-x/no-cycle': 'error',
      'import-x/no-unresolved': 'error',
      'import-x/named': 'error',
      // the browser loads modules by URL: every import needs its .js extension
      'import-x/extensions': ['error', 'always', { ignorePackages: true }],
    },
  },

  {
    files: ['web/sw.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: globals.serviceworker },
  },

  {
    files: ['eslint.config.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
];
