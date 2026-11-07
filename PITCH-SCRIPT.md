# Klarity — 2-Minute Spoken Pitch (per-slide cue cards)

**Target: ~1:55. ~300 words. One breath per card. Sponsors to land: Ethereum Foundation (ERC-7730 + ERC-8244, blind-signing) and Arkiv (always-on mirror).**

---

### Slide 1 — "A wallet, not a website." `[ERC-8244]`
> Every wallet you've ever used loads its interface from a server. That server can be hacked, phished, or seized. **Klarity is a wallet whose entire interface is served from a smart contract** — ERC-8244, straight off-chain, over the same RPC the wallet already trusts. There is no website to compromise.

### Slide 2 — "Reads nobody can trace." `[anon-rpc]`
> Every balance check today leaks through a handful of RPC providers that see your IP and your whole portfolio. Klarity routes reads through a **hash-pinned, sandboxed worker** — anonymous RPC. They can't see you, and they can't lie to you: the code is verified by its hash.

### Slide 3 — "No servers. No off switch." `[ENS · IPFS]`
> Resolved through ENS and IPFS. **No backend. No server. Nothing to take down.** No company, no court, no government can switch this wallet off. That is the whole point.

### Slide 4 — "This is what you actually sign." `[raw calldata]`
> But a safe wallet still has one problem — this. A wall of hex. This is what every user actually approves today, and they have no idea what it does.

### Slide 5 — "Decoded. Safe to sign." `[ERC-7730]`
> Klarity decodes it — the same bytes, now readable: *swap 1,000 USDC for ETH.* This is **ERC-7730 clear-signing**, the Ethereum Foundation's own standard for ending blind signing — the single biggest cause of drained wallets.

### Slide 6 — "One registry. One host." `[GitHub]`
> But here's the catch: that clear-signing data lives in **one GitHub repo.**

### Slide 7 — "GitHub drops. Wallets go blind." `[blind signing]`
> And GitHub goes down — routinely. When it does, wallets can't fetch the descriptor, so they fall back to raw hex and ask you to sign anyway. A security feature that disappears exactly when you need it.

### Slide 8 — "Always-available. Un-takedownable." `[Arkiv]`
> So we mirrored the entire registry onto **Arkiv** — permissionless, provenance-verified, queryable by anyone, with no host to take it down. The security data is now as unstoppable as the wallet that reads it.

### Slide 9 — "Attested. Ranked by trust." `[attestation]`
> And every descriptor carries on-chain attestations, so wallets rank by *verified* trust — not a flat list. **Klarity: a wallet nobody can stop, signing nobody can fake.** Thank you.

---

**Timing notes:** Slides 6–7 are fast (one line each, ~8s) — keep the momentum into the Arkiv payoff on 8. The two sponsor beats are the EF standards (5 + the ERC-8244 open on 1) and Arkiv (8). If you're over time, cut slide 6 into slide 7's first line.
