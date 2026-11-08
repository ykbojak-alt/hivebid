const { connect, Account, KeyPair, transactions, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = "http://127.0.0.1:31915";
const KEY_FILE = "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "/root/nexus/contracts/hivebid_market/integration/video-keys.json";

(async () => {
  const keysDb = JSON.parse(fs.readFileSync(KEYS_DB, "utf8"));
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  for (const [k, v] of Object.entries(keysDb)) await keyStore.setKey("sandbox", k, KeyPair.fromString(v));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });
  const alpha = new Account(near.connection, "alpha.test.near");
  const res = await alpha.signAndSendTransaction({
    receiverId: "hivebid.test.near",
    actions: [transactions.functionCall("submit_bid", {
      lot_id: "LOT-001",
      price: utils.format.parseNearAmount("4"),
      eta_ms: 60000,
      signature: "sig-0",
    }, 30000000000000, "0")],
  });
  console.log("TX:", res.transaction_outcome.id);
  console.log("status:", JSON.stringify(res.status).slice(0, 2000));
  if (res.status && res.status.SuccessValue !== undefined) console.log("SuccessValue:", Buffer.from(res.status.SuccessValue, "base64").toString());
  for (const r of res.receipts_outcome || []) {
    if (r.outcome && r.outcome.status && r.outcome.status.Failure) {
      console.log("FAILURE:", JSON.stringify(r.outcome.status.Failure).slice(0, 2500));
    }
  }
})().catch(e => { console.error("ERR:", String(e).slice(0, 1500)); process.exit(1); });

