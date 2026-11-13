// Shared logic: script detection, direction detection, run segmentation, markdown-it setup.
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";

// ---------- script detection ----------
const RTL_CHARS = "\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF";
const RTL_RE = new RegExp(`[${RTL_CHARS}]`);
const LATIN_RE = /[A-Za-z]/;

// A run of Latin "words" joined by spaces: "React Native", "React, Vue", "node_modules/", URLs...
const WORD = `[A-Za-z0-9][A-Za-z0-9_.+#/@:'’,?=&%~-]*`;
const LATIN_RUN = new RegExp(`${WORD}(?:[ \\t]+${WORD})*`, "g");
// Punctuation that belongs to the sentence, not to the English run: "Next.js." -> "Next.js" + "."
const TRAILING = /[.,:;/'’?&=%~-]+$/;
const RTL_WORD = `[${RTL_CHARS}\\u200C]+`;
const RTL_RUN = new RegExp(`${RTL_WORD}(?:[ \\t]+${RTL_WORD})*`, "g");

export const esc = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Block direction by *word majority*, not by first strong character.
 * This is what fixes "Persian paragraph that starts with an English word":
 * dir="auto" would pick LTR there, we count words instead.
 */
export function detectDir(text, ratio = 0.4, docDir = null) {
  let rtl = 0,
    ltr = 0;
  for (const w of text.split(/\s+/)) {
    if (RTL_RE.test(w)) rtl++;
    else if (LATIN_RE.test(w)) ltr++;
  }
  if (!rtl && !ltr) return null;
  // In a mostly-RTL document, ambiguous blocks (e.g. the heading "راهنمای React Hooks") lean RTL.
  const threshold = docDir === "rtl" ? ratio / 2 : ratio;
  return rtl / (rtl + ltr) >= threshold ? "rtl" : "ltr";
}

/**
 * Wrap opposite-direction runs in <bdi dir=...> so the bidi algorithm treats each
 * run as an isolated unit. Surrounding punctuation/parentheses stay OUTSIDE the
 * isolate and therefore resolve against the paragraph direction (= correct order).
 */
export function segmentRuns(text, blockDir) {
  const rtlBlock = blockDir === "rtl";
  const re = rtlBlock ? LATIN_RUN : RTL_RUN;
  const needs = rtlBlock ? LATIN_RE : RTL_RE;
  const segs = [];
  const push = (t, iso) => {
    if (t) segs.push({ text: t, iso });
  };
  let last = 0;
  for (const m of text.matchAll(re)) {
    let run = m[0];
    if (!needs.test(run)) continue; // pure numbers etc. are left alone
    let tail = "";
    if (rtlBlock) {
      const t = run.match(TRAILING);
      if (t) {
        tail = t[0];
        run = run.slice(0, -tail.length);
      }
    }
    push(text.slice(last, m.index), false);
    push(run, true);
    push(tail, false);
    last = m.index + m[0].length;
  }
  push(text.slice(last), false);
  return segs;
}

/** HTML flavour of segmentRuns: opposite-direction runs become isolated <bdi>. */
export function wrapRuns(text, blockDir) {
  const other = blockDir === "rtl" ? "ltr" : "rtl";
  return segmentRuns(text, blockDir)
    .map((s) =>
      s.iso ? `<bdi dir="${other}">${esc(s.text)}</bdi>` : esc(s.text),
    )
    .join("");
}

// ---------- math delimiter normalisation ----------
/**
 * texmath only understands \[ ... \] as a standalone top-level block. LLMs also emit it inside
 * list items, mid-sentence, or on one line, where it degrades to literal "[ ... ]". Rewrite all
 * of those to $$...$$ (which works everywhere), leaving code fences and inline code untouched.
 */
// Over-escaped exports write math as \\[ ... \\] / \\( ... \\) with \\{ \\} and \_ inside.
// Undo that escaping *inside the math only*, then convert every flavour to $...$ / $$...$$.
const unescapeTex = (t) =>
  t.replace(/\\\\([{}])/g, "\\$1").replace(/\\_/g, "_");
const fixMath = (seg) =>
  seg
    .replace(
      /(?<!\\)\\\\\[(.+?)\\\\\]/g,
      (_, t) => `$$${unescapeTex(t).trim()}$$`,
    )
    .replace(
      /(?<!\\)\\\\\((.+?)\\\\\)/g,
      (_, t) => `$${unescapeTex(t).trim()}$`,
    )
    .replace(/(?<!\\)\\\[(.+?)\\\]/g, (_, t) => `$$${t.trim()}$$`);

export function normalizeMath(src) {
  const lines = src.split("\n");
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }

    // Indented multi-line \[ ... \] (e.g. inside a list item): join into one $$...$$ line.
    const indent = line.match(/^(\s+)/)?.[1];
    if (indent && line.trim() === "\\[") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "\\]") j++;
      if (j < lines.length) {
        out.push(
          `${indent}$$${lines
            .slice(i + 1, j)
            .map((l) => l.trim())
            .join(" ")}$$`,
        );
        i = j;
        continue;
      }
    }
    // Single-line \[ ... \] anywhere outside inline code.
    out.push(
      line
        .split(/(`+[^`]*`+)/)
        .map((seg, k) => (k % 2 ? seg : fixMath(seg)))
        .join(""),
    );
  }
  return out.join("\n");
}

// ---------- markdown-it setup ----------
export function createRenderer({
  ratio = 0.4,
  forcedDir = "auto",
  wrapInline = true,
} = {}) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
  md.use(texmath, {
    engine: katex,
    delimiters: ["dollars", "brackets"],
    katexOptions: { throwOnError: false },
  });

  // Formulas and code are always LTR islands.
  for (const rule of ["math_inline", "math_inline_double"]) {
    const orig = md.renderer.rules[rule];
    if (orig)
      md.renderer.rules[rule] = (...a) =>
        `<span class="math" dir="ltr">${orig(...a)}</span>`;
  }
  for (const rule of ["math_block", "math_block_eqno"]) {
    const orig = md.renderer.rules[rule];
    if (orig)
      md.renderer.rules[rule] = (...a) =>
        `<div class="math-block" dir="ltr">${orig(...a)}</div>`;
  }
  for (const rule of ["fence", "code_block"]) {
    const orig = md.renderer.rules[rule];
    md.renderer.rules[rule] = (...a) =>
      `<div class="code-block" dir="ltr">${orig(...a)}</div>`;
  }

  const BLOCKS = new Set([
    "paragraph_open",
    "heading_open",
    "blockquote_open",
    "bullet_list_open",
    "ordered_list_open",
    "table_open",
    "th_open",
    "td_open",
  ]);

  const textOf = (toks, i) => {
    const { level } = toks[i];
    const close = toks[i].type.replace("_open", "_close");
    let s = "";
    for (
      let j = i + 1;
      j < toks.length && !(toks[j].type === close && toks[j].level === level);
      j++
    ) {
      if (toks[j].type === "inline") {
        for (const c of toks[j].children || [])
          if (c.type === "text") s += c.content + " ";
      }
    }
    return s;
  };

  md.core.ruler.push("rtlify", (state) => {
    const toks = state.tokens;
    const all = toks
      .filter((t) => t.type === "inline")
      .flatMap((t) =>
        (t.children || [])
          .filter((c) => c.type === "text")
          .map((c) => c.content),
      )
      .join(" ");
    const docDir =
      forcedDir !== "auto" ? forcedDir : detectDir(all, ratio) || "ltr";
    state.env.docDir = docDir;

    const stack = [{ close: null, level: -1, dir: docDir }];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const top = stack[stack.length - 1];
      if (t.type === top.close && t.level === top.level) {
        stack.pop();
        continue;
      }

      if (BLOCKS.has(t.type) && !t.hidden) {
        const dir =
          forcedDir !== "auto"
            ? forcedDir
            : detectDir(textOf(toks, i), ratio, docDir) || top.dir;
        t.attrSet("dir", dir);
        stack.push({
          close: t.type.replace("_open", "_close"),
          level: t.level,
          dir,
        });
      } else if (t.type === "inline" && t.children) {
        const dir = stack[stack.length - 1].dir;
        t.meta = { ...(t.meta || {}), dir };
        if (!wrapInline) continue;
        t.children = t.children.map((c) => {
          if (c.type !== "text" || !c.content) return c;
          const h = new state.Token("html_inline", "", 0);
          h.content = wrapRuns(c.content, dir);
          return h;
        });
      }
    }
  });

  return md;
}
