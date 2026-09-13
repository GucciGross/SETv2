from pathlib import Path
import subprocess
import tempfile

for service in ('server', 'web', 'channels', 'gateway', 'research'):
    with tempfile.TemporaryDirectory(prefix='set-context-') as tmp:
        root = Path(tmp)
        context = root / 'context'
        context.mkdir()
        (context / '.dockerignore').write_bytes(Path(service, '.dockerignore').read_bytes())
        blocked = ('.env', '.env.production', '.codex/auth.json', 'nested/credentials/key.json',
                   'data/token.json', 'certs/site.key', 'auth.json')
        for name in (*blocked, 'source.txt', '.env.example'):
            p = context / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('FAKE_BUILD_CONTEXT_CANARY_NOT_A_CREDENTIAL')
        (context / 'Dockerfile').write_text('FROM scratch\nCOPY . /\n')
        result = subprocess.run(['docker', 'build', '--output', f'type=local,dest={root / "output"}', str(context)], capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        for name in blocked:
            assert not (root / 'output' / name).exists(), (service, name)
        assert (root / 'output/source.txt').exists()
        assert (root / 'output/.env.example').exists()
        print(service, 'Docker build excludes credential canaries: PASS')
