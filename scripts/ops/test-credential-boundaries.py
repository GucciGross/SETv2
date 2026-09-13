"""Run with python3 scripts/ops/test-credential-boundaries.py."""
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('boundaries', Path(__file__).with_name('check-credential-boundaries.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for path in ('.env', '.env.production', 'server/.env.local', '.codex/auth.json',
             'server/data/codex-users/abc/auth.json', 'web/certs/site.key',
             'backup.dump', 'credentials/client.json', 'auth.json', '.ssh/id_rsa'):
    assert module.sensitive(path), path
for path in ('.env.example', 'server/.env.production.example', 'server/src/auth/routes.ts',
             'server/sql/001_init.sql', 'server/src/importers/data/schema.json',
             'scripts/ops/check-credential-boundaries.py'):
    assert not module.sensitive(path), path
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['git', 'init', '--quiet', tmp], check=True)
    Path(tmp, '.env').write_text('FAKE_CANARY_NOT_A_CREDENTIAL')
    subprocess.run(['git', '-C', tmp, 'add', '-f', '.env'], check=True)
    result = subprocess.run([sys.executable, str(Path(module.__file__).resolve())], cwd=tmp, capture_output=True, text=True)
    assert result.returncode == 1
    assert '.env' in result.stdout
    assert 'FAKE_CANARY' not in result.stdout
print('Credential path boundaries: passed, including force-added runtime file rejection')
