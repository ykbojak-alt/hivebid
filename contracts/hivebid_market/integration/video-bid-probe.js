const { Worker, NEAR } = require("near-workspaces");
const fs = require("fs");
const WASM = fs.readFileSync("../wasm/canonical-hivebid_market.wasm");

async function main() {
  const worker = await Worker.init({ rm: false, homeDir: "/tmp/hivebid-sandbox/video-demo2" });
  const root = worker.rootAccount;
  const contract = await root.getAccount("hivebid.test.near");
  const agent = await root.createSubAccount("probe-agent");
  const stake = NEAR.parse("10 N");
  await agent.call(contract, "register_agent", {}, { attachedDeposit: stake });

  const now = Date.now();
  await root.call(contract, "create_task", {
    lot_id: "PROBE-LOT-1", task_hash: "T:" + "a".repeat(64),
    bid_deadline_ms: now + 600000,
    work_deadline_ms: now + 3600000,
    verify_deadline_ms: now + 7200000,
  }, { attachedDeposit: NEAR.parse("5 N") });

  const price = (4e24).toString();
  const args = JSON.stringify({ lot_id: "PROBE-LOT-1", price, eta_ms: 60000, signature: "probe-sig" });
  console.log("args:", args);
  let res;
  try {
    res = await agent.callRaw(contract, "submit_bid", Buffer.from(args), {});
    console.log("callRaw OK", res);
  } catch (e) {
    console.log("callRaw ERR:", String(e).slice(0, 1200));
  }

  const lot = await contract.view("get_lot", { lot_id: "PROBE-LOT-1" });
  console.log("lot.bids:", JSON.stringify(lot.bids));
  await worker.tearDown();
}
main().catch(e => { console.error(String(e).slice(0, 1200)); process.exit(1); });
