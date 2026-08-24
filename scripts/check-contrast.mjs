/**
 * WCAG contrast for every text/background pair, in both themes.
 *
 * WHY THIS IS A SCRIPT AND NOT A DESIGN REVIEW
 *
 * A theme can look finished and still be unreadable. The failure is quiet: pale secondary
 * text on a pale panel reads fine to whoever picked the colours, on their screen, at their
 * brightness. Nobody notices until someone with worse eyes, a cheaper display, or sunlight
 * cannot use the app — and by then the palette is load-bearing across a hundred rules.
 *
 * Adding a light theme doubled the number of pairs that have to hold. Checking them by eye
 * was already the wrong tool at nine; at eighteen it is not a tool at all.
 *
 * The values are PARSED OUT OF globals.css rather than restated here. A checker with its own
 * copy of the palette passes forever while the stylesheet drifts away underneath it, which is
 * worse than no checker: it reports safety it is no longer measuring.
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "globals.css");
const css = readFileSync(CSS, "utf8");

/** Pull `--name: value;` pairs out of one brace-delimited block. */
function declarations(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** The block following a selector, matched by brace counting rather than by regex. */
function blockAfter(source, selector) {
  const at = source.indexOf(selector);
  if (at === -1) throw new Error(`selector not found in globals.css: ${selector}`);
  let i = source.indexOf("{", at) + 1;
  let depth = 1;
  const start = i;
  while (depth > 0 && i < source.length) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

// Two :root blocks: the material ramp, then the light semantics. Both feed the light theme.
const firstRoot = css.indexOf(":root {");
const secondRoot = css.indexOf(":root {", firstRoot + 1);
const material = declarations(blockAfter(css, ":root {"));
const lightSem = declarations(blockAfter(css.slice(secondRoot), ":root {"));
const darkSem = declarations(blockAfter(css, ':root[data-theme="dark"]'));

const LIGHT = { ...material, ...lightSem };
const DARK = { ...material, ...darkSem };

/** Resolve one level of var() indirection against the same theme. */
function resolve(tokens, name, seen = 0) {
  let v = tokens[name];
  if (v === undefined) throw new Error(`token never defined: ${name}`);
  while (v.startsWith("var(") && seen < 8) {
    const inner = v.slice(4, v.lastIndexOf(")")).split(",")[0].trim();
    v = tokens[inner];
    if (v === undefined) throw new Error(`token ${name} points at undefined ${inner}`);
    seen++;
  }
  return v;
}

function parseColor(v) {
  if (v.startsWith("#")) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`cannot parse colour: ${v}`);
  const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

/** Flatten a translucent colour onto its backdrop — rules and hairlines are rgba. */
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fgToken, bgToken, tokens) {
  const bg = parseColor(resolve(tokens, bgToken));
  const fg = over(parseColor(resolve(tokens, fgToken)), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every pair, with the threshold each one actually has to meet.
 *
 * 4.5 is AA for body text. 3.0 is AA for large text and for non-text UI that carries meaning
 * — a phase colour, a filled segment, a hairline that separates two regions. Anything below
 * 3.0 is decoration and is not listed, because claiming to check something and then passing
 * it at any value is worse than leaving it out.
 */
const SURFACES = ["--bg", "--bg-raised", "--bg-panel", "--bg-inset"];
const PAIRS = [
  ...SURFACES.map((s) => ["--text", s, 4.5]),
  ...SURFACES.map((s) => ["--text-2", s, 4.5]),
  // Labels and hints. Small and uppercase, so held to body-text contrast rather than large.
  ...SURFACES.map((s) => ["--text-3", s, 4.5]),
  ["--accent-ink", "--bg", 4.5],
  ["--accent-ink", "--bg-panel", 4.5],
  ["--atrum-ember", "--bg", 4.5],
  ["--atrum-ember", "--bg-panel", 4.5],
  ["--atrum-halo", "--bg", 4.5],
  ["--atrum-halo", "--bg-panel", 4.5],
  // Text sitting on the filled accent: buttons, the selected theme segment.
  ["--on-accent", "--strk-orange", 4.5],
  ["--on-accent", "--strk-orange-lit", 4.5],
  // A focus indicator owes 3:1 against what surrounds it (WCAG 2.4.11). Every ring here uses
  // a 2px offset, so the thing it sits against is the SURFACE behind the control, not the
  // control's own fill. Listed because using the brand accent for focus looked obviously
  // right and measured 2.29:1 on light -- the kind of failure staring at it cannot find.
  ["--focus-ring", "--bg", 3.0],
  ["--focus-ring", "--bg-raised", 3.0],
  ["--focus-ring", "--bg-panel", 3.0],
  ["--focus-ring", "--bg-inset", 3.0],
  // The border of an input or a button is a UI component boundary: WCAG 1.4.11 wants 3:1,
  // because not being able to find the edge of a text field is not a cosmetic problem.
  ["--rule-input", "--bg", 3.0],
  ["--rule-input", "--bg-panel", 3.0],
  ["--rule-input", "--bg-inset", 3.0],
  // --rule and --rule-strong are deliberately NOT listed. They divide regions and carry no
  // information, which 1.4.11 exempts, and a hairline forced to 3:1 stops being a hairline --
  // no product draws its dividers that hard. Asserting a threshold they were always going to
  // pass would be checking nothing while appearing to check something.
];

let failures = 0;
for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]]) {
  console.log(`\n${themeName}`);
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(fg, bg, tokens);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${fg.padEnd(15)} on ${bg.padEnd(12)} ${r.toFixed(2)}:1 (needs ${min})`,
    );
  }
}

// Both themes must define the same semantic tokens. A token present in one and missing in the
// other is the bug that shipped here already: --atrum-ember and --atrum-halo were referenced
// everywhere and defined nowhere, so error text was never red and nothing said so.
const semantic = new Set([...Object.keys(lightSem), ...Object.keys(darkSem)]);
for (const name of semantic) {
  if (lightSem[name] === undefined) {
    console.log(`\nFAIL ${name} defined for dark but not light`);
    failures++;
  }
  if (darkSem[name] === undefined) {
    console.log(`\nFAIL ${name} defined for light but not dark`);
    failures++;
  }
}

// Every var() the stylesheet USES must resolve in both themes.
const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
// Set by next/font on a className, and by JS for the cursor highlight. Not palette.
const EXTERNAL = new Set([
  "--font-syne", "--font-manrope", "--font-geist-mono", "--spot-x", "--spot-y",
]);
for (const name of used) {
  if (EXTERNAL.has(name)) continue;
  for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]]) {
    if (tokens[name] === undefined) {
      console.log(`\nFAIL ${name} is used but undefined in ${themeName}`);
      failures++;
    }
  }
}

console.log(
  failures === 0
    ? "\nAll pairs meet their threshold, and both themes define the same tokens."
    : `\n${failures} problem(s).`,
);
process.exit(failures === 0 ? 0 : 1);
