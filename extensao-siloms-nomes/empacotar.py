"""Gera os pacotes da extensão "SILOMS — Nome dos Documentos":
   dist/siloms-nomes-<versão>-chrome.zip   (Chrome / Edge: carregar sem compactação ou Chrome Web Store)
   dist/siloms-nomes-<versão>-firefox.zip  (Firefox: manifest.firefox.json vira manifest.json)
Uso: python empacotar.py
"""
import json, os, zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
ARQUIVOS = ['background.js', 'content.js', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png']

versao = json.load(open(os.path.join(AQUI, 'manifest.json'), encoding='utf-8'))['version']
ff = json.load(open(os.path.join(AQUI, 'manifest.firefox.json'), encoding='utf-8'))
assert ff['version'] == versao, 'manifest.json e manifest.firefox.json com versões diferentes'
os.makedirs(os.path.join(AQUI, 'dist'), exist_ok=True)

for navegador, manifesto in (('chrome', 'manifest.json'), ('firefox', 'manifest.firefox.json')):
    destino = os.path.join(AQUI, 'dist', f'siloms-nomes-{versao}-{navegador}.zip')
    with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(AQUI, manifesto), 'manifest.json')
        for a in ARQUIVOS:
            z.write(os.path.join(AQUI, a), a)
    print(destino)
