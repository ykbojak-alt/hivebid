const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = process.env.VIDEO_RPC || "http://127.0.0.1:7233";
const KEY_FILE = process.env.VIDEO_KEY_FILE || "/tmp/sandbox/a1c376f8-2380-42f9-b1fa-f8c2024217e8/validator_key.json";
const WASM = fs.readFileSync("/root/nexus/contracts/hivebid_market/wasm/canonical-hivebid_market.wasm");
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

process.on("unhandledRejection", e => { console.error("REJECT:", e && e.stack ? e.stack.slice(0, 2500) : e); process.exit(1); });

async function main() {
  console.log("[START] main()");
  const keyStore = new InMemoryKeyStore();
  const rootKey = KeyPair.fromString(ROOT_KEY.secret_key);
  await keyStore.setKey("sandbox", "test.near", rootKey);
  const got = await keyStore.getKey("sandbox", "test.near");
  if (!got) throw new Error("root key missing from store");
  console.log("root key loaded:", !!got, "proto methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(got)).join(","));

  const signer = new InMemorySigner(keyStore);
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer });
  const root = new Account(near.connection, "test.near");

  const mkAccount = async (name) => {
    const id = name + ".test.near";
    const kp = KeyPair.fromRandom("ed25519");
    await keyStore.setKey("sandbox", id, kp);
    await root.createAccount(id, kp.getPublicKey(), utils.format.parseNearAmount("100"));
    return new Account(near.connection, id);
  };

  const contract = await mkAccount("hivebid");
  await sleep(500);
  const manager = await mkAccount("manager");
  await sleep(500);
  const a = await mkAccount("agent-a");
  await sleep(500);
  const b = await mkAccount("agent-b");
  await sleep(500);
  const c = await mkAccount("agent-c");
  console.log("[0] accounts:", [contract.accountId, manager.accountId, a.accountId, b.accountId, c.accountId].join(", "));

  // deploy + init (owner = manager)
  console.log("[0.5] deploying...");
  await contract.deployContract(WASM);
  console.log("[0.6] deployed, init...");
  await contract.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("new", { owner_id: manager.accountId }, 30000000000000, "0"),
  ]});
  await sleep(800);
  console.log("[1] deployed + initialized");

  // register agents
  const stake = utils.format.parseNearAmount("10");
  for (const acct of [a, b, c]) {
    await acct.signAndSendTransaction({ receiverId: contract.accountId, actions: [
      transactions.functionCall("register_agent", {}, 30000000000000, stake),
    ]});
    await sleep(800);
  }
  console.log("[2] agents registered");

  const now = Date.now();
  const bidDL = now + 600000;

  // LOT-001 open + 3 bids
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("create_task", {
      lot_id: "LOT-001", task_hash: "T:" + "1".padStart(64, "0"),
      bid_deadline_ms: bidDL,
      work_deadline_ms: now + 3600000,
      verify_deadline_ms: now + 7200000,
    }, 30000000000000, utils.format.parseNearAmount("5")),
  ]});
  await sleep(800);
  const prices = ["4", "3", "2"];
  const agents = [a, b, c];
  for (let i = 0; i < 3; i++) {
    await agents[i].signAndSendTransaction({ receiverId: contract.accountId, actions: [
      transactions.functionCall("submit_bid", {
        lot_id: "LOT-001", price: utils.format.parseNearAmount(prices[i]), eta_ms: 60000, signature: "sig-" + i,
      }, 30000000000000, "0"),
    ]});
    await sleep(800);
  }
  const lot1 = await contract.viewFunction(contract.accountId, "get_lot", { lot_id: "LOT-001" });
  console.log("[3] LOT-001 bids:", lot1 && lot1.bids ? lot1.bids.length : 0);
  if (!lot1 || !lot1.bids || lot1.bids.length !== 3) throw new Error("LOT-001 bids != 3");

  // LOT-002 full cycle
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("create_task", {
      lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
      bid_deadline_ms: bidDL, work_deadline_ms: now + 3600000, verify_deadline_ms: now + 7200000,
    }, 30000000000000, utils.format.parseNearAmount("8")),
  ]});
  await sleep(800);
  await b.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("submit_bid", { lot_id: "LOT-002", price: utils.format.parseNearAmount("7"), eta_ms: 60000, signature: "sig-b2" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("close_bidding", { lot_id: "LOT-002" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("award_best", { lot_id: "LOT-002" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  await b.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("submit_work", { lot_id: "LOT-002", work_hash: "W:deadbeef" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("accept_work", { lot_id: "LOT-002" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  const lot2 = await contract.viewFunction(contract.accountId, "get_lot", { lot_id: "LOT-002" });
  console.log("[4] LOT-002 status:", lot2 && lot2.status);
  if (!lot2 || lot2.status !== "Completed") throw new Error("LOT-002 not Completed");

  // LOT-003 NO_SHOW
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("create_task", {
      lot_id: "LOT-003", task_hash: "T:" + "3".padStart(64, "0"),
      bid_deadline_ms: bidDL, work_deadline_ms: now - 5000, verify_deadline_ms: now + 3600000,
    }, 30000000000000, utils.format.parseNearAmount("3")),
  ]});
  await sleep(800);
  await c.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("submit_bid", { lot_id: "LOT-003", price: utils.format.parseNearAmount("2"), eta_ms: 60000, signature: "sig-c3" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("close_bidding", { lot_id: "LOT-003" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("award_best", { lot_id: "LOT-003" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  await manager.signAndSendTransaction({ receiverId: contract.accountId, actions: [
    transactions.functionCall("mark_no_show", { lot_id: "LOT-003" }, 30000000000000, "0"),
  ]});
  await sleep(800);
  const lot3 = await contract.viewFunction(contract.accountId, "get_lot", { lot_id: "LOT-003" });
  console.log("[5] LOT-003 status:", lot3 && lot3.status);
  if (!lot3 || lot3.status !== "Failed") throw new Error("LOT-003 not Failed");

  const escrow = await contract.viewFunction(contract.accountId, "get_escrow", {});
  const treasury = await contract.viewFunction(contract.accountId, "get_treasury", {});
  const burned = await contract.viewFunction(contract.accountId, "get_burned", {});
  console.log(JSON.stringify({ contract: contract.accountId, rpc: RPC, escrow: String(escrow), treasury: String(treasury), burned: String(burned) }, null, 2));
  console.log("SEED_OK");
}

main().catch(e => { console.error(String(e).slice(0, 2500)); process.exit(1); });

