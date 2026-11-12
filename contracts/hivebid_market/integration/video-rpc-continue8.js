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
  console.log("[START] continue v8 (phase-aware)");
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

  // ---------- LOT-002 → Completed ----------
  let lot = await view("get_lot", { lot_id: "LOT-002" });
  if (!lot) {
    await callRaw(boss, "create_task", {
      lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
      bid_deadline_ms: now + 30000, work_deadline_ms: now + 35000, verify_deadline_ms: now + 90000,
    }, utils.format.parseNearAmount("8"));
    await callRaw(bravo, "submit_bid", {
      lot_id: "LOT-002", price: "7000000000000000000000000", eta_ms: 60000, signature: "sig-b2",
    }, 0, { price: "7000000000000000000000000" });
    console.log("[4] LOT-002 created + bid");
  } else {
    console.log("[4] LOT-002 exists, status:", lot.status, "| bids:", lot.bids ? lot.bids.length : 0);
  }

  lot = await view("get_lot", { lot_id: "LOT-002" });
  if (lot.status === "Open") {
    if (!lot.bids || lot.bids.length === 0) {
      // deadline может быть в прошлом (созданный ранее лот) → bid уже не пройдёт;
      // создаём с нуля с новым id, если закрыт
      if (lot.bid_deadline_ms <= Date.now()) {
        console.log("[4] LOT-002 bid closed by time, recreating lot...");
        await callRaw(boss, "create_task", {
          lot_id: "LOT-002B", task_hash: "T:" + "B".padStart(64, "0"),
          bid_deadline_ms: now + 30000, work_deadline_ms: now + 35000, verify_deadline_ms: now + 90000,
        }, utils.format.parseNearAmount("8"));
        await callRaw(bravo, "submit_bid", {
          lot_id: "LOT-002B", price: "7000000000000000000000000", eta_ms: 60000, signature: "sig-b2",
        }, 0, { price: "7000000000000000000000000" });
        lot = await view("get_lot", { lot_id: "LOT-002B" });
      } else {
        await callRaw(bravo, "submit_bid", {
          lot_id: "LOT-002", price: "7000000000000000000000000", eta_ms: 60000, signature: "sig-b2",
        }, 0, { price: "7000000000000000000000000" });
      }
    }
    console.log("[4] waiting for bid deadline...");
    const bidDL = lot.bid_deadline_ms;
    const wait = bidDL - Date.now() + 2000;
    if (wait > 0) await sleep(wait);
    await callRaw(boss, "close_bidding", { lot_id: lot.lot_id }, 0);
  }

  lot = await view("get_lot", { lot_id: lot.lot_id });
  if (lot.status === "BidsClosed" || lot.status === "Open") {
    await callRaw(boss, "close_bidding", { lot_id: lot.lot_id }, 0);
    lot = await view("get_lot", { lot_id: lot.lot_id });
  }
  if (lot.status === "BidsClosed") {
    await callRaw(boss, "award_best", { lot_id: lot.lot_id }, 0);
  }
  lot = await view("get_lot", { lot_id: lot.lot_id });
  if (lot.status === "Awarded") {
    await callRaw(bravo, "submit_work", { lot_id: lot.lot_id, work_hash: "W:deadbeef" }, 0);
  }
  lot = await view("get_lot", { lot_id: lot.lot_id });
  if (lot.status === "Submitted") {
    await callRaw(boss, "accept_work", { lot_id: lot.lot_id }, 0);
  }
  lot = await view("get_lot", { lot_id: lot.lot_id });
  console.log("[4] LOT-002 final status:", lot.status);
  if (lot.status !== "Completed") throw new Error("LOT-002 final status=" + lot.status);

  // ---------- LOT-003 → Failed ----------
  lot = await view("get_lot", { lot_id: "LOT-003" });
  if (!lot) {
    await callRaw(boss, "create_task", {
      lot_id: "LOT-003", task_hash: "T:" + "3".padStart(64, "0"),
      bid_deadline_ms: now + 30000, work_deadline_ms: now + 35000, verify_deadline_ms: now + 90000,
    }, utils.format.parseNearAmount("3"));
    await callRaw(charlie, "submit_bid", {
      lot_id: "LOT-003", price: "2000000000000000000000000", eta_ms: 60000, signature: "sig-c3",
    }, 0, { price: "2000000000000000000000000" });
    console.log("[5] LOT-003 created + bid");
  } else {
    console.log("[5] LOT-003 exists, status:", lot.status);
  }

  lot = await view("get_lot", { lot_id: "LOT-003" });
  if (lot.status === "Open") {
    if (!lot.bids || lot.bids.length === 0) {
      if (lot.bid_deadline_ms <= Date.now()) {
        console.log("[5] LOT-003 bid closed by time, recreating lot...");
        await callRaw(boss, "create_task", {
          lot_id: "LOT-003B", task_hash: "T:" + "C".padStart(64, "0"),
          bid_deadline_ms: now + 30000, work_deadline_ms: now + 35000, verify_deadline_ms: now + 90000,
        }, utils.format.parseNearAmount("3"));
        await callRaw(charlie, "submit_bid", {
          lot_id: "LOT-003B", price: "2000000000000000000000000", eta_ms: 60000, signature: "sig-c3",
        }, 0, { price: "2000000000000000000000000" });
        lot = await view("get_lot", { lot_id: "LOT-003B" });
      } else {
        await callRaw(charlie, "submit_bid", {
          lot_id: "LOT-003", price: "2000000000000000000000000", eta_ms: 60000, signature: "sig-c3",
        }, 0, { price: "2000000000000000000000000" });
      }
    }
    console.log("[5] waiting for bid deadline...");
    const bidDL3 = lot.bid_deadline_ms;
    const wait3 = bidDL3 - Date.now() + 2000;
    if (wait3 > 0) await sleep(wait3);
    await callRaw(boss, "close_bidding", { lot_id: lot.lot_id }, 0);
  }

  lot = await view("get_lot", { lot_id: lot.lot_id });
  if (lot.status === "Open") {
    await callRaw(boss, "close_bidding", { lot_id: lot.lot_id }, 0);
    lot = await view("get_lot", { lot_id: lot.lot_id });
  }
  if (lot.status === "BidsClosed") {
    await callRaw(boss, "award_best", { lot_id: lot.lot_id }, 0);
  }
  lot = await view("get_lot", { lot_id: lot.lot_id });
  if (lot.status === "Awarded") {
    // ждём work deadline
    console.log("[5] waiting for work deadline...");
    const workDL = lot.work_deadline_ms;
    const waitW = workDL - Date.now() + 2000;
    if (waitW > 0) await sleep(waitW);
    await callRaw(boss, "mark_no_show", { lot_id: lot.lot_id }, 0);
  }
  lot = await view("get_lot", { lot_id: lot.lot_id });
  console.log("[5] LOT-003 final status:", lot.status);
  if (lot.status !== "Failed") throw new Error("LOT-003 final status=" + lot.status);

  const lot1 = await view("get_lot", { lot_id: "LOT-001" });
  const escrow = await view("get_escrow");
  const treasury = await view("get_treasury");
  const burned = await view("get_burned");
  console.log(JSON.stringify({ contract: contractId, rpc: RPC, escrow: String(escrow), treasury: String(treasury), burned: String(burned), lots: [lot1.status, lot.status] }, null, 2));
  console.log("SEED_OK");
}

main().catch(e => { console.error(String(e).slice(0, 2500)); process.exit(1); });

