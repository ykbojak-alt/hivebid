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
    console.log('new() OK');

    // read-only access to agents map BEFORE any write
    try {
      const before = await market.view('get_agent', { account: alice.accountId });
      console.log('view get_agent BEFORE register =', JSON.stringify(before));
    } catch (e) {
      console.log('view get_agent BEFORE FAILED:', String(e).slice(0, 300));
    }

    // write path
    try {
      await alice.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
      console.log('register_agent OK');
      const after = await market.view('get_agent', { account: alice.accountId });
      console.log('view get_agent AFTER register =', JSON.stringify(after).slice(0, 400));
    } catch (e) {
      console.log('register_agent FAILED:', String(e).slice(0, 400));
    }
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
