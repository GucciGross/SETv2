"""Reject runtime credential paths even when force-added to Git. Values are never printed."""
from pathlib import PurePosixPath
import subprocess


def sensitive(name: str) -> bool:
    path = PurePosixPath(name)
    env = path.name == '.env' or path.name.startswith('.env.')
    example = path.name == '.env.example' or path.name.endswith('.example')
    return (
        (env and not example)
        or bool(set(path.parts) & {'.codex', 'codex-users', 'credentials', '.ssh'})
        or path.name in {'auth.json', 'credentials.json'}
        or path.suffix in {'.pem', '.key', '.p12', '.pfx', '.dump'}
        or name.startswith(('data/', 'server/data/'))
    )


if __name__ == '__main__':
    paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
    blocked = [path for path in paths if path and sensitive(path)]
    if blocked:
        print('Runtime/credential files must not be tracked:')
        print('\n'.join(blocked))
        raise SystemExit(1)
    print('Tracked credential paths: none')
