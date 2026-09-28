import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: { popup: 'src/popup/popup.tsx', content: 'src/content/index.ts' }, bundle: true, outdir: 'dist', format: 'iife', platform: 'browser', target: 'chrome120', sourcemap: true });
