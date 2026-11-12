const { connect, Account, KeyPair } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = "http://127.0.0.1:31915";
const KEY_FILE = "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "../integration/video-keys.json";

(async () => {
  const keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8"));
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  for (const [k, v] of Object.entries(keysDb)) await keyStore.setKey("sandbox", k, KeyPair.fromString(v));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });

  for (const id of ["test.near", "boss.test.near", "alpha.test.near", "bravo.test.near", "charlie.test.near", "hivebid3.test.near", "hivebid4.test.near"]) {
    try {
      const s = await new Account(near.connection, id).state();
      console.log(id, "| balance:", s.amount, "| locked:", s.locked, "| code_hash:", s.code_hash.slice(0, 12));
    } catch (e) { console.log(id, "err:", String(e).slice(0, 80)); }
  }

  for (const cid of ["hivebid3.test.near", "hivebid4.test.near"]) {
    console.log("---", cid, "---");
    const view = async (method, args) => {
      const res = await near.connection.provider.query({
        request_type: "call_function", finality: "final",
        account_id: cid, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
      });
      return res.result && res.result.length ? JSON.parse(Buffer.from(res.result).toString("utf8")) : null;
    };
    try {
      const ids = await view("get_lot_ids");
      console.log("lot_ids:", JSON.stringify(ids));
      for (const id of ids || []) {
        const lot = await view("get_lot", { lot_id: id });
        console.log(" ", id, "status:", lot && lot.status, "| bids:", lot && lot.bids ? lot.bids.length : 0, "| bidDL:", lot && lot.bid_deadline_ms, "| now:", Date.now());
      }
    } catch (e) { console.log("view err:", String(e).slice(0, 200)); }
  }
})().catch(e => { console.error("ERR:", String(e).slice(0, 1200)); process.exit(1); });

