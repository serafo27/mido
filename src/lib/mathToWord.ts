// LaTeX formulas as Word equations: KaTeX turns the LaTeX into MathML, and
// the MathML elements map onto Word's (OMML) fractions, scripts, radicals,
// sums, integrals and brackets. What has no counterpart keeps its text.
import katex from "katex";
import {
  Math as WordMath,
  MathAngledBrackets,
  MathCurlyBrackets,
  MathFraction,
  MathIntegral,
  MathLimitLower,
  MathLimitUpper,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  type MathComponent,
} from "docx";

const SUMS = new Set(["∑", "⨁", "⨂", "⋃", "⋂", "∏", "∐"]);
const INTEGRALS = new Set(["∫", "∬", "∭", "∮", "∯", "∰"]);
const BRACKETS: Record<string, [string, (children: MathComponent[]) => MathComponent]> = {
  "(": [")", (children) => new MathRoundBrackets({ children })],
  "[": ["]", (children) => new MathSquareBrackets({ children })],
  "{": ["}", (children) => new MathCurlyBrackets({ children })],
  "⟨": ["⟩", (children) => new MathAngledBrackets({ children })],
};

/** The MathML KaTeX makes for `latex`, or null if KaTeX can't read it. */
function mathml(latex: string, display: boolean): Element | null {
  try {
    const markup = katex.renderToString(latex, { output: "mathml", displayMode: display, throwOnError: true });
    const doc = new DOMParser().parseFromString(markup, "text/html");
    return doc.querySelector("math");
  } catch {
    return null;
  }
}

const elements = (el: Element) => [...el.children];

/** Converts children, pairing up stretchy brackets around what's between them. */
function convertRow(nodes: Element[]): MathComponent[] {
  const out: MathComponent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const open = node.tagName.toLowerCase() === "mo" ? (node.textContent?.trim() ?? "") : "";
    const bracket = BRACKETS[open];
    if (bracket && node.getAttribute("fence") !== "false") {
      // Find the matching closing bracket at this level.
      let depth = 0;
      let close = -1;
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[j].tagName.toLowerCase() !== "mo") continue;
        const text = nodes[j].textContent?.trim();
        if (text === open) depth++;
        else if (text === bracket[0]) {
          if (depth === 0) {
            close = j;
            break;
          }
          depth--;
        }
      }
      if (close > 0) {
        out.push(bracket[1](convertRow(nodes.slice(i + 1, close))));
        i = close;
        continue;
      }
    }
    // A large operator followed by its operand: ∑ or ∫ with limits.
    const operator = largeOperator(node);
    if (operator) {
      const rest = nodes.slice(i + 1);
      out.push(operator(convertRow(rest)));
      break;
    }
    out.push(...convert(node));
  }
  return out;
}

/** For a sum or integral (with or without limits), makes it around its operand. */
function largeOperator(node: Element): ((children: MathComponent[]) => MathComponent) | null {
  const tag = node.tagName.toLowerCase();
  const scripted = ["munderover", "msubsup", "munder", "msub", "mover", "msup"].includes(tag);
  const base = scripted ? node.children[0] : node;
  const symbol = base?.tagName.toLowerCase() === "mo" ? (base.textContent?.trim() ?? "") : "";
  const isSum = SUMS.has(symbol);
  if (!isSum && !INTEGRALS.has(symbol)) return null;
  const [, first, second] = scripted ? elements(node) : [];
  const lower = tag === "munderover" || tag === "msubsup" || tag === "munder" || tag === "msub" ? first : undefined;
  const upper =
    tag === "munderover" || tag === "msubsup" ? second : tag === "mover" || tag === "msup" ? first : undefined;
  const subScript = lower ? convert(lower) : undefined;
  const superScript = upper ? convert(upper) : undefined;
  return (children) =>
    isSum ? new MathSum({ children, subScript, superScript }) : new MathIntegral({ children, subScript, superScript });
}

function convert(node: Element): MathComponent[] {
  const tag = node.tagName.toLowerCase();
  const kids = elements(node);
  const at = (i: number) => (kids[i] ? convert(kids[i]) : []);
  switch (tag) {
    case "math":
    case "mrow":
    case "mstyle":
    case "mpadded":
    case "menclose":
    case "mtd":
      return convertRow(kids);
    case "semantics":
      // The presentation, not the LaTeX annotation.
      return kids[0] ? convert(kids[0]) : [];
    case "annotation":
    case "mphantom":
    case "mspace":
      return tag === "mspace" ? [new MathRun(" ")] : [];
    case "mi":
    case "mn":
    case "mo":
    case "ms":
      return [new MathRun(node.textContent ?? "")];
    case "mtext":
      return [new MathRun(node.textContent ?? "")];
    case "mfrac":
      return [new MathFraction({ numerator: at(0), denominator: at(1) })];
    case "msqrt":
      return [new MathRadical({ children: convertRow(kids) })];
    case "mroot":
      return [new MathRadical({ children: at(0), degree: at(1) })];
    case "msup":
      return [new MathSuperScript({ children: at(0), superScript: at(1) })];
    case "msub":
      return [new MathSubScript({ children: at(0), subScript: at(1) })];
    case "msubsup":
      return [new MathSubSuperScript({ children: at(0), subScript: at(1), superScript: at(2) })];
    case "munder":
      return [new MathLimitLower({ children: at(0), limit: at(1) }) as unknown as MathComponent];
    case "mover":
      // Accents (hats, bars, vectors) read best as the base with the accent above.
      return [new MathLimitUpper({ children: at(0), limit: at(1) }) as unknown as MathComponent];
    case "munderover":
      return [
        new MathLimitUpper({
          children: [new MathLimitLower({ children: at(0), limit: at(1) }) as unknown as MathComponent],
          limit: at(2),
        }) as unknown as MathComponent,
      ];
    case "mtable":
      // Rows one after another, cells apart: Word's matrices aren't in the docx API's main set.
      return kids.flatMap((row, i) => [
        ...(i ? [new MathRun("; ")] : []),
        ...elements(row).flatMap((cell, j) => [...(j ? [new MathRun(", ")] : []), ...convert(cell)]),
      ]);
    default:
      return convertRow(kids);
  }
}

/**
 * `latex` as a Word equation, or null when KaTeX can't read it (the caller
 * then shows the LaTeX itself).
 */
export function wordMath(latex: string, display: boolean): WordMath | null {
  const math = mathml(latex, display);
  if (!math) return null;
  return new WordMath({ children: convert(math) });
}
