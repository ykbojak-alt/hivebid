const fs = require('fs');
const { Worker, NEAR } = require('near-workspaces');
const WASM = process.env.HIVEBID_WASM || process.argv[2];

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    const alice = await root.devCreateAccount('alice');
    await root.transfer(manager.accountId, NEAR.parse('1000 N'));
    await root.transfer(alice.accountId, NEAR.parse('500 N'));
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});
    await alice.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });

    async function tryVariant(tag, priceArg) {
      const lotId = 'lot' + tag;
      const now = Date.now();
      await manager.call(market, 'create_task', {
        lot_id: lotId, task_hash: 'T:' + tag.repeat(64),
        bid_deadline_ms: now + 20000, work_deadline_ms: now + 120000,
        verify_deadline_ms: now + 240000,
      }, { attachedDeposit: NEAR.parse('100 N') });
      try {
        await alice.call(market, 'submit_bid', {
          lot_id: lotId, price: priceArg, eta_ms: 30000, signature: 'demo-sig',
        }, {});
        const lot = await market.view('get_lot', { lot_id: lotId });
        console.log(tag, 'OK, bids =', JSON.stringify(lot.bids).slice(0, 200));
      } catch (e) {
        console.log(tag, 'FAILED:', String(e).slice(0, 180));
      }
    }

    await tryVariant('A', Number(NEAR.parse('40 N').toString()));   // JS number -> 4e+25
    await tryVariant('B', '40000000000000000000000000');            // decimal string
    // C: raw JSON buffer with literal integer
    {
      const lotId = 'lotC';
      const now = Date.now();
      await manager.call(market, 'create_task', {
        lot_id: lotId, task_hash: 'T:' + 'C'.repeat(64),
        bid_deadline_ms: now + 20000, work_deadline_ms: now + 120000,
        verify_deadline_ms: now + 240000,
      }, { attachedDeposit: NEAR.parse('100 N') });
      const argsJson = `{"lot_id":"${lotId}","price":40000000000000000000000000,"eta_ms":30000,"signature":"demo-sig"}`;
      try {
        await alice.callRaw(market.accountId, 'submit_bid', Buffer.from(argsJson), {});
        const lot = await market.view('get_lot', { lot_id: lotId });
        console.log('C(rawbuffer) OK, bids =', JSON.stringify(lot.bids).slice(0, 200));
      } catch (e) {
        console.log('C(rawbuffer) FAILED:', String(e).slice(0, 180));
      }
    }
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
