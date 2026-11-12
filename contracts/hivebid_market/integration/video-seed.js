const { Worker, NEAR } = require("near-workspaces");
const fs = require("fs");

const WASM = fs.readFileSync(process.env.HIVEBID_WASM || "../wasm/canonical-hivebid_market.wasm");
const TH = (hex) => "T:" + hex.padStart(64, "0");

function assert(cond, msg) { if (!cond) throw new Error("ASSERT: " + msg); }

async function main() {
  const worker = await Worker.init({ rm: false, homeDir: "/tmp/hivebid-sandbox/video-demo2" });
  const root = worker.rootAccount;

  // 1. Контракт
  const contract = await root.createSubAccount("hivebid");
  await contract.deploy(WASM);
  await contract.call(contract, "new", { owner_id: root.accountId }, {});
  console.log("[1] deployed + initialized");

  // 2. Агенты (стака 10N)
  const stake = NEAR.parse("10 N");
  const agents = [];
  for (const name of ["agent-a", "agent-b", "agent-c"]) {
    const a = await root.createSubAccount(name);
    await a.call(contract, "register_agent", {}, { attachedDeposit: stake });
    const rec = await contract.view("get_agent", { account: a.accountId });
    assert(rec, "agent " + name + " not registered");
    agents.push(a);
    console.log("[2] registered " + name);
  }

  // 3. Лот 1: open + bids
  const now = Date.now();
  const bidDL = now + 600_000; // 10 мин открыто для демо
  await root.call(contract, "create_task", {
    lot_id: "LOT-001",
    task_hash: TH("1"),
    bid_deadline_ms: bidDL,
    work_deadline_ms: now + 3_600_000,
    verify_deadline_ms: now + 7_200_000,
  }, { attachedDeposit: NEAR.parse("5 N") });
  for (let i = 0; i < agents.length; i++) {
    const price = (4e24 - i * 1e24).toString(); // 4,3,2 N
    await agents[i].callRaw(contract, "submit_bid",
      Buffer.from(JSON.stringify({ lot_id: "LOT-001", price, eta_ms: 60000, signature: "sig-" + i })),
      {});
  }
  const lot1 = await contract.view("get_lot", { lot_id: "LOT-001" });
  assert(lot1.bids && lot1.bids.length === 3, "LOT-001 bids expected 3, got " + (lot1.bids && lot1.bids.length));
  console.log("[3] LOT-001 open, 3 bids OK");

  // 4. Лот 2: full cycle → Completed
  await root.call(contract, "create_task", {
    lot_id: "LOT-002", task_hash: TH("2"),
    bid_deadline_ms: now + 600_000,
    work_deadline_ms: now + 3_600_000,
    verify_deadline_ms: now + 7_200_000,
  }, { attachedDeposit: NEAR.parse("8 N") });
  await agents[1].callRaw(contract, "submit_bid",
    Buffer.from(JSON.stringify({ lot_id: "LOT-002", price: (7e24).toString(), eta_ms: 60000, signature: "sig-b2" })), {});
  await root.call(contract, "close_bidding", { lot_id: "LOT-002" });
  const w2 = await root.call(contract, "award_best", { lot_id: "LOT-002" });
  assert(w2 === agents[1].accountId, "winner should be agent-b, got " + w2);
  await agents[1].call(contract, "submit_work", { lot_id: "LOT-002", work_hash: "W:deadbeef" }, {});
  await root.call(contract, "accept_work", { lot_id: "LOT-002" });
  const lot2 = await contract.view("get_lot", { lot_id: "LOT-002" });
  assert(lot2.status === "Completed", "LOT-002 status=" + lot2.status);
  console.log("[4] LOT-002 Completed OK");

  // 5. Лот 3: NO_SHOW → Failed
  await root.call(contract, "create_task", {
    lot_id: "LOT-003", task_hash: TH("3"),
    bid_deadline_ms: now + 600_000,
    work_deadline_ms: now - 5_000,
    verify_deadline_ms: now + 3_600_000,
  }, { attachedDeposit: NEAR.parse("3 N") });
  await agents[2].callRaw(contract, "submit_bid",
    Buffer.from(JSON.stringify({ lot_id: "LOT-003", price: (2e24).toString(), eta_ms: 60000, signature: "sig-c3" })), {});
  await root.call(contract, "close_bidding", { lot_id: "LOT-003" });
  await root.call(contract, "award_best", { lot_id: "LOT-003" });
  await root.call(contract, "mark_no_show", { lot_id: "LOT-003" });
  const lot3 = await contract.view("get_lot", { lot_id: "LOT-003" });
  assert(lot3.status === "Failed", "LOT-003 status=" + lot3.status);
  console.log("[5] LOT-003 Failed OK");

  console.log(JSON.stringify({
    contract: contract.accountId,
    rpc: worker.provider.connection.url,
    lots: [lot1.status, lot2.status, lot3.status],
  }, null, 2));

  // keep alive 30 мин
  await new Promise(r => setTimeout(r, 1800_000));
}

main().catch(e => { console.error(String(e).slice(0, 2000)); process.exit(1); });
