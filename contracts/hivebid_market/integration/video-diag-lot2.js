const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = "http://127.0.0.1:31915";
const KEY_FILE = "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "/root/nexus/contracts/hivebid_market/integration/video-keys.json";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAS = 30000000000000;

const RAWJSON = (obj, bigNums) => {
  let s = JSON.stringify(obj);
  for (const [key, raw] of Object.entries(bigNums || {})) {
    s = s.replace(`"${key}":${JSON.stringify(raw)}`, `"${key}":${raw}`);
  }
  return Buffer.from(s);
};

async function main() {
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8"));
  for (const [k, v] of Object.entries(keysDb)) await keyStore.setKey("sandbox", k, KeyPair.fromString(v));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });
  const contractId = "hivebid3.test.near";
  const account = (name) => new Account(near.connection, name + ".test.near");

  const view = async (method, args) => {
    const res = await near.connection.provider.query({
      request_type: "call_function", finality: "final",
      account_id: contractId, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
    });
    return res.result && res.result.length ? JSON.parse(Buffer.from(res.result).toString("utf8")) : null;
  };

  const step = async (tag, fn) => {
    try {
      await fn();
      console.log("OK  ", tag);
    } catch (e) {
      console.log("FAIL", tag, "->", String(e).slice(0, 300));
      process.exit(1);
    }
  };

  const boss = account("boss");
  const bravo = account("bravo");
  const now = Date.now();

  // Проверка текущего состояния
  const lotIds = await view("get_lot_ids");
  console.log("lots now:", JSON.stringify(lotIds));
  for (const id of lotIds || []) {
    const lot = await view("get_lot", { lot_id: id });
    console.log(id, "status:", lot && lot.status, "bids:", lot && lot.bids ? lot.bids.length : 0, "winner:", lot && lot.winner);
  }

  if (!lotIds.includes("LOT-002")) {
    await step("create_task LOT-002", () =>
      boss.signAndSendTransaction({ receiverId: contractId, actions: [
        transactions.functionCall("create_task", RAWJSON({
          lot_id: "LOT-002", task_hash: "T:" + "2".padStart(64, "0"),
          bid_deadline_ms: now + 3000, work_deadline_ms: now + 60000, verify_deadline_ms: now + 120000,
        }), GAS, utils.format.parseNearAmount("8")),
      ]}));
    await sleep(4000);
  }

  await step("submit_bid LOT-002 bravo", () =>
    bravo.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.functionCall("submit_bid", RAWJSON({
        lot_id: "LOT-002", price: "7000000000000000000000000", eta_ms: 60000, signature: "sig-b2",
      }, { price: "7000000000000000000000000" }), GAS, "0"),
    ]}));

  await step("close_bidding LOT-002", () =>
    boss.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.functionCall("close_bidding", RAWJSON({ lot_id: "LOT-002" }), GAS, "0"),
    ]}));

  await step("award_best LOT-002", () =>
    boss.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.functionCall("award_best", RAWJSON({ lot_id: "LOT-002" }), GAS, "0"),
    ]}));

  await step("submit_work LOT-002 bravo", () =>
    bravo.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.functionCall("submit_work", RAWJSON({ lot_id: "LOT-002", work_hash: "W:deadbeef" }), GAS, "0"),
    ]}));

  await step("accept_work LOT-002", () =>
    boss.signAndSendTransaction({ receiverId: contractId, actions: [
      transactions.functionCall("accept_work", RAWJSON({ lot_id: "LOT-002" }), GAS, "0"),
    ]}));

  const lot2 = await view("get_lot", { lot_id: "LOT-002" });
  console.log("LOT-002 final status:", lot2 && lot2.status);
  console.log("DONE");
}

main().catch(e => { console.error("ERR:", String(e).slice(0, 2500)); process.exit(1); });

