const fs = require('fs');
const { Worker, NEAR } = require('near-workspaces');
const WASM = process.env.HIVEBID_WASM || process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

    const lotId = 'sel-1', now = Date.now();
    await manager.call(market, 'create_task', {
      lot_id: lotId, task_hash: 'T:' + 'a'.repeat(64),
      bid_deadline_ms: now + 2000, work_deadline_ms: now + 60000,
      verify_deadline_ms: now + 120000,
    }, { attachedDeposit: NEAR.parse('100 N') });
    const blkAfterCreate = await worker.provider.block({ finality: 'final' });
    console.log('after create: blockMs=', Number(blkAfterCreate.header.timestamp) / 1e6, 'Date.now=', Date.now(), 'deadline=', now + 2000);
    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('40 N').toString()},"eta_ms":30000,"signature":"demo-sig"}`;
    const t = await alice.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    console.log('submit tx failed =', t.failed);
    console.log('submit tx status =', JSON.stringify(t.status).slice(0, 400));
    let lot = await market.view('get_lot', { lot_id: lotId });
    console.log('after submit: status=', lot.status, 'bids=', lot.bids.length);
    await sleep(2500);
    await manager.call(market, 'close_bidding', { lot_id: lotId }, {});
    lot = await market.view('get_lot', { lot_id: lotId });
    console.log('after close: status=', lot.status, 'bids=', lot.bids.length);
    const w = await market.view('select_winner', { lot_id: lotId });
    console.log('select_winner =>', JSON.stringify(w));
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
