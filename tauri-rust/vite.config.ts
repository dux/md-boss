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

// Tauri expects a fixed dev port and no auto-fallback, and watches its own
// Rust tree - keep vite out of src-tauri.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [fez()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
