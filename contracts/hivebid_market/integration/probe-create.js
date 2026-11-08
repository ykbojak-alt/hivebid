const { connect, Account, KeyPair, utils } = require("near-api-js");

(async () => {
  const keyStore = { setKey: async () => {}, getKey: async () => null, getAccounts: async () => [], removeKey: async () => {}, clear: async () => {} };
  const near = await connect({ networkId: "sandbox", nodeUrl: "http://127.0.0.1:3030", keyStore });
  const root = new Account(near.connection, "test.near");
  console.log("root connected");
  const kp = KeyPair.fromRandom("ed25519");
  console.log("kp type:", typeof kp, "public fn:", typeof kp.getPublicKey);
  const pk = kp.getPublicKey();
  console.log("pk:", pk ? (pk.toString ? pk.toString().slice(0, 30) : String(pk)) : "NULL");
  await root.createAccount("probe2.test.near", pk, utils.format.parseNearAmount("50"));
  console.log("created probe2");
})().catch(e => { console.error("ERR1:", String(e).slice(0, 800)); process.exit(1); });
