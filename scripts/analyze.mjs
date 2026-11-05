#!/usr/bin/env node
// Simulate Klarity's normalizer against every real ERC-7730 descriptor.
// Reports every structural shape that would break the current spec.
// Usage: node analyze.mjs <registry-root> <ercs-root>

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keccak256: keccak_256 } = require("js-sha3");

const [, , REG, ERCS] = process.argv;
if (!REG) { console.error("need registry root"); process.exit(1); }

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      // exclude test-vector and signed-fixture dirs — not descriptors
      if (e === "tests" || e === "testsv2" || e === "sigs") continue;
      walk(p, acc);
    } else if (e.endsWith(".json")) {
      if (/\.tests?\.json$/.test(e)) continue;
      acc.push(p);
    }
  }
  return acc;
}

// A file is a standalone descriptor only if it has a context (directly or via
// includes). common-*.json fragments are include-targets and are skipped as
// emit-sources (they still resolve INTO other files).
function isIncludeFragment(path) {
  return /\/common-[^/]+\.json$/.test(path);
}

const files = walk(REG).filter(f => !/\.tests?\.json$/.test(f));
const emitFiles = files.filter(f => !isIncludeFragment(f));

// --- include resolution (recursive, deep-merge) ---
const includeCache = new Map();
function loadRaw(path) {
  const txt = readFileSync(path, "utf8");
  return JSON.parse(txt);
}
function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== "object" || base === null) return over ?? base;
  if (typeof over !== "object" || over === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}
function resolveIncludes(obj, fromPath, chain = [], depth = 0) {
  if (depth > 10) throw new Error("include-depth>10");
  if (!obj.includes) return { resolved: obj, chainLen: chain.length, maxDepth: depth };
  const incRel = obj.includes;
  const incPath = resolve(dirname(fromPath), incRel);
  let inc = includeCache.get(incPath);
  if (!inc) { inc = loadRaw(incPath); includeCache.set(incPath, inc); }
  const r = resolveIncludes(inc, incPath, [...chain, incRel], depth + 1);
  const { includes, ...selfNoInc } = obj;
  const merged = deepMerge(r.resolved, selfNoInc);
  return { resolved: merged, chainLen: r.chainLen, maxDepth: r.maxDepth };
}

// canonical function signature -> 4-byte selector
function canonicalSig(sig) {
  // "depositETH(address pool, address onBehalfOf, uint16 x)" -> "depositETH(address,address,uint16)"
  const m = sig.match(/^([^(]+)\((.*)\)\s*$/s);
  if (!m) return null;
  const name = m[1].trim();
  const inner = m[2].trim();
  if (inner === "") return `${name}()`;
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of inner) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const types = parts.map(p => p.trim().split(/\s+/)[0]); // take type, drop param name
  return `${name}(${types.join(",")})`;
}
function selector(sig) {
  const c = canonicalSig(sig);
  if (!c) return null;
  try { return "0x" + keccak_256(c).slice(0, 8); } catch { return null; }
}

const stats = {
  total: 0, v1: 0, v2: 0, otherSchema: 0, noSchema: 0,
  kindCalldata: 0, kindEip712: 0, kindUnknown: 0,
  usesIncludes: 0, maxIncludeDepth: 0, includeChains2plus: 0,
  partialNoFormats: 0, formatsAfterResolve0: 0,
  deploymentsMissing: 0, deploymentsEmpty: 0, deploymentCountHisto: {},
  addrNon0x: 0, chainIdNonNumber: 0,
  selectorFail: [], sigWeird: [], formatKeyNonSig: [],
  entitiesWouldEmit: 0, eip712NoPrimaryType: 0,
  factoryOrAbiRef: 0, constantsUsed: 0,
};
const examples = {};
function ex(key, file, note) { (examples[key] ??= []).length < 4 && examples[key].push({ file: file.replace(REG, "registry"), note }); }

for (const f of emitFiles) {
  let raw;
  try { raw = loadRaw(f); } catch (e) { ex("parseError", f, e.message); continue; }
  // skip pure shared fragments in ercs (they're includes targets, not standalone)
  stats.total++;

  const sch = raw.$schema || "";
  if (/erc7730-v2\.schema/.test(sch)) stats.v2++;
  else if (/erc7730\.schema/.test(sch) && !/v2/.test(sch)) stats.v1++;
  else if (sch) { stats.otherSchema++; ex("otherSchema", f, sch); }
  else { stats.noSchema++; ex("noSchema", f, "no $schema"); }

  let resolved, incInfo;
  try {
    incInfo = resolveIncludes(raw, f);
    resolved = incInfo.resolved;
  } catch (e) { ex("includeError", f, e.message); continue; }

  if (raw.includes) {
    stats.usesIncludes++;
    stats.maxIncludeDepth = Math.max(stats.maxIncludeDepth, incInfo.maxDepth);
    if (incInfo.maxDepth >= 2) stats.includeChains2plus++;
  }

  const ctx = resolved.context || {};
  let kind, deployments;
  if (ctx.contract) { kind = "calldata"; deployments = ctx.contract.deployments; }
  else if (ctx.eip712) { kind = "eip712"; deployments = ctx.eip712.deployments; }
  else { stats.kindUnknown++; ex("kindUnknown", f, Object.keys(ctx).join(",") || "no context"); continue; }

  if (kind === "calldata") stats.kindCalldata++; else stats.kindEip712++;

  // factory/abi-ref shapes
  if (ctx.contract?.factory) { stats.factoryOrAbiRef++; ex("factory", f, "context.contract.factory"); }
  if (ctx.contract?.abi && !ctx.contract?.deployments) ex("abiNoDeploy", f, "abi but check deployments");
  if (resolved.context?.$id === undefined && resolved.context?.id) ex("idVariant", f, "context.id not $id");

  if (!deployments) { stats.deploymentsMissing++; ex("deploymentsMissing", f, `${kind} no deployments`); }
  else if (!Array.isArray(deployments) || deployments.length === 0) { stats.deploymentsEmpty++; ex("deploymentsEmpty", f, JSON.stringify(deployments)); }
  else {
    const n = deployments.length;
    stats.deploymentCountHisto[n] = (stats.deploymentCountHisto[n] || 0) + 1;
    for (const d of deployments) {
      if (typeof d.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(d.address)) { stats.addrNon0x++; ex("addrNon0x", f, JSON.stringify(d.address)); }
      if (typeof d.chainId !== "number") { stats.chainIdNonNumber++; ex("chainIdNonNumber", f, JSON.stringify(d.chainId)); }
    }
  }

  const formats = resolved.display?.formats;
  const fmtKeys = formats ? Object.keys(formats) : [];
  if (!raw.display?.formats && !formats) stats.partialNoFormats++;
  if (fmtKeys.length === 0) { stats.formatsAfterResolve0++; ex("zeroFormatsAfterResolve", f, `kind=${kind} includes=${!!raw.includes}`); }

  // constants / $. refs
  if (resolved.display?.definitions || resolved.metadata?.constants) { stats.constantsUsed++; }

  if (kind === "eip712") {
    const pt = ctx.eip712?.schemas || ctx.eip712?.domain || formats;
    // primaryType: v2 keys formats by primaryType; some use messages[]
    const hasPrimary = fmtKeys.length > 0 || ctx.eip712?.domain?.name;
    if (!hasPrimary) { stats.eip712NoPrimaryType++; ex("eip712NoPrimary", f, "no primaryType derivable"); }
  }

  // selector derivation for calldata format keys
  const depCount = Array.isArray(deployments) ? deployments.length : 0;
  for (const key of fmtKeys) {
    if (kind === "calldata") {
      // key may be a full signature OR already a selector (0x...) OR a $. ref
      if (/^0x[0-9a-fA-F]{8}$/.test(key)) { /* already a selector */ }
      else if (key.includes("(")) {
        const sel = selector(key);
        if (!sel) { stats.selectorFail.push(key); ex("selectorFail", f, key); }
        if (/[^\x00-\x7F]/.test(key)) ex("nonAsciiSig", f, key);
      } else { stats.formatKeyNonSig++; ex("formatKeyNonSig", f, key); }
    }
    stats.entitiesWouldEmit += depCount || 1;
  }
}

// stable output
const out = {
  counts: { walked: files.length, emitCandidates: emitFiles.length, fragments: files.length - emitFiles.length },
  stats: {
    ...stats,
    selectorFail: stats.selectorFail.length,
    sigWeird: undefined,
    formatKeyNonSig: stats.formatKeyNonSig,
  },
  deploymentCountHisto: stats.deploymentCountHisto,
  examples,
};
console.log(JSON.stringify(out, null, 2));
