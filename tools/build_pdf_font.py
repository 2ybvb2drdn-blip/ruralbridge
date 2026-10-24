#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建 PDF 导出用的中文字体子集：web/fonts/rb-cjk.ttf

为什么需要这一步：
    浏览器无法直接生成 PDF，PDF 里的中文又必须嵌入字体。
    完整 Noto Sans SC 有 10MB+，不适合随站点分发，
    所以预先裁成「应用文案 + GB2312 一级字」的合集（约 3900 字形 / 1.1MB），
    导出时前端再按本次实际用到的字做二次子集，成品 PDF 通常 30-60KB。

字体来源：
    Noto Sans SC（Google Fonts，SIL Open Font License 1.1）
    许可全文见 web/fonts/OFL.txt

用法：
    pip3 install fonttools brotli
    python3 tools/build_pdf_font.py

    产物已提交到仓库，正常开发不需要重跑；
    只有要改字符覆盖范围时才需要。
"""
import glob
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO, 'web')
OUT = os.path.join(WEB, 'fonts', 'rb-cjk.ttf')

SRC_URL = ('https://cdn.jsdelivr.net/gh/google/fonts@main/'
           'ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf')


def collect_chars():
    """应用自身出现的所有字符 + GB2312 一级字（覆盖人名用字）+ ASCII + 标点"""
    app = set()
    for p in glob.glob(os.path.join(WEB, '**', '*'), recursive=True):
        if not os.path.isfile(p) or not p.endswith(('.js', '.html', '.css')):
            continue
        try:
            with open(p, encoding='utf-8') as f:
                app |= set(f.read())
        except Exception:
            pass

    gb1 = set()
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                gb1.add(bytes([hi, lo]).decode('gb2312'))
            except Exception:
                pass

    ascii_ = set(chr(i) for i in range(0x20, 0x7F))
    punct = set('，。、；：？！（）《》〈〉「」『』【】—…·～“”‘’％℃　')
    punct |= set('·•–—―°±×÷≈≠≤≥√∞')

    return ''.join(sorted(app | gb1 | ascii_ | punct))


def main():
    if not os.path.isdir(os.path.join(WEB, 'fonts')):
        os.makedirs(os.path.join(WEB, 'fonts'))

    work = os.path.join(REPO, '.wrangler', 'fontbuild')
    os.makedirs(work, exist_ok=True)
    vf = os.path.join(work, 'NotoSansSC-VF.ttf')

    if not os.path.exists(vf):
        print('下载 Noto Sans SC 可变字体 ...')
        subprocess.run(['curl', '-sL', '--max-time', '600', '-o', vf, SRC_URL], check=True)
    print('源字体: %.1f MB' % (os.path.getsize(vf) / 1024 / 1024))

    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    print('实例化静态 400 字重 ...')
    f = TTFont(vf)
    inst = instancer.instantiateVariableFont(f, {'wght': 400}, inplace=False)
    static = os.path.join(work, 'NotoSansSC-400.ttf')
    inst.save(static)

    chars = collect_chars()
    print('字符集: %d 个' % len(chars))
    chars_file = os.path.join(work, 'chars.txt')
    with open(chars_file, 'w', encoding='utf-8') as fh:
        fh.write(chars)

    print('生成子集 ...')
    subprocess.run([
        sys.executable, '-m', 'fontTools.subset', static,
        '--text-file=' + chars_file,
        '--output-file=' + OUT,
        '--no-hinting',
        '--drop-tables+=GSUB,GPOS,GDEF,DSIG,BASE,STAT,gasp,kern,feat,HVAR,MVAR,vhea,vmtx',
        '--layout-features=',
        '--name-IDs=1,2,3,4,6',
        '--notdef-outline',
        '--recalc-bounds',
    ], check=True)

    t = TTFont(OUT)
    comp = [n for n in t.getGlyphOrder() if t['glyf'][n].numberOfContours < 0]
    print('完成: %s' % OUT)
    print('  字形 %d | 复合字形 %d（必须为 0，前端子集依赖此前提）'
          % (t['maxp'].numGlyphs, len(comp)))
    print('  大小 %.1f KB' % (os.path.getsize(OUT) / 1024))
    if comp:
        print('  ⚠ 存在复合字形，前端 pdfFont.subset 不会展开它们，请改用展平后的字体')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
