"""Update the existing unpacked installation without accessing Chrome profile data."""
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / 'extension'
    # Keep this path even when the extension version changes: Chrome uses it as identity.
    target = ROOT / 'dist' / 'Pickmark-0.1.20'
    if not (target / 'manifest.json').is_file():
        raise ValueError('找不到原安装目录；请先核对 Chrome 的加载位置，不会创建新安装。')
    if target.resolve() != target or (target / 'manifest.json').is_symlink():
        raise ValueError('原安装目录或清单不能是符号链接。')
    current = json.loads((target / 'manifest.json').read_text())
    updated = json.loads((source / 'manifest.json').read_text())
    if any(current.get(key) != updated.get(key) for key in ('manifest_version', 'name', 'key')):
        raise ValueError('扩展身份字段发生变化，已停止同步；请核对，不会替换原安装。')

    files = []
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if any(part.startswith('.') for part in relative.parts):
            continue
        destination = target / relative
        if path.is_symlink() or destination.resolve() != destination:
            raise ValueError(f'程序文件路径不能包含符号链接：{relative}')
        if not path.is_file():
            continue
        if destination.exists() and not destination.is_file():
            raise ValueError(f'目标程序文件不是普通文件：{relative}')
        files.append((relative, destination, path.read_bytes()))

    # Publish the manifest last; every replacement is atomic, and extra files are retained.
    files.sort(key=lambda entry: entry[0] == Path('manifest.json'))
    changed = 0
    for relative, destination, content in files:
        if destination.is_file() and destination.read_bytes() == content:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.sync-', delete=False) as temp:
            temporary = Path(temp.name)
            try:
                temp.write(content)
                temp.flush()
                os.replace(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)
        changed += 1
    for relative, destination, content in files:
        if destination.read_bytes() != content:
            raise ValueError(f'同步后文件校验失败：{relative}')
    print(f'已同步至原安装目录：{target}')
    print(f'版本 {updated["version"]}；校验 {len(files)} 个程序文件，更新 {changed} 个。')
    print('未删除额外文件，未访问 Chrome 数据目录。请重新加载原插件并重新打开面板。')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(f'同步失败：{error}', file=sys.stderr)
        sys.exit(1)
