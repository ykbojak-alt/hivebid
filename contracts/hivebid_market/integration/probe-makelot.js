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
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});
    await alice.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });

    const lotId = 'ml', now = Date.now();
    const opts = { bidIn: 6000, wdIn: 8000, vdIn: 50000 };
    await manager.call(market, 'create_task', {
      lot_id: lotId, task_hash: 'T:' + 'b'.repeat(64),
      bid_deadline_ms: now + opts.bidIn, work_deadline_ms: now + opts.wdIn,
      verify_deadline_ms: now + opts.vdIn,
    }, { attachedDeposit: NEAR.parse('50 N') });
    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":${opts.wdIn},"signature":"edge-sig"}`;
    const t = await alice.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    console.log('submit.failed =', t.failed, 'status=', JSON.stringify(t.status).slice(0, 120));
    let lot = await market.view('get_lot', { lot_id: lotId });
    console.log('after submit: status=', lot.status, 'bids=', lot.bids.length, JSON.stringify(lot.bids).slice(0, 150));
    await sleep(opts.bidIn + 400);
    await manager.call(market, 'close_bidding', { lot_id: lotId }, {});
    lot = await market.view('get_lot', { lot_id: lotId });
    console.log('after close: status=', lot.status, 'bids=', lot.bids.length);
    try {
      const a = await manager.call(market, 'award_best', { lot_id: lotId }, {});
      console.log('award =>', a);
    } catch (e) {
      const s = String(e);
      const m = s.match(/"ExecutionError":"([^"]+)"/);
      console.log('award FAILED:', m ? m[1] : s.slice(0, 150));
    }
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
