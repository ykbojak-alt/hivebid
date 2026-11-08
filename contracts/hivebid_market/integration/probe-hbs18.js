// Standalone HB-S18 probe (delta-6 wasm regression, task #339).
// After award, min_stake should be locked on the winner (rec.reserved). Winner
// attempts withdraw_stake(full stake) BEFORE terminal → must revert, stake
// intact. Prints ground-truth stake/reserved pre & post so we can see whether
// the deployed wasm actually reserves.
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');

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

    const lotId = 'hbs18-probe';
    const now = Date.now();
    const d = { bid: now + 6000, wd: now + 20000, vd: now + 50000 };
    await manager.call(market, 'create_task', {
      lot_id: lotId, task_hash: 'T:' + 'b'.repeat(64),
      bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
    }, { attachedDeposit: NEAR.parse('50 N') });
    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"hbs18"}`;
    await alice.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    for (let i = 0; i < 300; i++) {
      const b = await worker.provider.block({ finality: 'optimistic' });
      const ts = Number(BigInt(b.header.timestamp_nanosec ?? b.header.timestamp) / 1000000n);
      if (ts > d.bid) break;
      await new Promise(r => setTimeout(r, 250));
    }
    await manager.call(market, 'close_bidding', { lot_id: lotId });
    await manager.call(market, 'award_best', { lot_id: lotId });

    const rec = await market.view('get_agent', { account: alice.accountId });
    console.log('[probe] post-award alice stake=' + rec.stake + ' reserved=' + rec.reserved);

    let wOk = false, wErr = '';
    try {
      await alice.call(market, 'withdraw_stake', { amount: NEAR.parse('10 N') });
      wOk = true;
    } catch (e) { wErr = String(e.message || e); }
    console.log('[probe] withdraw_stake(10N) succeeded=' + wOk + (wErr ? ' err=' + wErr.slice(0, 160) : ''));

    const rec2 = await market.view('get_agent', { account: alice.accountId });
    console.log('[probe] post-withdraw alice stake=' + rec2.stake + ' reserved=' + rec2.reserved);
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
