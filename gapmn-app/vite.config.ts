import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Sobras de versões antigas que continuam no repositório mas não vão para o site (desativadas em
// 23/10/2026): o "Dashboard CAE" e a config da Vercel (hospedagem antiga, conta bloqueada), as funções
// /api da Vercel (não rodam na Cloudflare) e três páginas de apresentação, guia e relatório desatualizadas.
// Os endereços antigos são redirecionados para o app em src/App.tsx.
const FORA_DO_SITE = new Set([
  'dashboard.html', 'vercel.json', 'api',
  'apresentacao-gapmn.html', 'guia-tecnico-gapmn.html', 'relatorio-gapmn.html',
])

// Plugin: copia public/ ignorando .git e subdiretórios git
function copyPublicWithoutGit() {
  return {
    name: 'copy-public-without-git',
    enforce: 'post' as const,
    closeBundle() {
      const src = path.resolve(__dirname, 'public');
      const dest = path.resolve(__dirname, 'dist');
      function copy(s: string, d: string) {
        const entries = fs.readdirSync(s, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === '.git') continue;
          if (s === src && FORA_DO_SITE.has(e.name)) continue;
          const sp = path.join(s, e.name);
          const dp = path.join(d, e.name);
          if (e.isDirectory()) { fs.mkdirSync(dp, { recursive: true }); copy(sp, dp); }
          else if (!fs.existsSync(dp)) fs.copyFileSync(sp, dp);
        }
      }
      copy(src, dest);
    },
  };
}

export default defineConfig({
  // Desativa a cópia padrão do publicDir (evita erro com public/.git no Windows)
  publicDir: false,
  plugins: [react(), copyPublicWithoutGit()],
  // O alias também precisa estar aqui: o `tsc -b` do build regenera o vite.config.js a partir deste arquivo
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
