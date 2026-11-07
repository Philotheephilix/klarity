import type { SnapConfig } from '@metamask/snaps-cli';
import { merge } from '@metamask/snaps-cli';

const config: SnapConfig = {
  input: 'src/index.ts',
  server: {
    port: 8080,
  },
  polyfills: true,
  // The source uses NodeNext module resolution, so intra-package imports carry
  // explicit `.js` extensions (required by TypeScript) even though the files on
  // disk are `.ts`/`.tsx`. Teach the webpack resolver to map those extensions
  // back to the real source files so the bundle can be built.
  customizeWebpackConfig: (webpackConfig) =>
    merge(webpackConfig, {
      resolve: {
        extensionAlias: {
          '.js': ['.ts', '.tsx', '.js', '.jsx'],
        },
      },
    }),
};

export default config;
