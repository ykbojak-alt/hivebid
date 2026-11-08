const { Worker } = require("near-workspaces");
(async () => {
  const w = await Worker.init({ rm: true });
  try {
    const s = await w.provider.sendJsonRpc("status", []);
    console.log("sandbox protocol_version =", s.protocol_version, " version =", s.version?.version);
    const pc = await w.provider.experimental_protocolConfig ? await w.provider.experimental_protocolConfig() : null;
    if (pc) console.log("reftypes_bulk_memory =", JSON.stringify(pc).includes("reftypes_bulk_memory"));
  } finally { await w.tearDown(); }
  process.exit(0);
})();
