// Diagnostic: pinpoint soak HB-S18 divergence. Replicates soak init/registration,
// then prints agent stake after registration, bid count after bid, and lot status
// after close/award to see whether award commits + reserves.
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');
const AGENTS = ['alice', 'bob', 'carol', 'dave', 'eve'];

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});

    const agents = {};
    for (const n of AGENTS) {
      agents[n] = await root.devCreateAccount(n);
      await agents[n].call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
    }
    const winner = await root.devCreateAccount('hbs18w');
    await winner.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });

    let r0 = null;
    try { r0 = await market.view('get_agent', { account: winner.accountId }); }
    catch (e) { console.log('get_agent after reg ERROR: ' + e.message); }
    console.log('post-reg winner stake=' + (r0 && r0.stake) + ' reserved=' + (r0 && r0.reserved));

    const lotId = 'hbs18-ctx';
    const now = Date.now();
    const d = { bid: now + 6000, wd: now + 20000, vd: now + 50000 };
    await manager.call(market, 'create_task', {
      lot_id: lotId, task_hash: 'T:' + 'a'.repeat(64),
      bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
    }, { attachedDeposit: NEAR.parse('50 N') });

    let bidOk = true, bidErr = '';
    try {
      await winner.callRaw(market.accountId, 'submit_bid',
        Buffer.from(`{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"ctx"}`), {});
    } catch (e) { bidOk = false; bidErr = String(e.message || e).slice(0, 200); }
    const afterBid = await market.view('get_lot', { lot_id: lotId });
    console.log('bidOk=' + bidOk + (bidErr ? ' err=' + bidErr : '')
      + ' afterBid status=' + afterBid.status
      + ' bids=' + (afterBid.bids ? afterBid.bids.length : 'null'));

    for (let i = 0; i < 300; i++) {
      const b = await worker.provider.block({ finality: 'optimistic' });
      const ts = Number(BigInt(b.header.timestamp_nanosec ?? b.header.timestamp) / 1000000n);
      if (ts > d.bid) break;
      await new Promise(r => setTimeout(r, 250));
    }
    await manager.call(market, 'close_bidding', { lot_id: lotId });
    const afterClose = await market.view('get_lot', { lot_id: lotId });
    console.log('afterClose status=' + afterClose.status);

    let awardOk = true, awardErr = '';
    try { await manager.call(market, 'award_best', { lot_id: lotId }); }
    catch (e) { awardOk = false; awardErr = String(e.message || e).slice(0, 200); }
    const afterAward = await market.view('get_lot', { lot_id: lotId });
    console.log('awardOk=' + awardOk + (awardErr ? ' err=' + awardErr : '')
      + ' afterAward status=' + afterAward.status
      + ' winner=' + (afterAward.winner || null));

    const rec = await market.view('get_agent', { account: winner.accountId });
    console.log('winner post-award stake=' + rec.stake + ' reserved=' + rec.reserved);
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
