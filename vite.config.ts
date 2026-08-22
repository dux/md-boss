import { defineConfig, type Plugin } from 'vite'

// A .fez file becomes a Fez.compile(name, source) call against the global Fez
// that main.ts loads first - the same shape @dinoreic/fez/rollup produces,
// without its glob dependency.
function fez(): Plugin {
  return {
    name: 'fez',
    transform(code, id) {
      if (!id.endsWith('.fez')) return null
      const name = id.split('/').pop()!.replace(/\.fez$/, '')
      const src = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
      return { code: `Fez.compile('${name}', \`\n${src}\`)`, map: null }
    },
  }
}

// The shell loads this port in dev (MDBOSS_DEV_URL); a fixed port, no fallback, so the
// two agree. The Rust tree and the server are not vite's to watch.
export default defineConfig({
  plugins: [fez()],
  clearScreen: false,
  base: './',
  server: {
    port: 1430,
    strictPort: true,
    watch: { ignored: ['**/shell/**', '**/server/**'] },
  },
})
