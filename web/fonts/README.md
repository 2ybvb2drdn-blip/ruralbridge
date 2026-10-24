# PDF 导出用中文字体

`rb-cjk.ttf` 是 **Noto Sans SC** 的子集，只用于「导出 PDF」时嵌入。

## 为什么需要它

浏览器没有生成 PDF 的 API，PDF 里的中文又必须嵌入字体（不嵌就是空白或乱码）。
完整 Noto Sans SC 有 10MB 以上，不适合随站点分发，所以预先裁剪。

## 内容范围

- 应用界面与报告里出现的全部字符
- GB2312 一级汉字（3755 字，覆盖人名用字）
- ASCII 与常用中英标点

合计约 3900 字形，1.1MB。**零复合字形**——这是前端能做运行时子集的前提。

## 体积

站点这份 1.1MB 是懒加载的：不进首屏，只在点「导出 PDF」时才下载。
导出时 `js/pdffont.js` 会按本次实际用到的字再裁一次，
所以生成的 PDF 通常只有 30–60KB。

## 许可

Noto Sans SC 采用 SIL Open Font License 1.1，允许嵌入与再分发。
许可全文见同目录 `OFL.txt`。

## 重新生成

```bash
pip3 install fonttools brotli
python3 tools/build_pdf_font.py
```

正常开发不需要重跑，只有调整字符覆盖范围时才需要。
