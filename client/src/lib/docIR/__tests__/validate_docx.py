# docx 의 word/*.xml 을 ECMA-376 Transitional XSD 로 검사한다. 사용: python3 validate_docx.py <docx> <xsd 폴더(wml.xsd 가 있는 곳)>
# XSD 는 저장소에 두지 않는다(약 2MB). 받는 곳: github.com/ComposioHQ/awesome-claude-skills/document-skills/docx/ooxml/schemas/ISO-IEC29500-4_2016
import sys, zipfile
from lxml import etree

MAIN = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
KEEP_ELEM = {MAIN,
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://schemas.openxmlformats.org/drawingml/2006/picture',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://schemas.openxmlformats.org/officeDocument/2006/math'}
KEEP_ATTR = KEEP_ELEM | {'http://www.w3.org/XML/1998/namespace'}

def clean(e):
    for c in list(e):
        if not isinstance(c.tag, str): continue
        ns = etree.QName(c).namespace
        if ns not in KEEP_ELEM:
            e.remove(c); continue
        clean(c)
    for a in list(e.attrib):
        if a.startswith('{') and etree.QName(a).namespace not in KEEP_ATTR: del e.attrib[a]

def main():
    docx, xsd = sys.argv[1], sys.argv[2].rstrip('/') + '/'
    schema = etree.XMLSchema(etree.parse(xsd + 'wml.xsd'))
    z = zipfile.ZipFile(docx)
    bad = 0
    for n in z.namelist():
        if not n.startswith('word/') or not n.endswith('.xml') or '/_rels/' in n: continue
        doc = etree.fromstring(z.read(n))
        if etree.QName(doc).namespace != MAIN: continue
        clean(doc)
        if schema.validate(doc): print('ok', n)
        else:
            bad += 1
            print('INVALID', n)
            for er in list(schema.error_log)[:20]: print('  line', er.line, er.message[:300])
    sys.exit(1 if bad else 0)
main()
