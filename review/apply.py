"""Apply exact, review-only line edits to verified baseline files."""
from pathlib import Path
import hashlib,json
for item in json.loads(Path('review/application-edits.json').read_text()):
    path=Path(item['path'])
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe path')
    data=path.read_bytes()
    sha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if sha!=item['base']:
        raise RuntimeError(f'Baseline changed: {path} ({sha})')
    lines=data.decode('utf-8').splitlines(keepends=True)
    for start,count,new in reversed(item['edits']):
        lines[start:start+count]=new.splitlines(keepends=True)
    path.write_text(''.join(lines),encoding='utf-8')
    print(path)
