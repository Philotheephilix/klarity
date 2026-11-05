import sha3 from 'js-sha3';

const { keccak256 } = sha3;

/**
 * Normalize an ERC-7730 function signature to its canonical form:
 * strip parameter names, preserve tuple `()` and array `[]` structure.
 *
 * `"depositETH(address pool, uint16 x)"` -> `"depositETH(address,uint16)"`
 * `"foo((address,uint256)[] x)"`          -> `"foo((address,uint256)[])"`
 * `"bar()"`                               -> `"bar()"`
 *
 * Ported from scripts/analyze.mjs (verified: transfer(address,uint256) -> 0xa9059cbb).
 */
export function canonicalSignature(sig: string): string {
  const m = sig.match(/^([^(]+)\((.*)\)\s*$/s);
  if (!m) throw new Error(`not a function signature: ${sig}`);
  const name = m[1].trim();
  const inner = m[2].trim();
  if (inner === '') return `${name}()`;

  // Split top-level params on commas, respecting ()/[] nesting.
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);

  // For each param take the type token (drop a trailing param name).
  const types = parts.map((p) => canonicalParam(p.trim()));
  return `${name}(${types.join(',')})`;
}

/**
 * Canonicalize a single parameter: keep the type, drop its param name, and
 * recurse into tuple components so nested component names are also stripped.
 *
 * `"address pool"`                         -> `"address"`
 * `"(uint256 a, address b) baseRequest"`   -> `"(uint256,address)"`
 * `"(uint256 a)[] paths"`                  -> `"(uint256)[]"`
 */
function canonicalParam(param: string): string {
  const trimmed = param.trim();
  if (!trimmed.startsWith('(')) {
    // Simple type: `type name` or just `type`. Keep the first token.
    const sp = trimmed.search(/\s/);
    return sp === -1 ? trimmed : trimmed.slice(0, sp);
  }

  // Tuple: find the matching close paren for the leading '('.
  let depth = 0;
  let close = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error(`unbalanced tuple in param: ${param}`);

  const body = trimmed.slice(1, close); // inside the outer parens
  // suffix is e.g. "[]" / "[][]" plus optional " name"; keep only bracket run.
  const suffixRaw = trimmed.slice(close + 1).trim();
  const brackets = (suffixRaw.match(/^(\[\d*\])*/)?.[0]) ?? '';

  // Split tuple components on top-level commas and recurse.
  const comps: string[] = [];
  depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      comps.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  comps.push(cur);
  const inner = comps.map((c) => canonicalParam(c.trim())).join(',');
  return `(${inner})${brackets}`;
}

/**
 * 4-byte function selector: `0x` + first 8 hex chars of
 * keccak256(canonicalSignature(sig)).
 */
export function selectorOf(sig: string): `0x${string}` {
  const canonical = canonicalSignature(sig);
  return `0x${keccak256(canonical).slice(0, 8)}`;
}
