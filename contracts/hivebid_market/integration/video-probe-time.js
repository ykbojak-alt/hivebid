const { connect, Account, KeyPair } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = "http://127.0.0.1:31915";
const KEY_FILE = "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));

(async () => {
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });
  const provider = near.connection.provider;
  // блок + его timestamp
  const block = await provider.block({ finality: "final" });
  console.log("block height:", block.header.height, "| timestamp:", block.header.timestamp, "| now:", Date.now());
  const diff = Date.now() - block.header.timestamp / 1e6;
  console.log("host-block delta ms:", diff);
  // последний блок
  const last = await provider.block({ finality: "final" });
  console.log("last block height:", last.header.height, "ts:", last.header.timestamp, "delta ms:", Date.now() - last.header.timestamp / 1e6);
})().catch(e => { console.error("ERR:", String(e).slice(0, 1000)); process.exit(1); });

