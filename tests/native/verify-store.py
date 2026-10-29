"""Validate the actual submission bundle, identity, binary payloads and block hashes."""
from pathlib import Path
import base64
import hashlib
import io
import json
import struct
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parents[2]
identity = json.loads((root / 'store/store-identity.json').read_text(encoding='utf-8-sig'))
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
release = root / f'releases/v{version}/store'
ns = {'a': 'http://schemas.microsoft.com/appx/manifest/foundation/windows10',
      'u': 'http://schemas.microsoft.com/appx/manifest/uap/windows10',
      'r': 'http://schemas.microsoft.com/appx/manifest/uap/windows10/restrictedcapabilities'}

def verified_file(file):
    content = file.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    assert file.with_suffix(file.suffix + '.sha256').read_text(encoding='utf-8-sig').split()[0] == digest
    return content, digest

def check_blocks(archive):
    blockmap = ET.fromstring(archive.read('AppxBlockMap.xml'))
    assert blockmap.attrib['HashMethod'] == 'http://www.w3.org/2001/04/xmlenc#sha256'
    checked = 0
    for file in blockmap:
        content = archive.read(file.attrib['Name'].replace('\\', '/'))
        assert len(content) == int(file.attrib['Size'])
        blocks = file.findall('{http://schemas.microsoft.com/appx/2010/blockmap}Block')
        assert len(blocks) == (len(content) + 65535) // 65536
        for index, block in enumerate(blocks):
            digest = hashlib.sha256(content[index * 65536:(index + 1) * 65536]).digest()
            assert base64.b64decode(block.attrib['Hash'], validate=True) == digest
        for file_hash in file.findall('{http://schemas.microsoft.com/appx/2021/blockmap}FileHash'):
            assert base64.b64decode(file_hash.attrib['Hash'], validate=True) == hashlib.sha256(content).digest()
        checked += 1
    return checked

results = []
manifests = []
packages = {}
for arch, triple, machine in [('x64', 'x86_64-pc-windows-msvc', 0x8664), ('arm64', 'aarch64-pc-windows-msvc', 0xaa64)]:
    file = release / 'packages' / f'{identity["identityName"]}_{version}.0_{arch}.msix'
    content, digest = verified_file(file)
    packages[file.name] = content
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert archive.testzip() is None
        manifest = ET.fromstring(archive.read('AppxManifest.xml'))
        package_id = manifest.find('a:Identity', ns)
        assert package_id.attrib == {'Name': identity['identityName'], 'Publisher': identity['publisher'],
                                     'Version': version + '.0', 'ProcessorArchitecture': arch}
        assert 'development' not in package_id.attrib['Name'].lower()
        assert manifest.findtext('a:Properties/a:DisplayName', namespaces=ns) == identity['displayName']
        assert manifest.findtext('a:Properties/a:PublisherDisplayName', namespaces=ns) == identity['publisherDisplayName']
        assert 'HTML・PDF' in manifest.findtext('a:Properties/a:Description', namespaces=ns)
        application = manifest.find('a:Applications/a:Application', ns)
        assert application.attrib['Executable'] == 'shiori-markdown.exe'
        assert application.find('u:VisualElements', ns).attrib['DisplayName'] == identity['displayName']
        target = manifest.find('a:Dependencies/a:TargetDeviceFamily', ns)
        assert target.attrib['Name'] == 'Windows.Desktop'
        assert target.attrib['MinVersion'] == '10.0.22000.0'
        assert [c.attrib['Name'] for c in manifest.find('a:Capabilities', ns)] == ['runFullTrust']
        exe = archive.read('shiori-markdown.exe')
        assert exe == (root / f'src-tauri/target/{triple}/release/shiori-markdown.exe').read_bytes()
        assert struct.unpack_from('<H', exe, struct.unpack_from('<I', exe, 0x3c)[0] + 4)[0] == machine
        assert b'jp.shiori.markdown.security-tests' not in exe
        assert 'shiori markdown editor'.encode('utf-16le') in exe
        for logo in ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png']:
            assert archive.read('Assets/' + logo) == (root / 'src-tauri/icons' / logo).read_bytes()
        for notice in ['THIRD-PARTY-JAVASCRIPT-LICENSES.md', 'THIRD-PARTY-RUST-LICENSES.txt']:
            assert len(archive.read(notice)) > 1000
        assert any(name.startswith('third-party-sources/') for name in archive.namelist())
        assert archive.read('PRIVACY.md') == (root / 'docs/PRIVACY.md').read_bytes()
        assert 'AppxSignature.p7x' not in archive.namelist(), 'Upload bundle must remain separate from local test signing.'
        checked = check_blocks(archive)
        package_id.set('ProcessorArchitecture', 'ARCH')
        manifests.append(ET.tostring(manifest))
    results.append({'file': file.name, 'architecture': arch, 'bytes': len(content), 'sha256': digest,
                    'blockMapFilesVerified': checked, 'identityAndPayloadVerified': True})
assert manifests[0] == manifests[1], 'Architecture-specific manifests differ beyond ProcessorArchitecture.'
bundle = release / 'upload' / f'{identity["identityName"]}_{version}.0_x64_arm64.msixbundle'
content, digest = verified_file(bundle)
with zipfile.ZipFile(io.BytesIO(content)) as archive:
    bns = {'b': 'http://schemas.microsoft.com/appx/2013/bundle'}
    manifest = ET.fromstring(archive.read('AppxMetadata/AppxBundleManifest.xml'))
    actual = manifest.find('b:Identity', bns)
    for field, value in [('Name', identity['identityName']), ('Publisher', identity['publisher']), ('Version', version + '.0')]:
        assert actual.attrib[field] == value
    entries = manifest.findall('b:Packages/b:Package', bns)
    assert {entry.attrib['Architecture'] for entry in entries} == {'x64', 'arm64'}
    assert {entry.attrib['FileName'] for entry in entries} == set(packages)
    for name, expected in packages.items():
        assert archive.read(name) == expected
    check_blocks(archive)
result = {'packages': results, 'bundle': {'file': bundle.name, 'bytes': len(content), 'sha256': digest,
                                        'embeddedPackagesMatch': True},
          'scope': 'Static package verification; does not run WACK or install the application.',
          'storeUpload': 'Not performed', 'signature': 'Unsigned for Microsoft Store submission'}
output = root / 'test-results/store-preparation/package-verification.json'
output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps(result, indent=2, ensure_ascii=False))
