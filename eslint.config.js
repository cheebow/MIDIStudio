import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', 'test-results', 'playwright-report'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The MIDI core must stay independent of React, DOM, AudioWorklet and SpessaSynth (CLAUDE.md rule 2).
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: { ...globals.es2023 } },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-*', 'spessasynth_*', '**/playback/**', '**/ui/**', '**/app/**', '**/input/**', '**/storage/**'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'AudioContext', 'fetch', 'localStorage', 'navigator', 'indexedDB'],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
