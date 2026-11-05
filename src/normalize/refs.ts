type Json = unknown;

function getByPath(root: Record<string, unknown>, segments: string[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Parse a $ref string of the form `$.display.definitions.X` or
 * `#/display/definitions/X` into its path segments, or return null if the
 * string is not a recognised internal definition pointer.
 */
function refSegments(ref: string): string[] | null {
  if (ref.startsWith('$.')) {
    return ref.slice(2).split('.');
  }
  if (ref.startsWith('#/')) {
    return ref.slice(2).split('/');
  }
  return null;
}

/**
 * Inline every `{ $ref: "$.display.definitions.X", ... }` field by merging the
 * referenced definition's keys in, with the field's own keys winning on
 * conflict. Recurses through nested objects and arrays. Non-`$ref` objects are
 * left untouched. After this, no `$ref` key remains anywhere in the document.
 *
 * The input is not mutated; a new structure is returned.
 */
export function inlineRefs<T>(doc: T): T {
  const root = doc as unknown as Record<string, unknown>;
  const walk = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const ref = obj['$ref'];
    if (typeof ref === 'string') {
      const segs = refSegments(ref);
      const definition = segs ? getByPath(root, segs) : undefined;
      if (definition && typeof definition === 'object' && !Array.isArray(definition)) {
        // field (minus $ref) wins over the definition on conflict.
        const { $ref: _drop, ...fieldWithoutRef } = obj;
        const merged = { ...(definition as Record<string, unknown>), ...fieldWithoutRef };
        // Recurse into the merged result (e.g. nested fields/params).
        return walk(merged);
      }
      // Unresolvable ref: drop the $ref key but keep the rest so nothing dangles.
      const { $ref: _unused, ...rest } = obj;
      return walk(rest);
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = walk(v);
    return out;
  };
  return walk(root) as unknown as T;
}
