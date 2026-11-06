"""
Gera o pacote do Robô de Empenhos para a Chrome Web Store.

  python -X utf8 loja/empacotar_loja.py

Cria dist/robo-empenhos-<versão>-chrome.zip com o manifest limpo para o Chrome:
- sem as chaves do Firefox (browser_specific_settings, sidebar_action, background.scripts);
- sem os endereços de desenvolvimento (localhost) em externally_connectable.

Entram só os arquivos que a extensão usa (manifest, background, lib, runner, sidepanel,
siloms, icons). Testes, documentação e esta pasta ficam de fora.
"""
import json
import zipfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent.parent      # extensao-empenho-bot/
DIST = AQUI / 'dist'
PASTAS = ['lib', 'runner', 'sidepanel', 'siloms', 'icons']
ARQUIVOS = ['background.js']
FORA = {'.DS_Store', 'Thumbs.db'}


def manifest_chrome():
    m = json.loads((AQUI / 'manifest.json').read_text(encoding='utf-8'))
    for chave in ('browser_specific_settings', 'sidebar_action'):
        m.pop(chave, None)
    m['background'] = {k: v for k, v in m['background'].items() if k != 'scripts'}
    ec = m.get('externally_connectable', {})
    if 'matches' in ec:
        ec['matches'] = [u for u in ec['matches'] if 'localhost' not in u]
    return m


def arquivos():
    for nome in ARQUIVOS:
        yield AQUI / nome
    for pasta in PASTAS:
        for p in sorted((AQUI / pasta).rglob('*')):
            if p.is_file() and p.name not in FORA:
                yield p


def main():
    m = manifest_chrome()
    DIST.mkdir(exist_ok=True)
    destino = DIST / f"robo-empenhos-{m['version']}-chrome.zip"
    with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(m, ensure_ascii=False, indent=2))
        n = 1
        for p in arquivos():
            z.write(p, p.relative_to(AQUI).as_posix())
            n += 1
    print(f'✓ {destino.relative_to(AQUI)} ({n} arquivos, {destino.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
