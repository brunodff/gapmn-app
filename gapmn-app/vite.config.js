import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
// Plugin: copia public/ ignorando .git e subdiretórios git
function copyPublicWithoutGit() {
    return {
        name: 'copy-public-without-git',
        enforce: 'post',
        closeBundle: function () {
            var src = path.resolve(__dirname, 'public');
            var dest = path.resolve(__dirname, 'dist');
            function copy(s, d) {
                var entries = fs.readdirSync(s, { withFileTypes: true });
                for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                    var e = entries_1[_i];
                    if (e.name === '.git')
                        continue;
                    var sp = path.join(s, e.name);
                    var dp = path.join(d, e.name);
                    if (e.isDirectory()) {
                        fs.mkdirSync(dp, { recursive: true });
                        copy(sp, dp);
                    }
                    else if (!fs.existsSync(dp))
                        fs.copyFileSync(sp, dp);
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
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
