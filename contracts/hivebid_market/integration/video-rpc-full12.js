const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = process.env.VIDEO_RPC || "http://127.0.0.1:3030";
const KEY_FILE = process.env.VIDEO_KEY_FILE || "/tmp/hivebid-sandbox/video-clean2/validator_key.json";
const WASM_PATH = process.env.VIDEO_WASM || "../target/wasm32-unknown-unknown/release/hivebid_market.wasm";
const WASM = fs.readFileSync(WASM_PATH);
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "../integration/video-keys.json";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAS = 30000000000000;

process.on("unhandledRejection", e => { console.error("REJECT:", e && e.stack ? e.stack.slice(0, 2500) : e); process.exit(1); });

const RAWJSON = (obj, bigNums) => {
  let s = JSON.stringify(obj);
  for (const [key, raw] of Object.entries(bigNums || {})) {
    s = s.replace(`"${key}":${JSON.stringify(raw)}`, `"${key}":${raw}`);
  }
  return Buffer.from(s);
};

async function main() {
  console.log("[START] full v12 (clean 10015)");
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });
  const root = new Account(near.connection, "test.near");

  const keysDb = {};
  try { Object.assign(keysDb, JSON.parse(fs.readFileSync(KEYS_DB, "utf8"))); } catch (e) {}
  const saveKeys = () => fs.writeFileSync(KEYS_DB, JSON.stringify(keysDb, null, 2));
  const mkAccount = async (name) => {
    const id = name + ".test.near";
    if (keysDb[id]) {
      await keyStore.setKey("sandbox", id, KeyPair.fromString(keysDb[id]));
      console.log("[0] reused key for", id);
    } else {
      const kp = KeyPair.fromRandom("ed25519");
      keysDb[id] = kp.toString();
      saveKeys();
      await keyStore.setKey("sandbox", id, kp);
      try { await root.createAccount(id, kp.getPublicKey(), utils.format.parseNearAmount("100")); }
      catch (e) { if (!String(e).includes("already exists")) throw e; }
      console.log("[0] created", id);
    }
    return new Account(near.connection, id);
  };

  const contract = await mkAccount("hivebid-v1");
  const contractId = contract.accountId;
  const account = (name) => new Account(near.connection, name + ".test.near");
  const boss = await mkAccount("boss2");
  const alpha = await mkAccount("alpha2");
  const bravo = await mkAccount("bravo2");
  const charlie = await mkAccount("charlie2");
  console.log("[0] accounts:", [contractId, boss.accountId, alpha.accountId, bravo.accountId, charlie.accountId].join(", "));

  const chainNowMs = async () => {
    const b = await near.connection.provider.block({ finality: "optimistic" });
    const ts = b.header.timestamp_nanosec ?? b.header.timestamp;
    return Number(BigInt(ts) / 1000000n);
  };
  const waitPast = async (deadlineMs, label) => {
    for (let i = 0; i < 600; i++) {
      if ((await chainNowMs()) > deadlineMs) { console.log("   [waitPast] passed", label, "chainNow:", await chainNowMs()); return; }
      await sleep(300);
    }
    throw new Error("waitPast never passed " + label);
  };

  const view = async (method, args) => {
    const res = await near.connection.provider.query({
      request_type: "call_function", finality: "final",
      account_id: contractId, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
    });
    return res.result && res.result.length ? JSON.parse(Buffer.from(res.result).toString("utf8")) : null;
  };

  const callRaw = async (acct, method, obj, deposit, bigNums) => {
    await acct.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.functionCall(method, RAWJSON(obj, bigNums), GAS, String(deposit || 0)),
    ]});
    await sleep(1500);
  };

  // ---- Деплой + init ----
  console.log("[1] deploy + init...");
  await contract.signAndSendTransaction({ receiverId: contractId, actions: [
    transactions.deployContract(WASM),
  ]});
  await sleep(1000);
  await callRaw(boss, "new", { owner_id: boss.accountId }, 0);
  console.log("[2] deployed + init owner boss");

  // ---- Агенты ----
  const stake = utils.format.parseNearAmount("10");
  for (const a of [alpha, bravo, charlie]) {
    await callRaw(a, "register_agent", {}, stake);
    console.log("[2] registered", a.accountId);
  }

  const now = await chainNowMs();
  console.log("[3] chainNow:", now);

  // ---- LOT-001: open + 3 bids ----
  await callRaw(boss, "create_task", {
    lot_id: "LOT-001", task_hash: "T:" + "1".padStart(64, "0"),
    bid_deadline_ms: now + 3600000, work_deadline_ms: now + 7200000, verify_deadline_ms: now + 10800000,
  }, utils.format.parseNearAmount("5"));
  const prices = ["4000000000000000000000000", "3000000000000000000000000", "2000000000000000000000000"];
  const agents = [alpha, bravo, charlie];
  for (let i = 0; i < 3; i++) {
    await callRaw(agents[i], "submit_bid", {
      lot_id: "LOT-001", price: prices[i], eta_ms: 60000, signature: "sig-" + i,
    }, 0, { price: prices[i] });
    console.log("[3] bid from", agents[i].accountId, prices[i] / 1e24, "N");
  }
  const lot1 = await view("get_lot", { lot_id: "LOT-001" });
  if (!lot1.bids || lot1.bids.length !== 3) throw new Error("LOT-001 bids != 3, got " + (lot1.bids && lot1.bids.length));
  console.log("[3] LOT-001 status:", lot1.status, "bids:", lot1.bids.length);

  // ---- LOT-002: полный цикл → Completed ----
  console.log("[4] LOT-002 full cycle...");
  const now2 = await chainNowMs();
  const bidDL2 = now2 + 30000;
  const wd2 = now2 + 60000;
  const vd2 = now2 + 120000;
  await callRaw(boss, "create_task", {
    lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
    bid_deadline_ms: bidDL2, work_deadline_ms: wd2, verify_deadline_ms: vd2,
  }, utils.format.parseNearAmount("8"));
  await callRaw(bravo, "submit_bid", {
    lot_id: "LOT-002", price: "7000000000000000000000000", eta_ms: 30000, signature: "sig-b2",
  }, 0, { price: "7000000000000000000000000" });
  console.log("[4] waiting for bid deadline (chain-time)...");
  await waitPast(bidDL2, "bid_deadline LOT-002");
  await callRaw(boss, "close_bidding", { lot_id: "LOT-002" }, 0);
  await callRaw(boss, "award_best", { lot_id: "LOT-002" }, 0);
  await callRaw(bravo, "submit_work", { lot_id: "LOT-002", work_hash: "W:deadbeef" }, 0);
  await callRaw(boss, "accept_work", { lot_id: "LOT-002" }, 0);
  const lot2 = await view("get_lot", { lot_id: "LOT-002" });
  if (lot2.status !== "Completed") throw new Error("LOT-002 status=" + lot2.status + ", expected Completed");
  console.log("[4] LOT-002 status:", lot2.status);

  // ---- LOT-003: NO_SHOW → Failed ----
  console.log("[5] LOT-003 no_show...");
  const now3 = await chainNowMs();
  const bidDL3 = now3 + 30000;
  const wd3 = now3 + 60000;
  const vd3 = now3 + 120000;
  await callRaw(boss, "create_task", {
    lot_id: "LOT-003", task_hash: "T:" + "3".padStart(64, "0"),
    bid_deadline_ms: bidDL3, work_deadline_ms: wd3, verify_deadline_ms: vd3,
  }, utils.format.parseNearAmount("3"));
  await callRaw(charlie, "submit_bid", {
    lot_id: "LOT-003", price: "2000000000000000000000000", eta_ms: 30000, signature: "sig-c3",
  }, 0, { price: "2000000000000000000000000" });
  console.log("[5] waiting for bid deadline (chain-time)...");
  await waitPast(bidDL3, "bid_deadline LOT-003");
  await callRaw(boss, "close_bidding", { lot_id: "LOT-003" }, 0);
  await callRaw(boss, "award_best", { lot_id: "LOT-003" }, 0);
  console.log("[5] waiting for work deadline (chain-time)...");
  await waitPast(wd3, "work_deadline LOT-003");
  await callRaw(boss, "mark_no_show", { lot_id: "LOT-003" }, 0);
  const lot3 = await view("get_lot", { lot_id: "LOT-003" });
  if (lot3.status !== "Failed") throw new Error("LOT-003 status=" + lot3.status + ", expected Failed");
  console.log("[5] LOT-003 status:", lot3.status);

  const escrow = await view("get_escrow");
  const treasury = await view("get_treasury");
  const burned = await view("get_burned");
  console.log(JSON.stringify({ contract: contractId, rpc: RPC, escrow: String(escrow), treasury: String(treasury), burned: String(burned), lots: [lot1.status, lot2.status, lot3.status] }, null, 2));
  console.log("SEED_OK");
}

main().catch(e => { console.error(String(e).slice(0, 2500)); process.exit(1); });

