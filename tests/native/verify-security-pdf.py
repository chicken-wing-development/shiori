from pathlib import Path
import json
import unicodedata
from pypdf import PdfReader

directory = Path('test-results/export-security-fix/native')
pdf = directory / 'valid-pdf.pdf'
reader = PdfReader(pdf)
assert len(reader.pages) == 1
page = reader.pages[0]
text = unicodedata.normalize('NFKC', page.extract_text())
for expected in ['実WebView2', 'セキュリティ検証', '画像と日本語', '入力の検証', '安全な出力']:
    assert expected in text, expected
assert abs(float(page.mediabox.width) - 595.28) < 1
assert abs(float(page.mediabox.height) - 841.89) < 1
uris = [str(annotation.get_object().get('/A', {}).get('/URI', '')) for annotation in page.get('/Annots', [])]
assert uris == ['https://example.com/document'], uris
result = {'pages': len(reader.pages), 'bytes': pdf.stat().st_size, 'japaneseAndMermaidTextVerified': True, 'links': uris, 'pageSize': [float(page.mediabox.width), float(page.mediabox.height)], 'images': len(page.images)}
(directory / 'pdf-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(result))
