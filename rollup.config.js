import typescript from '@rollup/plugin-typescript';
import tsConfigPaths from 'rollup-plugin-tsconfig-paths';
import json from '@rollup/plugin-json';

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'es',
    entryFileNames: 'agrippa.js',
  },
  plugins: [typescript(), tsConfigPaths(), json()],
};
