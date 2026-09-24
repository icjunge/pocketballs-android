#!/usr/bin/env python3
"""Restore verified Google Platform 35 and Build Tools 35 (Linux)."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path, PurePosixPath
from urllib.request import urlopen
from zipfile import ZipFile
import argparse, shutil
PACKAGES=(
 ('platform-35_r02.zip',64273788,'0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0'),
 ('build-tools_r35_linux.zip',61958799,'bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88'),
)
def restore(root,package):
 name,size,digest=package
 downloads=root.parent/'downloads';downloads.mkdir(parents=True,exist_ok=True)
 path=downloads/name
 if not path.exists():
  with urlopen('https://dl.google.com/android/repository/'+name,timeout=60) as r,path.open('wb') as f:shutil.copyfileobj(r,f)
 if path.stat().st_size!=size or sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('Checksum mismatch: '+name)
 with ZipFile(path) as z:
  for e in z.infolist():
   p=PurePosixPath(e.filename)
   if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe archive')
  if z.testzip():raise ValueError('Invalid ZIP')
  z.extractall(root)
  for e in z.infolist():
   mode=(e.external_attr>>16)&0o777
   if mode:(root/e.filename).chmod(mode)
 print('Verified and restored',name,flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('sdk_root',type=Path);a=p.parse_args();a.sdk_root.mkdir(parents=True,exist_ok=True)
 with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(lambda x:restore(a.sdk_root,x),PACKAGES))
