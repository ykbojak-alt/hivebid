const { connect, Account, KeyPair } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = "http://127.0.0.1:31915";
const KEY_FILE = "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const TXHASH = process.argv[2];

(async () => {
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });
  const provider = near.connection.provider;
  try {
    const tx = await provider.sendJsonRpc("tx", [TXHASH, "alpha.test.near"]);
    console.log("status:", JSON.stringify(tx.status).slice(0, 3000));
    for (const ro of tx.receipts_outcome || []) {
      console.log("--- receipt", ro.id.slice(0, 16), "---");
      console.log("logs:", JSON.stringify(ro.outcome.logs));
      if (ro.outcome.status && ro.outcome.status.Failure) {
        console.log("FAILURE:", JSON.stringify(ro.outcome.status.Failure).slice(0, 3000));
      }
    }
  } catch (e) {
    console.log("tx query err:", String(e).slice(0, 500));
    // попробуем receipt query
    try {
      const rec = await provider.sendJsonRpc("receipt", [TXHASH]);
      console.log("receipt:", JSON.stringify(rec).slice(0, 3000));
    } catch (e2) { console.log("receipt query err:", String(e2).slice(0, 500)); }
  }
})().catch(e => { console.error("ERR:", String(e).slice(0, 1000)); process.exit(1); });

