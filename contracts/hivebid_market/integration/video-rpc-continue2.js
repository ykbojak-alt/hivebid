const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = process.env.VIDEO_RPC || "http://127.0.0.1:31915";
const KEY_FILE = process.env.VIDEO_KEY_FILE || "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const WASM = fs.readFileSync("../wasm/canonical-hivebid_market.wasm");
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "../integration/video-keys.json";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAS = 30000000000000;

process.on("unhandledRejection", e => { console.error("REJECT:", e && e.stack ? e.stack.slice(0, 2500) : e); process.exit(1); });

async function main() {
  console.log("[START] continue-mode v2");
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const signer = new InMemorySigner(keyStore);
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer });
  const root = new Account(near.connection, "test.near");

  // Персистентная база ключей
  let keysDb = {};
  try { keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8")); } catch (e) {}
  const saveKeys = () => fs.writeFileSync(KEYS_DB, JSON.stringify(keysDb, null, 2));

  const mkAccount = async (name) => {
    const id = name + ".test.near";
    if (keysDb[id]) {
      await keyStore.setKey("sandbox", id, KeyPair.fromString(keysDb[id]));
    } else {
      const kp = KeyPair.fromRandom("ed25519");
      keysDb[id] = kp.toString();
      saveKeys();
      await keyStore.setKey("sandbox", id, kp);
      try {
        await root.createAccount(id, kp.getPublicKey(), utils.format.parseNearAmount("100"));
      } catch (e) {
        // аккаунт уже существует, но ключ теперь у нас есть
        if (!String(e).includes("already exists")) throw e;
      }
    }
    return new Account(near.connection, id);
  };

  const contractId = "hivebid.test.near";
  const contract = new Account(near.connection, contractId);

  // raw view (provider.query) — self viewFunction
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

  // 1. Контракт: деплой/init если нужно
  let cs = null;
  try { cs = await contract.state(); } catch (e) { console.log("contract state err:", String(e).slice(0, 150)); }
  console.log("[0] contract exists:", !!cs);
  if (!cs || !cs.code_hash) {
    await contract.deployContract(WASM);
    await sleep(800);
    const m0 = await mkAccount("manager");
    await call(m0, "new", { owner_id: m0.accountId }, 0);
    console.log("[1] deployed + initialized with owner", m0.accountId);
  } else {
    console.log("[1] already deployed, skip");
  }

  // 2. Агенты
  const manager = await mkAccount("manager");
  const agents = [await mkAccount("agent-a"), await mkAccount("agent-b"), await mkAccount("agent-c")];
  console.log("[2] accounts ready:", [manager.accountId].concat(agents.map(a => a.accountId)).join(", "));

  let registered = [];
  try { registered = await view("get_agent_ids"); } catch (e) { console.log("get_agent_ids err:", String(e).slice(0, 150)); }
  registered = Array.isArray(registered) ? registered : [];
  const stake = utils.format.parseNearAmount("10");
  for (const a of agents) {
    if (registered.includes(a.accountId)) {
      console.log("[2] agent", a.accountId, "already registered");
    } else {
      await call(a, "register_agent", {}, stake);
      console.log("[2] registered", a.accountId);
    }
  }

  const now = Date.now();

  // 3. LOT-001: open + 3 bids
  let lotIds = await view("get_lot_ids");
  let lot1 = null;
  if (lotIds.includes("LOT-001")) lot1 = await view("get_lot", { lot_id: "LOT-001" });
  if (!lot1) {
    await call(manager, "create_task", {
      lot_id: "LOT-001", task_hash: "T:" + "1".padStart(64, "0"),
      bid_deadline_ms: now + 600000, work_deadline_ms: now + 3600000, verify_deadline_ms: now + 7200000,
    }, utils.format.parseNearAmount("5"));
    console.log("[3] created LOT-001");
  } else {
    console.log("[3] LOT-001 exists, status:", lot1.status);
  }

  const bidders = (lot1.bids || []).map(b => b.agent);
  const prices = ["4", "3", "2"];
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

  // 4. LOT-002: full cycle -> Completed
  lotIds = await view("get_lot_ids");
  if (!lotIds.includes("LOT-002")) {
    await call(manager, "create_task", {
      lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
      bid_deadline_ms: now + 600000, work_deadline_ms: now + 3600000, verify_deadline_ms: now + 7200000,
    }, utils.format.parseNearAmount("8"));
    await call(agents[1], "submit_bid", { lot_id: "LOT-002", price: utils.format.parseNearAmount("7"), eta_ms: 60000, signature: "sig-b2" }, 0);
    await call(manager, "close_bidding", { lot_id: "LOT-002" }, 0);
    await call(manager, "award_best", { lot_id: "LOT-002" }, 0);
    await call(agents[1], "submit_work", { lot_id: "LOT-002", work_hash: "W:deadbeef" }, 0);
    await call(manager, "accept_work", { lot_id: "LOT-002" }, 0);
    console.log("[4] created LOT-002 cycle");
  } else {
    console.log("[4] LOT-002 exists, skip");
  }
  const lot2 = await view("get_lot", { lot_id: "LOT-002" });
  if (lot2.status !== "Completed") throw new Error("LOT-002 status=" + lot2.status + ", expected Completed");
  console.log("[4] LOT-002 status:", lot2.status);

  // 5. LOT-003: NO_SHOW -> Failed
  lotIds = await view("get_lot_ids");
  if (!lotIds.includes("LOT-003")) {
    await call(manager, "create_task", {
      lot_id: "LOT-003", task_hash: "T:" + "3".padStart(64, "0"),
      bid_deadline_ms: now + 600000, work_deadline_ms: now - 5000, verify_deadline_ms: now + 3600000,
    }, utils.format.parseNearAmount("3"));
    await call(agents[2], "submit_bid", { lot_id: "LOT-003", price: utils.format.parseNearAmount("2"), eta_ms: 60000, signature: "sig-c3" }, 0);
    await call(manager, "close_bidding", { lot_id: "LOT-003" }, 0);
    await call(manager, "award_best", { lot_id: "LOT-003" }, 0);
    await call(manager, "mark_no_show", { lot_id: "LOT-003" }, 0);
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

