const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = process.env.VIDEO_RPC || "http://127.0.0.1:31915";
const KEY_FILE = process.env.VIDEO_KEY_FILE || "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "/root/nexus/contracts/hivebid_market/integration/video-keys.json";
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
  console.log("[START] continue v10 (phase-aware, chain-time, hivebid4)");
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8"));
  for (const [k, v] of Object.entries(keysDb)) await keyStore.setKey("sandbox", k, KeyPair.fromString(v));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });
  const root = new Account(near.connection, "test.near");

  const mkAccount = async (name) => {
    const id = name + ".test.near";
    if (keysDb[id]) {
      await keyStore.setKey("sandbox", id, KeyPair.fromString(keysDb[id]));
    } else {
      const kp = KeyPair.fromRandom("ed25519");
      keysDb[id] = kp.toString();
      fs.writeFileSync(KEYS_DB, JSON.stringify(keysDb, null, 2));
      await keyStore.setKey("sandbox", id, kp);
      try { await root.createAccount(id, kp.getPublicKey(), utils.format.parseNearAmount("100")); }
      catch (e) { if (!String(e).includes("already exists")) throw e; }
    }
    return new Account(near.connection, id);
  };

  const contractId = process.env.VIDEO_CONTRACT || "hivebid4.test.near";
  const contract = new Account(near.connection, contractId);
  const account = (name) => new Account(near.connection, name + ".test.near");
  const boss = account("boss");
  const alpha = account("alpha");
  const bravo = account("bravo");
  const charlie = account("charlie");

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

  const getLot = async (id) => {
    try { return await view("get_lot", { lot_id: id }); } catch (e) { return null; }
  };

  // ---------- Проверка/деплой/init ----------
  let cs = null;
  try { cs = await contract.state(); } catch (e) {}
  if (!cs || cs.code_hash === "11111111111111111111111111111111") {
    console.log("[1] deploying...");
    await contract.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.deployContract(fs.readFileSync(process.env.VIDEO_WASM || "/root/nexus/contracts/hivebid_market/target/wasm32-unknown-unknown/release/hivebid_market.wasm")),
    ]});
    await sleep(1000);
    try { await view("get_agent_ids"); } catch (e) {
      await callRaw(boss, "new", { owner_id: boss.accountId }, 0);
      console.log("[1] deployed + init");
    }
  } else {
    console.log("[1] contract exists, skip deploy");
  }

  // ---------- Агенты ----------
  const stake = utils.format.parseNearAmount("10");
  let registered = [];
  try { registered = await view("get_agent_ids"); } catch (e) {}
  registered = Array.isArray(registered) ? registered : [];
  for (const a of [alpha, bravo, charlie]) {
    if (!registered.includes(a.accountId)) {
      await callRaw(a, "register_agent", {}, stake);
      console.log("[2] registered", a.accountId);
    } else {
      console.log("[2] agent already registered:", a.accountId);
    }
  }

  // ---------- LOT-001: гарантировать 3 bids ----------
  let lot1 = await getLot("LOT-001");
  if (!lot1) {
    const now = await chainNowMs();
    await callRaw(boss, "create_task", {
      lot_id: "LOT-001", task_hash: "T:" + "1".padStart(64, "0"),
      bid_deadline_ms: now + 3600000, work_deadline_ms: now + 7200000, verify_deadline_ms: now + 10800000,
    }, utils.format.parseNearAmount("5"));
    console.log("[3] created LOT-001");
    await sleep(1500);
    lot1 = await getLot("LOT-001");
  }
  const bidders1 = (lot1.bids || []).map(b => b.agent);
  const prices = ["4000000000000000000000000", "3000000000000000000000000", "2000000000000000000000000"];
  const agents = [alpha, bravo, charlie];
  for (let i = 0; i < 3; i++) {
    if (!bidders1.includes(agents[i].accountId)) {
      if (lot1.bid_deadline_ms <= Date.now()) {
        throw new Error("LOT-001 bid deadline passed before all bids placed");
      }
      await callRaw(agents[i], "submit_bid", {
        lot_id: "LOT-001", price: prices[i], eta_ms: 60000, signature: "sig-" + i,
      }, 0, { price: prices[i] });
      console.log("[3] bid from", agents[i].accountId, prices[i] / 1e24, "N");
    }
  }
  lot1 = await getLot("LOT-001");
  const len1 = (lot1.bids || []).length;
  console.log("[3] LOT-001 status:", lot1.status, "bids:", len1);
  if (len1 !== 3) throw new Error("LOT-001 bids != 3");

  // ---------- LOT-002: full cycle → Completed ----------
  let lot2 = await getLot("LOT-002");
  if (!lot2) {
    const now = await chainNowMs();
    await callRaw(boss, "create_task", {
      lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
      bid_deadline_ms: now + 30000, work_deadline_ms: now + 60000, verify_deadline_ms: now + 120000,
    }, utils.format.parseNearAmount("8"));
    console.log("[4] created LOT-002");
    await sleep(1500);
    lot2 = await getLot("LOT-002");
  }
  console.log("[4] LOT-002 state: status=", lot2.status, "bids=", (lot2.bids || []).length, "bidDL=", lot2.bid_deadline_ms, "chainNow=", await chainNowMs());

  if (lot2.status === "Open") {
    if (!lot2.bids || lot2.bids.length === 0) {
      // если deadline уже прошёл — лот не примет bid, придётся пересоздать
      if (lot2.bid_deadline_ms <= (await chainNowMs())) {
        console.log("[4] LOT-002 deadline passed with no bids — recreating as LOT-002B");
        const now = await chainNowMs();
        await callRaw(boss, "create_task", {
          lot_id: "LOT-002B", task_hash: "T:" + "2".padStart(64, "0"),
          bid_deadline_ms: now + 30000, work_deadline_ms: now + 60000, verify_deadline_ms: now + 120000,
        }, utils.format.parseNearAmount("8"));
        await callRaw(bravo, "submit_bid", {
          lot_id: "LOT-002B", price: "7000000000000000000000000", eta_ms: 30000, signature: "sig-b2",
        }, 0, { price: "7000000000000000000000000" });
        lot2 = await getLot("LOT-002B");
      } else {
        await callRaw(bravo, "submit_bid", {
          lot_id: "LOT-002", price: "7000000000000000000000000", eta_ms: 30000, signature: "sig-b2",
        }, 0, { price: "7000000000000000000000000" });
        lot2 = await getLot("LOT-002");
      }
    }
    console.log("[4] waiting bid deadline...");
    await waitPast(lot2.bid_deadline_ms, "LOT-002 bid");
    await callRaw(boss, "close_bidding", { lot_id: lot2.lot_id }, 0);
  }

  lot2 = await getLot(lot2.lot_id);
  if (lot2.status === "BidsClosed") {
    await callRaw(boss, "award_best", { lot_id: lot2.lot_id }, 0);
  }
  lot2 = await getLot(lot2.lot_id);
  if (lot2.status === "Awarded") {
    await callRaw(bravo, "submit_work", { lot_id: lot2.lot_id, work_hash: "W:deadbeef" }, 0);
  }
  lot2 = await getLot(lot2.lot_id);
  if (lot2.status === "Submitted") {
    await callRaw(boss, "accept_work", { lot_id: lot2.lot_id }, 0);
  }
  lot2 = await getLot(lot2.lot_id);
  console.log("[4] LOT-002 final status:", lot2.status);
  if (lot2.status !== "Completed") throw new Error("LOT-002 final=" + lot2.status);

  // ---------- LOT-003: NO_SHOW → Failed ----------
  let lot3 = await getLot("LOT-003");
  if (!lot3) {
    const now = await chainNowMs();
    await callRaw(boss, "create_task", {
      lot_id: "LOT-003", task_hash: "T:" + "3".padStart(64, "0"),
      bid_deadline_ms: now + 30000, work_deadline_ms: now + 60000, verify_deadline_ms: now + 120000,
    }, utils.format.parseNearAmount("3"));
    console.log("[5] created LOT-003");
    await sleep(1500);
    lot3 = await getLot("LOT-003");
  }
  console.log("[5] LOT-003 state: status=", lot3.status, "bids=", (lot3.bids || []).length, "bidDL=", lot3.bid_deadline_ms, "wd=", lot3.work_deadline_ms, "chainNow=", await chainNowMs());

  if (lot3.status === "Open") {
    if (!lot3.bids || lot3.bids.length === 0) {
      if (lot3.bid_deadline_ms <= (await chainNowMs())) {
        console.log("[5] LOT-003 deadline passed with no bids — recreating as LOT-003B");
        const now = await chainNowMs();
        await callRaw(boss, "create_task", {
          lot_id: "LOT-003B", task_hash: "T:" + "3".padStart(64, "0"),
          bid_deadline_ms: now + 30000, work_deadline_ms: now + 60000, verify_deadline_ms: now + 120000,
        }, utils.format.parseNearAmount("3"));
        await callRaw(charlie, "submit_bid", {
          lot_id: "LOT-003B", price: "2000000000000000000000000", eta_ms: 30000, signature: "sig-c3",
        }, 0, { price: "2000000000000000000000000" });
        lot3 = await getLot("LOT-003B");
      } else {
        await callRaw(charlie, "submit_bid", {
          lot_id: "LOT-003", price: "2000000000000000000000000", eta_ms: 30000, signature: "sig-c3",
        }, 0, { price: "2000000000000000000000000" });
        lot3 = await getLot("LOT-003");
      }
    }
    console.log("[5] waiting bid deadline...");
    await waitPast(lot3.bid_deadline_ms, "LOT-003 bid");
    await callRaw(boss, "close_bidding", { lot_id: lot3.lot_id }, 0);
  }

  lot3 = await getLot(lot3.lot_id);
  if (lot3.status === "BidsClosed") {
    await callRaw(boss, "award_best", { lot_id: lot3.lot_id }, 0);
  }
  lot3 = await getLot(lot3.lot_id);
  if (lot3.status === "Awarded") {
    console.log("[5] waiting work deadline...");
    await waitPast(lot3.work_deadline_ms, "LOT-003 wd");
    await callRaw(boss, "mark_no_show", { lot_id: lot3.lot_id }, 0);
  }
  lot3 = await getLot(lot3.lot_id);
  console.log("[5] LOT-003 final status:", lot3.status);
  if (lot3.status !== "Failed") throw new Error("LOT-003 final=" + lot3.status);

  const escrow = await view("get_escrow");
  const treasury = await view("get_treasury");
  const burned = await view("get_burned");
  console.log(JSON.stringify({ contract: contractId, rpc: RPC, escrow: String(escrow), treasury: String(treasury), burned: String(burned), lots: [lot1.status, lot2.status, lot3.status] }, null, 2));
  console.log("SEED_OK");
}

main().catch(e => { console.error(String(e).slice(0, 2500)); process.exit(1); });

