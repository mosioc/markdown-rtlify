# Markdown RTLify

Convert Markdown copied from ChatGPT and other LLMs (Persian, Arabic or Hebrew, often mixed with English, code and math) into **HTML** or **DOCX** that renders correctly right-to-left.

Pasting LLM output into Word or a browser usually breaks in the same ways. `rtlify` targets each of them:

| Problem | What rtlify does |
| --- | --- |
| A Persian paragraph that starts with an English word turns left-to-right | Direction is decided by the **majority of words**, not the first strong character |
| Punctuation and parentheses land in the wrong place | English runs are isolated (`<bdi>` in HTML, per-run RTL flags in DOCX) and sentence punctuation stays outside them |
| Numbers and bullets appear on the wrong side | Direction is set on the whole list, so markers sit on the right in Persian lists |
| English and Persian words appear in the wrong relative order | Each language run is isolated, so the bidi algorithm cannot reorder across them |
| Formulas and code lose their structure | Code and math are always left-to-right islands. Math is rendered with KaTeX (HTML) or converted to native Word equations (DOCX) |

## Requirements

- Node.js 18 or newer
- [pandoc](https://pandoc.org/) (optional, DOCX only): converts LaTeX to editable Word equations. Without it, equations are written as plain LaTeX text and a warning is printed. Tested with pandoc 3.1.3.

## Install

```bash
npm install
```

Dependencies: `markdown-it`, `markdown-it-texmath`, `katex`, `docx`, `jszip`.

## Usage

```bash
node rtlify.mjs input.md -o out.html     # standalone HTML page
node rtlify.mjs input.md -o out.docx     # Word document (format inferred from the extension)

cat input.md | node rtlify.mjs > out.html          # stdin to stdout
pbpaste | node rtlify.mjs -o out.docx              # macOS clipboard
node rtlify.mjs input.md --format docx > out.docx  # explicit format
node rtlify.mjs input.md --fragment                # HTML body only, to embed in your own page
```

### Options

| Option | Description |
| --- | --- |
| `-o, --out <file>` | Write to a file instead of stdout. A `.docx` extension selects DOCX output. |
| `--format html\|docx` | Output format. Default: from the `--out` extension, otherwise `html`. |
| `--fragment` | HTML only. Output just the body, with no `<html>`, CSS or KaTeX stylesheet link. |
| `--ratio <0..1>` | Share of RTL words needed for a block to be RTL. Default `0.4`. |
| `--dir auto\|rtl\|ltr` | Force the direction of every block. Default `auto`. |
| `--font-rtl <name>` | Font for Persian/Arabic/Hebrew text. Default `Vazirmatn`. |
| `--font-latin <name>` | Font for Latin text. Default `Arial`. |
| `--font-mono <name>` | Font for code and ASCII diagrams. Default `Consolas`. |

Try it on the included example:

```bash
node rtlify.mjs sample.md -o sample.html
node rtlify.mjs sample.md -o sample.docx
```

## How it works

1. **Normalize math.** LLM output uses many LaTeX delimiter styles, and not all of them parse reliably. Before parsing, `normalizeMath()` rewrites them to `$…$` / `$$…$$`:
   - `\[ … \]` inside list items, mid-sentence, or on one line (the math plugin only handles it as a top-level block)
   - over-escaped exports such as `\\[ … \\]`, `\\(s\\)`, `\\{ … \\}` and `r\_{t+1}`, where the extra backslashes are removed inside the math only
   - code fences and inline code are left untouched
2. **Parse** with markdown-it.
3. **Detect direction per block** (paragraph, heading, list, blockquote, table, table cell) by counting RTL words against Latin words. In a mostly-RTL document the threshold is halved, so a heading like `راهنمای React Hooks` still goes RTL.
4. **Isolate opposite-direction runs** inside each block. Trailing punctuation such as the `.` in `Next.js.` is kept outside the isolated run.
5. **Emit** HTML or DOCX.

### HTML output

A standalone page with `dir` on every block, `<bdi>` around language runs, left-to-right code and math, and RTL-aware CSS (logical properties for borders and indents). KaTeX styling is loaded from a CDN, so equations need an internet connection to look right. Fonts follow the `--font-*` options. With the default Vazirmatn, the page also loads it from the jsDelivr CDN, so it renders correctly even where the font is not installed. The body stack is `<rtl font>, <latin font>, "Noto Sans Arabic", Tahoma, system-ui`, so when Vazirmatn is available it also covers Latin text. Code uses `<mono font>, "DejaVu Sans Mono", ui-monospace, Menlo, monospace`.

### DOCX output

- A4 page, 12pt. Persian text uses the complex-script font (`--font-rtl`, default Vazirmatn), Latin text uses `--font-latin` (default Arial), and code uses `--font-mono` (default Consolas). Word does not embed fonts, so Vazirmatn must be installed on the machine that opens the file ([free, OFL licence](https://github.com/rastikerdar/vazirmatn)); otherwise Word substitutes another font.
- RTL paragraphs use Word's bidi setting, and Persian runs carry the RTL flag.
- Lists use real Word numbering (bullets, `1.` / `a.` / `i.` by level, restarting per list).
- Code blocks are one left-aligned, monospaced paragraph per line, so indentation is preserved.
- Tables are mirrored for RTL, with a shaded header row.
- Equations become native Word equations through pandoc. The script also fixes the element order in pandoc's equation XML so strict consumers accept it.
- The ZIP is written without folder entries, which avoids a known Word co-editing problem.

## Programmatic use

```js
import { convert } from './rtlify.mjs';        // Markdown -> HTML string
import { buildDocx } from './docx-writer.mjs'; // Markdown -> Buffer (async)
import { detectDir, normalizeMath, segmentRuns } from './core.mjs';

const fonts = { rtl: 'Vazirmatn', latin: 'Arial', mono: 'Consolas' };
const html = convert(markdown, { ratio: 0.4, forcedDir: 'auto', fragment: false, fonts });
const buf = await buildDocx(markdown, { ratio: 0.4, forcedDir: 'auto', fonts });
```

## Project layout

| File | Purpose |
| --- | --- |
| `rtlify.mjs` | CLI and HTML output |
| `core.mjs` | Shared logic: script and direction detection, run segmentation, math normalization, markdown-it setup |
| `docx-writer.mjs` | Markdown to DOCX, including equation conversion |
| `sample.md` | Persian example covering headings, lists, code, tables, quotes and math |

## Known limitations

- **Direction detection is a heuristic.** Very short or evenly mixed blocks can land on the wrong side. Adjust `--ratio`, or use `--dir rtl` to force it.
- **Equations in DOCX need Word to verify.** LibreOffice builds without the Math module do not render Word equations at all, so a blank space there does not mean the file is broken. If pandoc cannot parse a formula, that formula falls back to LaTeX text.
- **Joined multi-line math.** An indented multi-line `\[ … \]` (inside a list item) is joined onto one line, so a `%` TeX comment inside it would comment out the rest of the formula.
- **Blockquotes in DOCX** are shaded and indented, without a side bar, because Word swaps left and right on RTL paragraphs.
- **Not supported in DOCX:** images (replaced by `[alt text]`), footnotes, task-list checkboxes. Raw HTML in the Markdown is escaped and shown as text in both formats.
- **Pipes in table cells.** A literal `|` inside a Markdown table cell (for example `\pi(a|s)`) must be escaped as `\|`, as in any Markdown table.
- **Ordered-list markers in browsers.** Some browsers display `1.` as `.1` in RTL lists. This is the browser's bidi handling of the marker; a `li::marker` CSS rule can change it.
