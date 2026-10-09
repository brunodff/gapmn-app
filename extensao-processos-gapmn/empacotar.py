"""Gera o pacote da extensão "GAP-MN — Processos ao Vivo":
   dist/processos-ao-vivo-<versão>.zip  (Chrome / Edge: descompactar e "Carregar sem compactação")
e copia para a Área de Trabalho e para o site do app (gapmn-app/public), onde a tela de
Processos oferece o download para a SLIC.
Uso: python empacotar.py
"""
import json, os, shutil, zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
ARQUIVOS = ['manifest.json', 'background.js', 'popup.html', 'popup.js',
            'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png']

versao = json.load(open(os.path.join(AQUI, 'manifest.json'), encoding='utf-8'))['version']
os.makedirs(os.path.join(AQUI, 'dist'), exist_ok=True)
destino = os.path.join(AQUI, 'dist', f'processos-ao-vivo-{versao}.zip')
with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as z:
    for a in ARQUIVOS:
        z.write(os.path.join(AQUI, a), a)
print(destino)

for pasta, nome in ((os.path.expanduser(r'~\OneDrive\Área de Trabalho'), f'processos-ao-vivo-{versao}.zip'),
                    (os.path.join(AQUI, '..', 'gapmn-app', 'public'), 'gapmn-processos-ao-vivo.zip')):
    if os.path.isdir(pasta):
        shutil.copyfile(destino, os.path.join(pasta, nome))
        print(os.path.normpath(os.path.join(pasta, nome)))
