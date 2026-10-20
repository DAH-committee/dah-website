# 시험용 그림 생성(저작권 자산 없이). 실행: python3 make-assets.py
from PIL import Image, ImageDraw, ImageFont
import os
here = os.path.dirname(os.path.abspath(__file__))
FONT = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
def font(sz, idx=0):
    try: return ImageFont.truetype(FONT, sz, index=idx)
    except Exception: return ImageFont.load_default()
# 로고 자리표시(가로 3:1)
W, H = 360, 120
im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
for i, c in enumerate(['#8fd0c8', '#5aa6c9', '#2e7aa8']):
    d.arc((8 + i * 6, 14 + i * 5, 100 + i * 6, 96 + i * 5), 200, 340, fill=c, width=6)
d.text((118, 22), '한림대학교', font=font(46, 6), fill='#2b7a8c')
d.text((120, 84), 'HALLYM UNIVERSITY', font=font(17, 4), fill='#2b7a8c')
im.save(os.path.join(here, 'logo.png'), optimize=True)
# 그림 자리표시(막대 그래프 비슷한 도형, 4:3)
W, H = 480, 300
im = Image.new('RGB', (W, H), '#f4f6fb'); d = ImageDraw.Draw(im)
d.rectangle((0, 0, W - 1, H - 1), outline='#9aa5c8', width=3)
for i, h in enumerate([90, 150, 120, 200]):
    x = 60 + i * 100
    d.rectangle((x, H - 40 - h, x + 60, H - 40), fill=['#3b5bdb', '#4c6ef5', '#748ffc', '#91a7ff'][i])
d.text((16, 10), '그림 자리표시', font=font(22, 6), fill='#1c2a6b')
im.save(os.path.join(here, 'figure.png'), optimize=True)
