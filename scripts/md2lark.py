#!/usr/bin/env python3
r"""Convert a PRD Markdown file to Feishu Docx XML.

Usage:
    python3 scripts/md2lark.py <input.md> [output.xml]

Reads Markdown from <input.md>, writes XML to stdout (or <output.xml> if given).
The XML is ready for `lark-cli docs +create --content @output.xml` or
`lark-cli docs +update --command overwrite --content @output.xml`.

Handles: headings, tables, mermaid -> <whiteboard type="mermaid">,
markdown task lists -> <checkbox>, blockquotes, lists, inline bold/code.
Text inside tags is XML-escaped (& < >).

## 踩坑记录（固化，勿删 —— 每条都曾在真实同步中出错）

1. **mermaid 必须走 XML 格式**：飞书 Markdown 导入遇到 `<whiteboard>` 标签
   会直接后端报错 10071；画板只能用 `--doc-format xml` + `<whiteboard type="mermaid">`。
   本脚本输出 XML，不要在外部再套 `--doc-format markdown`。

2. **task list 判定必须先于 unordered list**：`- [ ]` 既匹配 `^-\s*\[` 也匹配
   `^[-*]\s+`，顺序颠倒会把 checkbox 全解析成普通 `<li>`。下面代码里 task-list
   分支必须排在 ul 分支之前。（注释中的 `\s` 在源码里写为原始字符串 `r"..."`，避免转义告警）

3. **首行 H1 删除**：同步前调用方应去掉文档首行 `# 标题`，标题由飞书文档自身的
   `<title>` 承担。若 Markdown 带 H1，会生成重复标题。

4. **表格头行检测**：靠"下一行是 `|---|---|` 分隔行"判定 `<th>`。分隔行本身跳过。

5. **转义顺序**：先 XML 转义（& < >），再做 `**bold**`/`` `code` `` 行内标记，
   避免标记内部的特殊字符被二次转义。
"""
import re
import sys


def esc(t: str) -> str:
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def inline(t: str) -> str:
    # order matters: escape first, then re-apply inline markup on safe text
    t = esc(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)          # code spans
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)          # bold
    t = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', t)  # italic
    return t


def convert(md: str) -> str:
    lines = md.split('\n')
    out = []
    i, n = 0, len(lines)
    in_table = False
    in_code = False
    code_buf = []
    in_ul = False

    def close_ul():
        nonlocal in_ul
        if in_ul:
            out.append('</ul>')
            in_ul = False

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # code block (mermaid / other)
        if stripped.startswith('```'):
            if in_code:
                lang = code_buf[0]
                body = '\n'.join(code_buf[1:])
                if lang == 'mermaid':
                    out.append('<whiteboard type="mermaid">')
                    out.append(body)
                    out.append('</whiteboard>')
                else:
                    out.append(f'<pre lang="{lang}"><code>{esc(body)}</code></pre>')
                code_buf, in_code = [], False
            else:
                code_buf = [stripped[3:].strip() or 'text']
                in_code = True
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        # table separator row (skip, used only for header detection)
        if stripped.startswith('|') and re.match(r'^\|[\s:|-]+\|$', stripped):
            i += 1
            continue

        # table row
        if stripped.startswith('|'):
            cells = [c.strip() for c in stripped.strip('|').split('|')]
            if not in_table:
                in_table = True
                out.append('<table>')
            is_header = (
                i + 1 < n and re.match(r'^\|[\s:|-]+\|$', lines[i + 1].strip())
            )
            tag = 'th' if is_header else 'td'
            out.append('<tr>' + ''.join(f'<{tag}>{inline(c)}</{tag}>' for c in cells) + '</tr>')
            i += 1
            continue

        if in_table:
            out.append('</table>')
            in_table = False

        # heading
        m = re.match(r'^(#{1,6})\s+(.*)', stripped)
        if m:
            close_ul()
            level = len(m.group(1))
            out.append(f'<h{level}>{inline(m.group(2))}</h{level}>')
            i += 1
            continue

        # blockquote
        if stripped.startswith('>'):
            close_ul()
            content = stripped.lstrip('>').strip()
            out.append(f'<blockquote><p>{inline(content)}</p></blockquote>')
            i += 1
            continue

        # horizontal rule
        if stripped in ('---', '***'):
            close_ul()
            out.append('<hr/>')
            i += 1
            continue

        # task list — MUST precede unordered list (see 踩坑 2)
        tm = re.match(r'^-\s*\[([ xX])\]\s+(.*)', stripped)
        if tm:
            close_ul()
            done = 'true' if tm.group(1) in 'xX' else 'false'
            out.append(f'<checkbox done="{done}">{inline(tm.group(2))}</checkbox>')
            i += 1
            continue

        # unordered list
        if re.match(r'^[-*]\s+', stripped):
            if not in_ul:
                in_ul = True
                out.append('<ul>')
            content = re.sub(r'^[-*]\s+', '', stripped)
            out.append(f'<li>{inline(content)}</li>')
            i += 1
            continue

        # blank line
        if not stripped:
            close_ul()
            i += 1
            continue

        # paragraph
        close_ul()
        out.append(f'<p>{inline(stripped)}</p>')
        i += 1

    close_ul()
    if in_table:
        out.append('</table>')
    return '\n'.join(out)


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    src = sys.argv[1]
    with open(src, encoding='utf-8') as f:
        md = f.read()
    xml = convert(md)
    if len(sys.argv) >= 3:
        with open(sys.argv[2], 'w', encoding='utf-8') as f:
            f.write(xml)
    else:
        print(xml)


if __name__ == '__main__':
    main()
