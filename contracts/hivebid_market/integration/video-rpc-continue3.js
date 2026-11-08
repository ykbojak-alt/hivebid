const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = process.env.VIDEO_RPC || "http://127.0.0.1:31915";
const KEY_FILE = process.env.VIDEO_KEY_FILE || "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const WASM = fs.readFileSync("/root/nexus/contracts/hivebid_market/wasm/canonical-hivebid_market.wasm");
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "/root/nexus/contracts/hivebid_market/integration/video-keys.json";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAS = 30000000000000;

process.on("unhandledRejection", e => { console.error("REJECT:", e && e.stack ? e.stack.slice(0, 2500) : e); process.exit(1); });

async function main() {
  console.log("[START] continue-mode v3 (fresh subaccounts)");
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const signer = new InMemorySigner(keyStore);
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer });
  const root = new Account(near.connection, "test.near");

  let keysDb = {};
  try { keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8")); } catch (e) {}
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
      try {
        await root.createAccount(id, kp.getPublicKey(), utils.format.parseNearAmount("100"));
        console.log("[0] created", id);
      } catch (e) {
        if (!String(e).includes("already exists")) throw e;
        console.log("[0] account exists, key freshly generated (may mismatch!)", id);
      }
    }
    return new Account(near.connection, id);
  };

  const contractId = "hivebid.test.near";
  const contract = new Account(near.connection, contractId);

  const view = async (method, args) => {
    const res = await near.connection.provider.query({
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
    });
    return res.result && res.result.length ? JSON.parse(Buffer.from(res.result).toString("utf8")) : null;
  };

  const call = async (acct, method, args, deposit) => {
    await acct.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.functionCall(method, args, GAS, String(deposit || 0)),
    ]});
    await sleep(1000);
  };

  // Новые аккаунты — только под нашим контролем ключей
  const boss = await mkAccount("boss");
  const alpha = await mkAccount("alpha");
  const bravo = await mkAccount("bravo");
  const charlie = await mkAccount("charlie");
  console.log("[1] accounts:", [boss.accountId, alpha.accountId, bravo.accountId, charlie.accountId].join(", "));

  // Регистрация агентов (проверка через get_agent)
  const stake = utils.format.parseNearAmount("10");
  for (const a of [alpha, bravo, charlie]) {
    let rec = null;
    try { rec = await view("get_agent", { account: a.accountId }); } catch (e) { console.log("get_agent err:", String(e).slice(0, 120)); }
    if (rec) {
      console.log("[2] agent", a.accountId, "already registered, stake", rec.stake);
    } else {
      await call(a, "register_agent", {}, stake);
      console.log("[2] registered", a.accountId);
    }
  }

  const now = Date.now();

  // LOT-001: существует (open) или создать; добавить 3 ставки
  let lotIds = await view("get_lot_ids");
  console.log("[3] existing lots:", JSON.stringify(lotIds));
  let lot1 = null;
  if (lotIds.includes("LOT-001")) lot1 = await view("get_lot", { lot_id: "LOT-001" });
  if (!lot1) {
    await call(boss, "create_task", {
      lot_id: "LOT-001", task_hash: "T:" + "1".padStart(64, "0"),
      bid_deadline_ms: now + 600000, work_deadline_ms: now + 3600000, verify_deadline_ms: now + 7200000,
    }, utils.format.parseNearAmount("5"));
    lot1 = await view("get_lot", { lot_id: "LOT-001" });
    console.log("[3] created LOT-001");
  } else {
    console.log("[3] LOT-001 exists, status:", lot1.status);
  }

  const bidders = (lot1.bids || []).map(b => b.agent);
  const prices = ["4", "3", "2"];
  const agents = [alpha, bravo, charlie];
  for (let i = 0; i < agents.length; i++) {
    if (bidders.includes(agents[i].accountId)) {
      console.log("[3] bid from", agents[i].accountId, "already there");
    } else {
      await call(agents[i], "submit_bid", {
        lot_id: "LOT-001", price: utils.format.parseNearAmount(prices[i]), eta_ms: 60000, signature: "sig-" + i,
      }, 0);
      console.log("[3] bid from", agents[i].accountId, prices[i], "N");
    }
  }
  lot1 = await view("get_lot", { lot_id: "LOT-001" });
  if (!lot1.bids || lot1.bids.length !== 3) throw new Error("LOT-001 bids != 3, got " + (lot1.bids && lot1.bids.length));
  console.log("[3] LOT-001 bids:", lot1.bids.length);

  // LOT-002: полный цикл → Completed
  lotIds = await view("get_lot_ids");
  if (!lotIds.includes("LOT-002")) {
    await call(boss, "create_task", {
      lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
      bid_deadline_ms: now + 600000, work_deadline_ms: now + 3600000, verify_deadline_ms: now + 7200000,
    }, utils.format.parseNearAmount("8"));
    await call(bravo, "submit_bid", { lot_id: "LOT-002", price: utils.format.parseNearAmount("7"), eta_ms: 60000, signature: "sig-b2" }, 0);
    await call(boss, "close_bidding", { lot_id: "LOT-002" }, 0);
    await call(boss, "award_best", { lot_id: "LOT-002" }, 0);
    await call(bravo, "submit_work", { lot_id: "LOT-002", work_hash: "W:deadbeef" }, 0);
    await call(boss, "accept_work", { lot_id: "LOT-002" }, 0);
    console.log("[4] created LOT-002 cycle");
  } else {
    console.log("[4] LOT-002 exists, skip");
  }
  const lot2 = await view("get_lot", { lot_id: "LOT-002" });
  if (lot2.status !== "Completed") throw new Error("LOT-002 status=" + lot2.status + ", expected Completed");
  console.log("[4] LOT-002 status:", lot2.status);

  // LOT-003: NO_SHOW → Failed
  lotIds = await view("get_lot_ids");
  if (!lotIds.includes("LOT-003")) {
    await call(boss, "create_task", {
      lot_id: "LOT-003", task_hash: "T:" + "3".padStart(64, "0"),
      bid_deadline_ms: now + 600000, work_deadline_ms: now - 5000, verify_deadline_ms: now + 3600000,
    }, utils.format.parseNearAmount("3"));
    await call(charlie, "submit_bid", { lot_id: "LOT-003", price: utils.format.parseNearAmount("2"), eta_ms: 60000, signature: "sig-c3" }, 0);
    await call(boss, "close_bidding", { lot_id: "LOT-003" }, 0);
    await call(boss, "award_best", { lot_id: "LOT-003" }, 0);
    await call(boss, "mark_no_show", { lot_id: "LOT-003" }, 0);
    console.log("[5] created LOT-003 cycle");
  } else {
    console.log("[5] LOT-003 exists, skip");
  }
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

