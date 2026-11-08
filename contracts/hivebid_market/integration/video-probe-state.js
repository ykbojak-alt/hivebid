const { connect, Account, KeyPair, utils } = require("near-api-js");
const { InMemorySigner } = require("@near-js/signers");
const { InMemoryKeyStore } = require("@near-js/keystores");
const fs = require("fs");

const RPC = process.env.VIDEO_RPC || "http://127.0.0.1:31915";
const KEY_FILE = process.env.VIDEO_KEY_FILE || "/tmp/sandbox/2ff4ce10-2539-44d0-822e-b62be2748772/validator_key.json";
const ROOT_KEY = JSON.parse(fs.readFileSync(KEY_FILE));
const KEYS_DB = "/root/nexus/contracts/hivebid_market/integration/video-keys.json";

(async () => {
  const keyStore = new InMemoryKeyStore();
  await keyStore.setKey("sandbox", "test.near", KeyPair.fromString(ROOT_KEY.secret_key));
  const near = await connect({ networkId: "sandbox", nodeUrl: RPC, keyStore, signer: new InMemorySigner(keyStore) });
  const contractId = "hivebid.test.near";
  const view = async (method, args) => {
    const res = await near.connection.provider.query({
      request_type: "call_function", finality: "final",
      account_id: contractId, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
    });
    return res.result && res.result.length ? JSON.parse(Buffer.from(res.result).toString("utf8")) : null;
  };
  const lotIds = await view("get_lot_ids");
  console.log("lot_ids:", JSON.stringify(lotIds));
  for (const id of lotIds || []) {
    const lot = await view("get_lot", { lot_id: id });
    console.log(id, "status:", lot && lot.status, "| bids:", lot && lot.bids ? lot.bids.length : 0,
      "| winner:", lot && lot.winner, "| budget:", lot && lot.budget,
      "| bidDL:", lot && lot.bid_deadline_ms, "| now:", Date.now());
    if (lot && lot.bids) for (const b of lot.bids) console.log("   bid", b.agent, b.price, "eta", b.eta_ms);
  }
  for (const name of ["boss", "alpha", "bravo", "charlie"]) {
    try {
      const rec = await view("get_agent", { account: name + ".test.near" });
      console.log("agent", name, rec ? JSON.stringify({ stake: String(rec.stake), rating: rec.rating, n: rec.n }) : "(not registered)");
    } catch (e) { console.log("agent", name, "err", String(e).slice(0, 100)); }
  }
})().catch(e => { console.error("ERR:", String(e).slice(0, 1500)); process.exit(1); });

