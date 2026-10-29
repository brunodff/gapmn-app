import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Painel do Auxílio Transporte como site à parte (projeto próprio na Cloudflare Pages, endereço sem o nome
// do app): só o painel, a partir de painel-at.html. Sai em dist-painel-at/, com index.html, robots.txt e
// _headers (fora dos buscadores e sem enviar o endereço a outros sites).
function arrumarSaida() {
  return {
    name: 'painel-at-saida',
    closeBundle() {
      const d = path.resolve(__dirname, 'dist-painel-at')
      fs.renameSync(path.join(d, 'painel-at.html'), path.join(d, 'index.html'))
      fs.writeFileSync(path.join(d, 'robots.txt'), ['User-agent: *', 'Disallow: /', ''].join('\n'))
      fs.writeFileSync(path.join(d, '_headers'), ['/*', '  X-Robots-Tag: noindex, nofollow', '  Referrer-Policy: no-referrer', ''].join('\n'))
    },
  }
}

export default defineConfig({
  publicDir: false,
  plugins: [react(), arrumarSaida()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    outDir: 'dist-painel-at',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, 'painel-at.html') },
  },
})
