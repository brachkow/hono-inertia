import { defineConfig } from 'eslint-config-fans';

export default defineConfig(
  {
    typescript: true,
    test: true,
    formatter: 'prettier',
  },
  {
    rules: {
      // A single replacement per abbreviation lets `eslint --fix` rename it;
      // with several candidates the rule only reports.
      'unicorn/prevent-abbreviations': [
        'error',
        {
          replacements: {
            res: { response: true, resource: false, result: false },
            def: {
              deferred: true,
              defer: false,
              define: false,
              definition: false,
            },
          },
        },
      ],
      // `() => undefined` is how a TypeScript callback says "returns nothing";
      // rewriting it to `() => {}` changes the return type to void. Tests pass
      // `undefined` on purpose to cover that input.
      'unicorn/no-useless-undefined': [
        'error',
        { checkArrowFunctionBody: false, checkArguments: false },
      ],
    },
  },
);
