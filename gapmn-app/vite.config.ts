import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

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
})
