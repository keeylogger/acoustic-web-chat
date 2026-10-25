import { build } from 'esbuild';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function awcWorklet(): Plugin {
  let building = Promise.resolve();
  const rebuild = () => {
    building = build({
      entryPoints: [resolve('src/audio/rx-worklet.ts')],
      bundle: true,
      format: 'iife',
      outfile: resolve('public/awc-rx-worklet.js'),
      target: 'es2020',
      legalComments: 'none',
      banner: {
        js: '/* Generated from src/audio/rx-worklet.ts. Do not edit. */',
      },
    }).then(() => undefined);
    return building;
  };

  return {
    name: 'awc-worklet',
    buildStart: rebuild,
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (file.includes(`${resolve('src')}`) && (file.includes(`${resolve('src', 'phy')}`) || file.endsWith('rx-worklet.ts'))) {
          void rebuild();
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [awcWorklet()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    headers: {
      'Cache-Control': 'no-store',
    },
  },
});
