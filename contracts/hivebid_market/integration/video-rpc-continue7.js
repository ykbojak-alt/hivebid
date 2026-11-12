const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = process.env.VIDEO_RPC || "http://127.0.0.1:31915";
const KEY_FILE = process.env.VIDEO_KEY_FILE || "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
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
  console.log("[START] continue v7 (safe 30s deadlines)");
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8"));
  for (const [k, v] of Object.entries(keysDb)) await keyStore.setKey("sandbox", k, KeyPair.fromString(v));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });

  const contractId = "hivebid3.test.near";
  const account = (name) => new Account(near.connection, name + ".test.near");
  const boss = account("boss");
  const bravo = account("bravo");
  const charlie = account("charlie");

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
    await sleep(1200);
  };

  const now = Date.now();
  const BID_DL = now + 30000;       // торги закроются через 30с
  const WORK_DL = now + 35000;       // work deadline ещё через 5с после закрытия
  const VERIFY_DL = now + 90000;

  // ---- LOT-002: полный цикл → Completed ----
  let lotIds = await view("get_lot_ids");
  if (!lotIds.includes("LOT-002")) {
    await callRaw(boss, "create_task", {
      lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
      bid_deadline_ms: BID_DL, work_deadline_ms: WORK_DL, verify_deadline_ms: VERIFY_DL,
    }, utils.format.parseNearAmount("8"));
    await callRaw(bravo, "submit_bid", {
      lot_id: "LOT-002", price: "7000000000000000000000000", eta_ms: 60000, signature: "sig-b2",
    }, 0, { price: "7000000000000000000000000" });
    console.log("[4] LOT-002 created + bid, waiting 31s for bid deadline...");
    await sleep(31000);
    await callRaw(boss, "close_bidding", { lot_id: "LOT-002" }, 0);
    await callRaw(boss, "award_best", { lot_id: "LOT-002" }, 0);
    await callRaw(bravo, "submit_work", { lot_id: "LOT-002", work_hash: "W:deadbeef" }, 0);
    await callRaw(boss, "accept_work", { lot_id: "LOT-002" }, 0);
    console.log("[4] LOT-002 cycle done");
  } else {
    console.log("[4] LOT-002 exists, skip");
  }
  const lot2 = await view("get_lot", { lot_id: "LOT-002" });
  if (lot2.status !== "Completed") throw new Error("LOT-002 status=" + lot2.status + ", expected Completed");
  console.log("[4] LOT-002 status:", lot2.status);

  // ---- LOT-003: NO_SHOW → Failed ----
  lotIds = await view("get_lot_ids");
  if (!lotIds.includes("LOT-003")) {
    const BID3 = now + 30000;
    const WORK3 = now + 35000;
    const VERIFY3 = now + 90000;
    await callRaw(boss, "create_task", {
      lot_id: "LOT-003", task_hash: "T:" + "3".padStart(64, "0"),
      bid_deadline_ms: BID3, work_deadline_ms: WORK3, verify_deadline_ms: VERIFY3,
    }, utils.format.parseNearAmount("3"));
    await callRaw(charlie, "submit_bid", {
      lot_id: "LOT-003", price: "2000000000000000000000000", eta_ms: 60000, signature: "sig-c3",
    }, 0, { price: "2000000000000000000000000" });
    console.log("[5] LOT-003 created + bid, waiting 31s for bid deadline...");
    await sleep(31000);
    await callRaw(boss, "close_bidding", { lot_id: "LOT-003" }, 0);
    await callRaw(boss, "award_best", { lot_id: "LOT-003" }, 0);
    console.log("[5] LOT-003 awarded, waiting 6s for work deadline...");
    await sleep(6000); // now > WORK3 (now+35000, прошло 31+6=37с)
    await callRaw(boss, "mark_no_show", { lot_id: "LOT-003" }, 0);
    console.log("[5] LOT-003 no_show done");
  } else {
    console.log("[5] LOT-003 exists, skip");
  }
  const lot3 = await view("get_lot", { lot_id: "LOT-003" });
  if (lot3.status !== "Failed") throw new Error("LOT-003 status=" + lot3.status + ", expected Failed");
  console.log("[5] LOT-003 status:", lot3.status);

  const lot1 = await view("get_lot", { lot_id: "LOT-001" });
  const escrow = await view("get_escrow");
  const treasury = await view("get_treasury");
  const burned = await view("get_burned");
  console.log(JSON.stringify({ contract: contractId, rpc: RPC, escrow: String(escrow), treasury: String(treasury), burned: String(burned), lots: [lot1.status, lot2.status, lot3.status] }, null, 2));
  console.log("SEED_OK");
}

main().catch(e => { console.error(String(e).slice(0, 2500)); process.exit(1); });

