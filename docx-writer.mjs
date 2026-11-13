// Markdown -> DOCX with correct RTL handling (paragraph bidi, run-level rtl flags,
// LTR code blocks, native Word equations via pandoc when available).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as docx from "docx";
import JSZip from "jszip";
import { createRenderer, segmentRuns, normalizeMath } from "./core.mjs";

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  LevelFormat,
  LineRuleType,
} = docx;

const FONT = "Arial";
const MONO = "Consolas";
const CONTENT_WIDTH = 9026; // A4 with 1" margins, in DXA
const HEADINGS = [
  null,
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
const mono = { ascii: MONO, hAnsi: MONO, cs: MONO, eastAsia: MONO };
const grey = (fill) => ({ type: ShadingType.CLEAR, fill, color: "auto" });

// ---------- math: TeX -> OMML (Word-native equations) through pandoc ----------
let pandocMissing = false;

// One pandoc call for a list of equations; null if anything about it fails.
async function pandocBatch(items) {
  const tmp = path.join(
    os.tmpdir(),
    `rtlify-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`,
  );
  try {
    const md = items
      .map((m) => (m.display ? `$$${m.tex.trim()}$$` : `$${m.tex.trim()}$`))
      .join("\n\n");
    execFileSync("pandoc", ["-f", "markdown", "-t", "docx", "-o", tmp], {
      input: md,
      stdio: ["pipe", "ignore", "ignore"],
    });
    const zip = await JSZip.loadAsync(await fs.promises.readFile(tmp));
    const xml = await zip.file("word/document.xml").async("string");
    const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    if (paras.length !== items.length) return null;
    return paras.map((p, i) => {
      const re = items[i].display
        ? /<m:oMathPara>[\s\S]*?<\/m:oMathPara>/
        : /<m:oMath>[\s\S]*?<\/m:oMath>/;
      return fixOmml((p.match(re) || [null])[0]);
    });
  } catch (err) {
    if (err.code === "ENOENT" && !pandocMissing) {
      pandocMissing = true;
      process.stderr.write(
        "rtlify: pandoc not available, equations will be written as LaTeX text.\n",
      );
    }
    return null;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Fast path: all equations in one call. If that fails, convert one by one so that a single
// bad formula only falls back to LaTeX text instead of taking every equation down with it.
async function texToOmml(items) {
  if (!items.length) return [];
  const batch = await pandocBatch(items);
  if (batch) return batch;
  if (pandocMissing || items.length === 1) return items.map(() => null);
  const out = [];
  for (const it of items) out.push((await pandocBatch([it]))?.[0] ?? null);
  return out;
}

// pandoc (<= 3.1) writes <m:dPr> children out of schema order (endChr before sepChr),
// which strict OOXML consumers reject. Put them in the order the schema demands.
const D_ORDER = ["begChr", "sepChr", "endChr", "grow", "shp", "ctrlPr"];
// <m:rPr> children must be: lit, (nor | scr, sty), brk, aln. pandoc sometimes writes sty before scr,
// and <m:nor/> (from \\text{...}) excludes sty/scr entirely.
const R_ORDER = ["lit", "nor", "scr", "sty", "brk", "aln"];
const fixRPr = (frag) =>
  frag.replace(/<m:rPr>([\s\S]*?)<\/m:rPr>/g, (m, inner) => {
    let parts = inner.match(/<m:(\w+)\b[^>]*?\/>/g) || [];
    const name = (p) => p.match(/^<m:(\w+)/)[1];
    if (parts.some((p) => name(p) === "nor"))
      parts = parts.filter((p) => !["sty", "scr"].includes(name(p)));
    parts.sort((a, b) => R_ORDER.indexOf(name(a)) - R_ORDER.indexOf(name(b)));
    return `<m:rPr>${parts.join("")}</m:rPr>`;
  });
const fixOmml = (frag) =>
  frag &&
  fixRPr(frag).replace(/<m:dPr>([\s\S]*?)<\/m:dPr>/g, (_, inner) => {
    const parts =
      inner.match(/<m:(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/m:\1>)/g) || [];
    const rank = (p) => D_ORDER.indexOf(p.match(/^<m:(\w+)/)[1]);
    return `<m:dPr>${parts.sort((a, b) => rank(a) - rank(b)).join("")}</m:dPr>`;
  });

// ---------- token helpers ----------
const findClose = (toks, i) => {
  const close = toks[i].type.replace("_open", "_close");
  for (let j = i + 1; j < toks.length; j++)
    if (toks[j].type === close && toks[j].level === toks[i].level) return j;
  return toks.length;
};

export async function buildDocx(markdown, opts = {}) {
  const md = createRenderer({ ...opts, wrapInline: false });
  const toks = md.parse(normalizeMath(markdown), {});
  const docDir = toks.find((t) => t.type === "inline")?.meta?.dir || "ltr";

  // Pass 1: collect all formulas and convert them in one pandoc call.
  const maths = [];
  const mathIdx = new Map();
  const reg = (tok, display) => {
    mathIdx.set(tok, maths.length);
    maths.push({ tex: tok.content.replace(/\n\s*\n+/g, "\n"), display });
  };
  for (const t of toks) {
    if (t.type === "math_block" || t.type === "math_block_eqno") reg(t, true);
    if (t.type === "inline")
      for (const c of t.children || []) {
        if (c.type === "math_inline") reg(c, false);
        if (c.type === "math_inline_double") reg(c, true);
      }
  }
  const omml = await texToOmml(maths);
  const ommlByPlaceholder = new Map();

  const mathRun = (tok, fmt = {}) => {
    const i = mathIdx.get(tok);
    if (omml[i]) {
      const key = `@@MATH${i}@@`;
      ommlByPlaceholder.set(key, omml[i]);
      return new TextRun({ text: key });
    }
    return new TextRun({
      text: tok.content.trim(),
      italics: true,
      font: {
        ascii: "Cambria Math",
        hAnsi: "Cambria Math",
        cs: "Cambria Math",
      },
      ...fmt,
    });
  };

  // ---------- inline ----------
  const textRuns = (text, dir, fmt) =>
    segmentRuns(text, dir).map((s) => {
      const rtl = (dir === "rtl") !== s.iso;
      return new TextRun({
        text: s.text,
        ...fmt,
        ...(rtl ? { rightToLeft: true } : {}),
      });
    });

  const walkInline = (ch, from, to, dir, st) => {
    const out = [];
    const fmtOf = () => ({
      bold: st.bold || undefined,
      italics: st.italics || undefined,
      strike: st.strike || undefined,
      ...(st.link ? { color: "0563C1", underline: {} } : {}),
    });
    for (let i = from; i < to; i++) {
      const c = ch[i];
      switch (c.type) {
        case "text":
        case "text_special":
          out.push(...textRuns(c.content, dir, fmtOf()));
          break;
        case "softbreak":
          out.push(new TextRun({ text: " " }));
          break;
        case "hardbreak":
          out.push(new TextRun({ break: 1 }));
          break;
        case "code_inline":
          out.push(
            new TextRun({
              text: c.content,
              font: mono,
              shading: grey("EFEFEF"),
              ...fmtOf(),
            }),
          );
          break;
        case "math_inline":
        case "math_inline_double":
          out.push(mathRun(c));
          break;
        case "image":
          out.push(
            new TextRun({ text: `[${c.content || "image"}]`, italics: true }),
          );
          break;
        case "strong_open":
          st.bold = true;
          break;
        case "strong_close":
          st.bold = false;
          break;
        case "em_open":
          st.italics = true;
          break;
        case "em_close":
          st.italics = false;
          break;
        case "s_open":
          st.strike = true;
          break;
        case "s_close":
          st.strike = false;
          break;
        case "link_open": {
          let j = i + 1;
          while (j < to && ch[j].type !== "link_close") j++;
          st.link = true;
          const inner = walkInline(ch, i + 1, j, dir, st);
          st.link = false;
          out.push(
            new ExternalHyperlink({ link: c.attrGet("href"), children: inner }),
          );
          i = j;
          break;
        }
        default:
          break;
      }
    }
    return out;
  };

  // ---------- blocks ----------
  const para = (inl, ctx, extra = {}) => {
    const dir = inl.meta?.dir || docDir;
    const children = walkInline(
      inl.children || [],
      0,
      (inl.children || []).length,
      dir,
      { bold: false, italics: false, strike: false },
    );
    const o = {
      children,
      bidirectional: dir === "rtl",
      spacing: { after: 120, line: 320 },
      ...extra,
    };
    if (ctx.list) {
      if (ctx.take?.v) {
        o.numbering = {
          reference: ctx.list.ordered ? "ol" : "ul",
          level: ctx.list.level,
          instance: ctx.list.instance,
        };
        ctx.take.v = false;
      } else o.indent = { start: 720 * (ctx.list.level + 1) };
    }
    if (ctx.quote) {
      o.indent = { start: 480 };
      o.shading = grey("F3F3F3");
    }
    return new Paragraph(o);
  };

  const buildTable = (s, e, ctx) => {
    const rows = [];
    let row = null;
    for (let k = s + 1; k < e; k++) {
      const t = toks[k];
      if (t.type === "tr_open") row = [];
      else if (t.type === "th_open" || t.type === "td_open")
        row.push({ inl: toks[k + 1], header: t.type === "th_open" });
      else if (t.type === "tr_close") rows.push(row);
    }
    const n = Math.max(1, ...rows.map((r) => r.length));
    const w = Math.floor(CONTENT_WIDTH / n);
    const widths = Array.from({ length: n }, (_, i) =>
      i === n - 1 ? CONTENT_WIDTH - w * (n - 1) : w,
    );
    const rtl = toks[s].attrGet("dir") === "rtl";
    return new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: widths,
      visuallyRightToLeft: rtl,
      rows: rows.map(
        (r, ri) =>
          new TableRow({
            tableHeader: ri === 0,
            children: widths.map((cw, ci) => {
              const cell = r[ci];
              const p = cell
                ? para(
                    cell.inl,
                    { ...ctx, list: null, quote: false },
                    { spacing: { after: 40 } },
                  )
                : new Paragraph({});
              return new TableCell({
                width: { size: cw, type: WidthType.DXA },
                shading: ri === 0 ? grey("E8E8E8") : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [p],
              });
            }),
          }),
      ),
    });
  };

  const blocks = (s, e, ctx) => {
    const out = [];
    for (let i = s; i < e; i++) {
      const t = toks[i];
      switch (t.type) {
        case "heading_open":
          out.push(
            para(toks[i + 1], ctx, { heading: HEADINGS[+t.tag.slice(1)] }),
          );
          i += 2;
          break;
        case "paragraph_open":
          out.push(para(toks[i + 1], ctx));
          i += 2;
          break;
        case "bullet_list_open":
        case "ordered_list_open": {
          const close = findClose(toks, i);
          const ordered = t.type === "ordered_list_open";
          const list = {
            ordered,
            level: ctx.list ? ctx.list.level + 1 : 0,
            instance: ++ctx.counter.n,
          };
          for (let k = i + 1; k < close; k++) {
            if (toks[k].type !== "list_item_open") continue;
            const lc = findClose(toks, k);
            out.push(...blocks(k + 1, lc, { ...ctx, list, take: { v: true } }));
            k = lc;
          }
          i = close;
          break;
        }
        case "blockquote_open": {
          const close = findClose(toks, i);
          out.push(...blocks(i + 1, close, { ...ctx, quote: true }));
          i = close;
          break;
        }
        case "fence":
        case "code_block": {
          // Code (and ASCII diagrams) are always LTR, left-aligned, monospaced, one paragraph per line.
          // - tight exact line height so vertical bars of diagrams line up
          // - identical borders/shading so Word draws ONE padded box around the whole block
          // - font shrinks for very wide lines instead of wrapping (wrapping destroys ASCII art)
          // - an unshaded spacer afterwards keeps two consecutive blocks from merging
          const lines = t.content
            .replace(/\n$/, "")
            .split("\n")
            .map((l) => l.replace(/\t/g, "    "));
          const maxLen = Math.max(1, ...lines.map((l) => l.length));
          const pt = Math.min(
            10,
            Math.max(7, Math.floor((423 / (0.6 * maxLen)) * 2) / 2),
          );
          const size = pt * 2;
          const edge = {
            style: BorderStyle.SINGLE,
            size: 4,
            color: "D0D0D0",
            space: 6,
          };
          for (const ln of lines) {
            out.push(
              new Paragraph({
                alignment: AlignmentType.LEFT,
                bidirectional: false,
                shading: grey("F2F2F2"),
                border: { top: edge, bottom: edge, left: edge, right: edge },
                indent: { left: 160, right: 160 },
                spacing: {
                  before: 0,
                  after: 0,
                  line: Math.round(size * 11.5),
                  lineRule: LineRuleType.EXACT,
                },
                children: [new TextRun({ text: ln, font: mono, size })],
              }),
            );
          }
          out.push(
            new Paragraph({
              spacing: { before: 0, after: 0 },
              run: { size: 12 },
              children: [],
            }),
          );
          break;
        }
        case "math_block":
        case "math_block_eqno":
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 80, after: 160 },
              children: [mathRun(t)],
            }),
          );
          break;
        case "hr":
          out.push(
            new Paragraph({
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: "999999",
                  space: 1,
                },
              },
              spacing: { after: 160 },
            }),
          );
          break;
        case "table_open": {
          const close = findClose(toks, i);
          out.push(
            buildTable(i, close, ctx),
            new Paragraph({ spacing: { after: 80 } }),
          );
          i = close;
          break;
        }
        default:
          break;
      }
    }
    return out;
  };

  const children = blocks(0, toks.length, { counter: { n: 0 } });

  // ---------- document ----------
  const bulletChars = ["•", "◦", "▪"];
  const levels = (ordered) =>
    Array.from({ length: 6 }, (_, l) => ({
      level: l,
      format: ordered
        ? [
            LevelFormat.DECIMAL,
            LevelFormat.LOWER_LETTER,
            LevelFormat.LOWER_ROMAN,
          ][l % 3]
        : LevelFormat.BULLET,
      text: ordered ? `%${l + 1}.` : bulletChars[l % 3],
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { start: 720 * (l + 1), hanging: 360 } } },
    }));
  const h = (size) => ({
    run: { font: FONT, size, bold: true },
    paragraph: { spacing: { before: 280, after: 120 }, keepNext: true },
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: 24,
            language: { value: "en-US", bidirectional: "fa-IR" },
          },
        },
        heading1: h(36),
        heading2: h(30),
        heading3: h(26),
        heading4: h(24),
        heading5: h(24),
        heading6: h(24),
      },
    },
    numbering: {
      config: [
        { reference: "ul", levels: levels(false) },
        { reference: "ol", levels: levels(true) },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 } } },
        children,
      },
    ],
  });

  // Swap equation placeholders for real OMML, and strip ZIP folder entries (Word co-editing quirk).
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  let xml = await zip.file("word/document.xml").async("string");
  for (const [key, frag] of ommlByPlaceholder) {
    xml = xml.replace(
      new RegExp(`<w:r>(?:(?!</w:r>)[\\s\\S])*?${key}[\\s\\S]*?</w:r>`),
      () => frag,
    );
  }
  zip.file("word/document.xml", xml);
  // Rebuild from file entries only (no explicit folder entries).
  const clean = new JSZip();
  for (const [p, f] of Object.entries(zip.files)) {
    if (!f.dir)
      clean.file(p, await f.async("nodebuffer"), { createFolders: false });
  }
  return clean.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
