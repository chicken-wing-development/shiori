from pathlib import Path
import argparse
import hashlib
import json
import struct
import zipfile

root = Path.cwd()
parser = argparse.ArgumentParser()
parser.add_argument('--release-directory', default='releases/v1.0.0/windows-export-security')
parser.add_argument('--output', default='test-results/export-security-fix/distribution-verification.json')
args = parser.parse_args()
release = root / args.release_directory
results = []
for arch, target, machine in [('arm64', 'aarch64-pc-windows-msvc', 0xaa64), ('x64', 'x86_64-pc-windows-msvc', 0x8664)]:
    source = (root / f'src-tauri/target/{target}/release/shiori-markdown.exe').read_bytes()
    assert source[:2] == b'MZ'
    pe = struct.unpack_from('<I', source, 0x3c)[0]
    assert struct.unpack_from('<H', source, pe + 4)[0] == machine
    assert b'jp.shiori.markdown.security-tests' not in source
    expected = hashlib.sha256(source).hexdigest()
    assert hashlib.sha256((release / f'shiori-1.0.0-{arch}/shiori-markdown.exe').read_bytes()).hexdigest() == expected
    for name in [f'shiori-1.0.0-{arch}.zip', f'Shiori.Markdown.Development_1.0.0.0_{arch}.msix']:
        artifact = release / name
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        assert artifact.with_suffix(artifact.suffix + '.sha256').read_text(encoding='utf-8-sig').split()[0].lower() == digest
        with zipfile.ZipFile(artifact) as archive:
            executables = [entry for entry in archive.namelist() if entry.endswith('shiori-markdown.exe')]
            assert len(executables) == 1
            assert hashlib.sha256(archive.read(executables[0])).hexdigest() == expected
            assert any('THIRD-PARTY-RUST-LICENSES' in entry for entry in archive.namelist())
            if artifact.suffix == '.msix':
                for logo in ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png']:
                    assert archive.read(f'Assets/{logo}') == (root / 'src-tauri/icons' / logo).read_bytes()
        results.append({'file': name, 'architecture': arch, 'bytes': artifact.stat().st_size, 'sha256': digest, 'embeddedExeMatchesBuild': True, 'developmentHarnessAbsent': True})
for file in (root / 'dist-desktop').rglob('*.js'):
    assert '__security-results' not in file.read_text(encoding='utf8')
(root / args.output).write_text(json.dumps(results, indent=2), encoding='utf8')
print(json.dumps(results, indent=2))
