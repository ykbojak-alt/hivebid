const fs = require('fs');
const { Worker, NEAR } = require('near-workspaces');
const WASM = process.env.HIVEBID_WASM || process.argv[2];

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    const alice = await root.devCreateAccount('alice');
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});
    await alice.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
    const rec = await market.view('get_agent', { account: alice.accountId });
    console.log('typeof stake =', typeof rec.stake);
    console.log('stake =', rec.stake);
    console.log('stake.toString() =', rec.stake && rec.stake.toString());
    console.log('JSON =', JSON.stringify(rec));
    for (const k of Object.keys(rec)) {
      console.log('field', k, '=>', typeof rec[k], rec[k]);
    }
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
