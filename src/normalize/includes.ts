/** Resolves a relative include path (against the including file's dir) to the
 *  parsed fragment object. Injected by the caller so this module stays I/O-free. */
export type LoadFragment = (relPath: string, fromPath: string) => Record<string, unknown>;

const DEPTH_CAP = 10;

/**
 * Deep-merge `over` onto `base`, with `over` (the including doc, "self") winning
 * on conflict. Arrays are replaced wholesale, not merged. Ported verbatim from
 * scripts/analyze.mjs so selector-level behaviour matches the validated run.
 */
function deepMerge(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || base === null) return over ?? base;
  if (typeof over !== 'object' || over === null) return over ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const b = base as Record<string, unknown>;
  const o = over as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    out[k] = k in b ? deepMerge(b[k], o[k]) : o[k];
  }
  return out;
}

/**
 * Recursively resolve a descriptor's `includes` fragment. The fragment is
 * loaded (and itself resolved, so include chains are followed), then the
 * including doc is deep-merged on top (self wins). The resulting object carries
 * no `includes` key. Throws if the include depth exceeds the cap (loop guard).
 *
 * @param doc    the (possibly partial) descriptor
 * @param load   caller-injected fragment loader (keeps this module pure)
 * @param fromPath absolute path of `doc`, used to resolve relative includes
 */
export function resolveIncludes(
  doc: Record<string, unknown>,
  load: LoadFragment,
  fromPath: string,
  depth = 0,
): Record<string, unknown> {
  if (depth > DEPTH_CAP) throw new Error(`include-depth>${DEPTH_CAP}`);

  const incRel = doc['includes'];
  if (typeof incRel !== 'string') {
    // strip any non-string `includes` defensively; nothing to resolve.
    if ('includes' in doc) {
      const { includes: _drop, ...rest } = doc;
      return rest;
    }
    return doc;
  }

  const fragment = load(incRel, fromPath);
  // The fragment's own path is where ITS relative includes resolve from.
  const fragPath = resolveRelative(fromPath, incRel);
  const resolvedFragment = resolveIncludes(fragment, load, fragPath, depth + 1);

  const { includes: _includes, ...selfNoInc } = doc;
  return deepMerge(resolvedFragment, selfNoInc) as Record<string, unknown>;
}

/** Resolve `relPath` against the directory of `fromPath` (POSIX-style, no fs). */
function resolveRelative(fromPath: string, relPath: string): string {
  const dir = fromPath.replace(/[/\\][^/\\]*$/, '');
  return `${dir}/${relPath}`;
}
