const { Worker } = require('near-workspaces');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function blockMs(worker) {
  const blk = await worker.provider.block({ finality: 'final' });
  return Number(blk.header.timestamp) / 1e6;
}

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    await worker.rootAccount.devCreateAccount('warmup');
    const b1 = await blockMs(worker);
    const r1 = Date.now();
    await sleep(3000);
    const b2 = await blockMs(worker);
    const r2 = Date.now();
    console.log('block delta =', (b2 - b1).toFixed(0), 'ms over real', (r2 - r1).toFixed(0), 'ms');
    console.log('block rate ratio =', ((b2 - b1) / (r2 - r1)).toFixed(2));
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
