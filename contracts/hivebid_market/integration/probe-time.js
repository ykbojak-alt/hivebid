const { Worker, NEAR } = require('near-workspaces');

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    await root.transfer(manager.accountId, NEAR.parse('100 N'));
    const blk = await worker.provider.block({ finality: 'final' });
    const blockMs = Number(blk.header.timestamp) / 1e6;
    console.log('Date.now()      =', Date.now());
    console.log('block_timestamp  =', blockMs);
    console.log('offset (block - now) =', blockMs - Date.now());
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
