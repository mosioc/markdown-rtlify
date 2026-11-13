#!/usr/bin/env node
/**
 * rtlify convert LLM-style Markdown (Persian/Arabic/Hebrew, mixed with English,
 * code and math) into HTML or DOCX that renders correctly right-to-left.
 *
 * Usage:
 *   node rtlify.mjs input.md -o out.html
 *   node rtlify.mjs input.md -o out.docx
 *   cat input.md | node rtlify.mjs > out.html
 *
 * Options:
 *   -o, --out <file>     write to file instead of stdout (.docx extension => DOCX)
 *   --format html|docx   output format (default: from --out extension, else html)
 *   --fragment           HTML only: output just the body (no <html>, CSS, KaTeX link)
 *   --ratio <0..1>       share of RTL words needed for a block to be RTL (default 0.4)
 *   --dir auto|rtl|ltr   force the document direction (default auto)
 */
import fs from "node:fs";
import katex from "katex";
import { createRenderer, normalizeMath } from "./core.mjs";
import { buildDocx } from "./docx-writer.mjs";
export { detectDir, wrapRuns } from "./core.mjs";

const CSS = `
:root { color-scheme: light dark; }
body { font-family: Vazirmatn, "Noto Sans Arabic", Tahoma, system-ui, sans-serif; line-height: 1.8;
       max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
pre, code, .math, .math-block { direction: ltr; unicode-bidi: isolate; }
pre { text-align: left; overflow-x: auto; padding: .8rem 1rem; border-radius: 8px; background: color-mix(in srgb, currentColor 8%, transparent);
      line-height: 1.25; white-space: pre; tab-size: 4; font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
code { font-family: ui-monospace, "JetBrains Mono", Consolas, monospace; font-size: .92em; }
:not(pre) > code { padding: .1em .35em; border-radius: 4px; background: color-mix(in srgb, currentColor 10%, transparent); }
.math-block { text-align: center; overflow-x: auto; }
blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid color-mix(in srgb, currentColor 30%, transparent); }
table { border-collapse: collapse; } th, td { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); padding: .35rem .7rem; text-align: start; }
`;

export function convert(markdown, opts = {}) {
  const md = createRenderer(opts);
  const env = {};
  const body = md.render(normalizeMath(markdown), env);
  if (opts.fragment) return body;
  const dir = env.docDir || "ltr";
  return `<!doctype html>
<html lang="${dir === "rtl" ? "fa" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css">
<style>${CSS}</style>
</head>
<body>
${body}</body>
</html>
`;
}

// ---------- CLI ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opts = { ratio: 0.4, forcedDir: "auto", fragment: false };
  let input = null,
    out = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") out = args[++i];
    else if (a === "--fragment") opts.fragment = true;
    else if (a === "--ratio") opts.ratio = parseFloat(args[++i]);
    else if (a === "--dir") opts.forcedDir = args[++i];
    else if (a === "--format") opts.format = args[++i];
    else input = a;
  }
  const src = fs.readFileSync(input ?? 0, "utf8").replace(/^\uFEFF/, "");
  const format =
    opts.format ??
    (out && out.toLowerCase().endsWith(".docx") ? "docx" : "html");
  const result =
    format === "docx" ? await buildDocx(src, opts) : convert(src, opts);
  out ? fs.writeFileSync(out, result) : process.stdout.write(result);
}
