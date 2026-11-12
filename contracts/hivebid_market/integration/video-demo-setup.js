const { Worker, NEAR } = require("near-workspaces");
const fs = require("fs");

const WASM = fs.readFileSync(process.env.HIVEBID_WASM || "../wasm/canonical-hivebid_market.wasm");
const TH = (hex) => "T:" + hex.padStart(64, "0");

async function main() {
  const worker = await Worker.init({ rm: false, homeDir: "/tmp/hivebid-sandbox/video-demo" });
  const root = worker.rootAccount;
  const manager = await root.devCreateAccount("manager");
  const agentA = await root.devCreateAccount("agent-a");
  const agentB = await root.devCreateAccount("agent-b");
  const agentC = await root.devCreateAccount("agent-c");
  await root.transfer(manager.accountId, NEAR.parse("1000 N"));
  await root.transfer(agentA.accountId, NEAR.parse("500 N"));
  await root.transfer(agentB.accountId, NEAR.parse("500 N"));
  await root.transfer(agentC.accountId, NEAR.parse("500 N"));

  const contract = await root.createSubAccount("hivebid");
  await contract.deploy(WASM);
  await contract.call(contract, "new", { owner_id: manager.accountId }, {});
  console.log("deployed + initialized");

  const stake = NEAR.parse("10 N");
  await agentA.call(contract, "register_agent", {}, { attachedDeposit: stake });
  await agentB.call(contract, "register_agent", {}, { attachedDeposit: stake });
  await agentC.call(contract, "register_agent", {}, { attachedDeposit: stake });
  console.log("agents registered");

  const now = Date.now();
  const mkLot = (lotId, budget, idx, wdl, vdl) => manager.call(contract, "create_task", {
    lot_id: lotId, task_hash: TH(String(idx)),
    bid_deadline_ms: now + 30_000,
    work_deadline_ms: wdl ?? now + 3_600_000,
    verify_deadline_ms: vdl ?? now + 7_200_000,
  }, { attachedDeposit: budget });

  const b1 = NEAR.parse("5 N");
  await mkLot("LOT-001", b1, 1);
  await agentA.callRaw(contract, "submit_bid", Buffer.from(JSON.stringify({ lot_id: "LOT-001", price: (4e24).toString(), eta_ms: 60000, signature: "demo-sig-a" })), {});
  await agentB.callRaw(contract, "submit_bid", Buffer.from(JSON.stringify({ lot_id: "LOT-001", price: (3e24).toString(), eta_ms: 45000, signature: "demo-sig-b" })), {});
  await agentC.callRaw(contract, "submit_bid", Buffer.from(JSON.stringify({ lot_id: "LOT-001", price: (5e24).toString(), eta_ms: 90000, signature: "demo-sig-c" })), {});
  console.log("LOT-001 open with 3 bids");

  const b2 = NEAR.parse("8 N");
  await mkLot("LOT-002", b2, 2);
  await agentB.callRaw(contract, "submit_bid", Buffer.from(JSON.stringify({ lot_id: "LOT-002", price: (7e24).toString(), eta_ms: 60000, signature: "demo-sig-b2" })), {});
  await new Promise(r => setTimeout(r, 31000));
  await manager.call(contract, "close_bidding", { lot_id: "LOT-002" });
  await new Promise(r => setTimeout(r, 31000));
  await manager.call(contract, "close_bidding", { lot_id: "LOT-002" });
  await manager.call(contract, "award_best", { lot_id: "LOT-002" });
  await agentB.call(contract, "submit_work", { lot_id: "LOT-002", work_hash: "W:deadbeef" }, {});
  await manager.call(contract, "accept_work", { lot_id: "LOT-002" });
  console.log("LOT-002 completed full cycle");

  const b3 = NEAR.parse("3 N");
  await manager.call(contract, "create_task", {
    lot_id: "LOT-003", task_hash: TH("3"),
    bid_deadline_ms: now + 30_000,
    work_deadline_ms: now - 5_000,
    verify_deadline_ms: now + 3_600_000,
  }, { attachedDeposit: b3 });
  await agentC.callRaw(contract, "submit_bid", Buffer.from(JSON.stringify({ lot_id: "LOT-003", price: (2e24).toString(), eta_ms: 60000, signature: "demo-sig-c3" })), {});
  await new Promise(r => setTimeout(r, 31000));
  await manager.call(contract, "close_bidding", { lot_id: "LOT-003" });
  await new Promise(r => setTimeout(r, 31000));
  await manager.call(contract, "close_bidding", { lot_id: "LOT-003" });
  await manager.call(contract, "award_best", { lot_id: "LOT-003" });
  await manager.call(contract, "mark_no_show", { lot_id: "LOT-003" });
  console.log("LOT-003 failed NO_SHOW");

  console.log(JSON.stringify({ contract: contract.accountId, manager: manager.accountId, agents: [agentA.accountId, agentB.accountId, agentC.accountId], rpc: worker.provider.connection.url }, null, 2));
  await new Promise(r => setTimeout(r, 3600_000));
}

main().catch(e => { console.error(String(e).slice(0, 2500)); process.exit(1); });
