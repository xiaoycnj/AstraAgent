"""Restore normal script/cwd imports for portable Python's explicit search path."""
import os
from pathlib import Path
import sys

arguments = sys.orig_argv[1:]
isolated = bool(os.getenv('PYTHONSAFEPATH'))
target = ''
skip = False
for value in arguments:
    if skip:
        skip = False
        continue
    if value in ('-I', '-P', '-S'):
        isolated = True
    elif value in ('-c', '-m', '-'):
        break
    elif value in ('-X', '-W'):
        skip = True
    elif not value.startswith('-'):
        target = str(Path(value).resolve().parent)
        break
if not isolated:
    if target not in sys.path:
        sys.path.insert(0, target)
