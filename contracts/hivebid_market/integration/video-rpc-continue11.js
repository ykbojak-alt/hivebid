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

const TRACE_LOG = "/tmp/video-seed-debug.log";
const trace = (msg) => {
  try { fs.appendFileSync(TRACE_LOG, new Date().toISOString() + " " + msg + "\n"); } catch (e) {}
  console.log(msg);
};

const RAWJSON = (obj, bigNums) => {
  let s = JSON.stringify(obj);
  for (const [key, raw] of Object.entries(bigNums || {})) {
    s = s.replace(`"${key}":${JSON.stringify(raw)}`, `"${key}":${raw}`);
  }
  return Buffer.from(s);
};

async function main() {
  trace("[START] continue v11 (retry-tolerant, state-driven)");
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8"));
  for (const [k, v] of Object.entries(keysDb)) await keyStore.setKey("sandbox", k, KeyPair.fromString(v));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });

  const contractId = process.env.VIDEO_CONTRACT || "hivebid4.test.near";
  const contract = new Account(near.connection, contractId);
  const account = (name) => new Account(near.connection, name + ".test.near");
  const boss = account("boss");
  const bravo = account("bravo");
  const charlie = account("charlie");

  const chainNowMs = async () => {
    const b = await near.connection.provider.block({ finality: "optimistic" });
    const ts = b.header.timestamp_nanosec ?? b.header.timestamp;
    return Number(BigInt(ts) / 1000000n);
  };
  const waitPast = async (deadlineMs, label) => {
    for (let i = 0; i < 600; i++) {
      if ((await chainNowMs()) > deadlineMs) return;
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

  // callRawSoft: не кидает; логирует успех/ошибку. Состояние сверяется отдельно.
  const callRawSoft = async (acct, method, obj, deposit, bigNums) => {
    try {
      await acct.signAndSendTransaction({ receiverId: contractId, actions: [
        transactions.functionCall(method, RAWJSON(obj, bigNums), GAS, String(deposit || 0)),
      ]});
      trace("   [tx OK] " + method + " " + JSON.stringify(obj).slice(0, 100));
    } catch (e) {
      trace("   [tx FAIL] " + method + " " + JSON.stringify(obj).slice(0, 100) + " -> " + String(e).slice(0, 160));
    }
    await sleep(2000);
  };

  const getLot = async (id) => {
    try { return await view("get_lot", { lot_id: id }); } catch (e) { return null; }
  };

  // ---------- Лот: продвижение по фазам через сверку состояния ----------
  const advanceLot = async (lotId, opts) => {
    let lot = await getLot(lotId);
    if (!lot) return null;
    const label = opts.label || lotId;
    // фаза 1: Open → нужны bids
    if (lot.status === "Open" && (!lot.bids || lot.bids.length === 0)) {
      const agent = opts.bidder;
      const price = opts.price;
      if (lot.bid_deadline_ms <= (await chainNowMs())) {
        console.log(`[${label}] bid deadline passed with no bids — recreate as ${opts.recreateId}`);
        const now = await chainNowMs();
        await callRawSoft(boss, "create_task", {
          lot_id: opts.recreateId, task_hash: "T:" + opts.hashLetter.padStart(64, "0"),
          bid_deadline_ms: now + 30000, work_deadline_ms: now + 60000, verify_deadline_ms: now + 120000,
        }, utils.format.parseNearAmount(opts.budget));
        await sleep(1500);
        await callRawSoft(agent, "submit_bid", {
          lot_id: opts.recreateId, price, eta_ms: 30000, signature: "sig-re",
        }, 0, { price });
        return advanceLot(opts.recreateId, { ...opts, label: opts.recreateId, recreateId: opts.recreateId + "R", hashLetter: opts.hashLetter });
      }
      await callRawSoft(agent, "submit_bid", {
        lot_id: lotId, price, eta_ms: 30000, signature: opts.signature,
      }, 0, { price });
      lot = await getLot(lotId);
    }
    // фаза 2: ждать bid deadline → close
    if (lot.status === "Open") {
      console.log(`[${label}] waiting bid deadline...`);
      await waitPast(lot.bid_deadline_ms, label + " bid");
      await callRawSoft(boss, "close_bidding", { lot_id: lotId }, 0);
      lot = await getLot(lotId);
    }
    // фаза 3: BidsClosed → award
    if (lot.status === "BidsClosed") {
      await callRawSoft(boss, "award_best", { lot_id: lotId }, 0);
      lot = await getLot(lotId);
    }
    // фаза 4: Awarded → work / no_show
    if (lot.status === "Awarded") {
      if (opts.mode === "complete") {
        await callRawSoft(opts.bidder, "submit_work", { lot_id: lotId, work_hash: "W:deadbeef" }, 0);
        lot = await getLot(lotId);
        if (lot.status === "Submitted") {
          await callRawSoft(boss, "accept_work", { lot_id: lotId }, 0);
          lot = await getLot(lotId);
        }
      } else {
        console.log(`[${label}] waiting work deadline...`);
        await waitPast(lot.work_deadline_ms, label + " wd");
        await callRawSoft(boss, "mark_no_show", { lot_id: lotId }, 0);
        lot = await getLot(lotId);
      }
    }
    return lot;
  };

  // ---------- LOT-001: точно 3 bids (без продвижения) ----------
  let lot1 = await getLot("LOT-001");
  const bidders1 = (lot1.bids || []).map(b => b.agent);
  const prices = ["4000000000000000000000000", "3000000000000000000000000", "2000000000000000000000000"];
  const agents = [account("alpha"), bravo, charlie];
  for (let i = 0; i < 3; i++) {
    if (!bidders1.includes(agents[i].accountId)) {
      if (lot1.bid_deadline_ms <= (await chainNowMs())) {
        throw new Error("LOT-001 bid deadline passed before all bids placed");
      }
      await callRawSoft(agents[i], "submit_bid", {
        lot_id: "LOT-001", price: prices[i], eta_ms: 60000, signature: "sig-" + i,
      }, 0, { price: prices[i] });
    }
  }
  lot1 = await getLot("LOT-001");
  const len1 = (lot1.bids || []).length;
  console.log("[3] LOT-001 status:", lot1.status, "bids:", len1);
  if (len1 !== 3) throw new Error("LOT-001 bids != 3, got " + len1);

  // ---------- LOT-002 → Completed ----------
  const lot2 = await advanceLot("LOT-002", {
    label: "LOT-002", bidder: bravo, price: "7000000000000000000000000",
    signature: "sig-b2", budget: "8", hashLetter: "2", mode: "complete",
    recreateId: "LOT-002B",
  });
  console.log("[4] LOT-002 final status:", lot2.status);
  if (!lot2 || lot2.status !== "Completed") throw new Error("LOT-002 final=" + (lot2 && lot2.status));

  // ---------- LOT-003 → Failed ----------
  const lot3 = await advanceLot("LOT-003", {
    label: "LOT-003", bidder: charlie, price: "2000000000000000000000000",
    signature: "sig-c3", budget: "3", hashLetter: "3", mode: "no_show",
    recreateId: "LOT-003B",
  });
  console.log("[5] LOT-003 final status:", lot3.status);
  if (!lot3 || lot3.status !== "Failed") throw new Error("LOT-003 final=" + (lot3 && lot3.status));

  const escrow = await view("get_escrow");
  const treasury = await view("get_treasury");
  const burned = await view("get_burned");
  console.log(JSON.stringify({ contract: contractId, rpc: RPC, escrow: String(escrow), treasury: String(treasury), burned: String(burned), lots: [lot1.status, lot2.status, lot3.status] }, null, 2));
  console.log("SEED_OK");
}

main().catch(e => { trace("FATAL: " + String(e).slice(0, 2500) + "\n" + (e.stack || "").slice(0, 1500)); process.exit(1); });

