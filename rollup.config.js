import typescript from '@rollup/plugin-typescript';
import tsConfigPaths from 'rollup-plugin-tsconfig-paths';

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'es',
  },
  plugins: [typescript(), tsConfigPaths()],
};
