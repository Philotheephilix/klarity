// companion/poll.ts
var realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForReceipt(txHash, deps, opts = {}) {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxTries = opts.maxTries ?? 10;
  const sleep = deps.sleep ?? realSleep;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const receipt = await deps.getReceipt(txHash);
    if (receipt !== null) {
      return { mined: true, status: receipt.status };
    }
    if (attempt < maxTries - 1) {
      await sleep(intervalMs);
    }
  }
  return { mined: false };
}

// companion/app.ts
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}
function setStatus(msg) {
  byId("status").textContent = msg;
}
function requireEthereum() {
  const eth = window.ethereum;
  if (!eth) {
    throw new Error("No injected provider found. Install MetaMask Flask.");
  }
  return eth;
}
async function run() {
  const eth = requireEthereum();
  const snapId = byId("snapId").value.trim();
  const apiBase = byId("apiBase").value.trim();
  const chainId = Number(byId("chainId").value.trim());
  const contract = byId("contract").value.trim();
  const selector = byId("selector").value.trim();
  const txHash = byId("txHash").value.trim();
  setStatus("Connecting to MetaMask...");
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  const account = accounts[0];
  if (!account) throw new Error("No account authorized.");
  setStatus(`Installing Snap ${snapId}...`);
  await eth.request({
    method: "wallet_requestSnaps",
    params: { [snapId]: {} }
  });
  setStatus(`Waiting for receipt of ${txHash}...`);
  const result = await waitForReceipt(txHash, {
    getReceipt: (h) => eth.request({ method: "eth_getTransactionReceipt", params: [h] })
  });
  if (!result.mined) {
    setStatus("Transaction not mined within the polling window. Try again later.");
    return;
  }
  setStatus(`Mined (status ${result.status}). Invoking ranking vouch...`);
  const rank = await eth.request({
    method: "wallet_invokeSnap",
    params: {
      snapId,
      request: {
        method: "klarity_rank",
        params: {
          chainId,
          contract,
          selector,
          interactionTxHash: txHash,
          account
        }
      }
    }
  });
  setStatus(`Done. API base ${apiBase}
${JSON.stringify(rank, null, 2)}`);
}
function main() {
  byId("connect").addEventListener("click", () => {
    run().catch((err) => {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}
main();
