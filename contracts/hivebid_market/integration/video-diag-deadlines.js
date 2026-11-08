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
  const boss = account("boss");
  const bravo = account("bravo");

  const attempt = async (tag, fn) => {
    try {
      await fn();
      console.log("OK  ", tag);
      return true;
    } catch (e) {
      console.log("FAIL", tag, "->", String(e).slice(0, 200));
      return false;
    }
  };

  const now = Date.now();
  const variants = [
    { tag: "DL-600s", bidDL: now + 600000 },
    { tag: "DL-30s",  bidDL: now + 30000 },
    { tag: "DL-5s",   bidDL: now + 5000 },
    { tag: "DL-3s",   bidDL: now + 3000 },
  ];

  for (const v of variants) {
    const lotId = "PROBE-" + v.tag;
    const created = await attempt("create_task " + lotId, () =>
      boss.signAndSendTransaction({ receiverId: contractId, actions: [
        transactions.functionCall("create_task", RAWJSON({
          lot_id: lotId, task_hash: "T:" + "a".padStart(64, "0"),
          bid_deadline_ms: v.bidDL, work_deadline_ms: now + 3600000, verify_deadline_ms: now + 7200000,
        }), GAS, utils.format.parseNearAmount("5")),
      ]}));
    if (!created) continue;
    await sleep(800);
    await attempt("submit_bid " + lotId + " (literal)", () =>
      bravo.signAndSendTransaction({ receiverId: contractId, actions: [
        transactions.functionCall("submit_bid", RAWJSON({
          lot_id: lotId, price: "4000000000000000000000000", eta_ms: 60000, signature: "sig-lit",
        }, { price: "4000000000000000000000000" }), GAS, "0"),
      ]}));
    await sleep(800);
  }

  console.log("DONE");
}

main().catch(e => { console.error("ERR:", String(e).slice(0, 2500)); process.exit(1); });

