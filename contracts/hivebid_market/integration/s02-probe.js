// Standalone DELETED-RECIPIENT S02 probe (A.L.I.C.E. #333).
// Lot reaches Awarded; the winner/executor account is DELETED between award and
// accept_work. Check (a) does accept_work commit or revert, (b) differential
// conservation Δbalance == Δ(escrow+treasury+burned+Σstakes) — a gap > 0 means
// escrow was charged but the payout never reached the deleted recipient (funds
// stuck on the contract = S02 must-finding).
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');

async function heldOf(acc) {
  const b = await acc.balance();
  return BigInt(b.total.toString()) + BigInt(b.stateStaked.toString());
}
async function ledgerInt(worker, market, m) {
  const raw = await worker.provider.viewCallRaw(market.accountId, m,
    Buffer.from('{}').toString('base64'));
  return BigInt(Buffer.from(raw.result, 'base64').toString('utf8').trim());
}
async function snap(worker, market) {
  const [e, t, b, s] = await Promise.all([
    ledgerInt(worker, market, 'get_escrow'), ledgerInt(worker, market, 'get_treasury'),
    ledgerInt(worker, market, 'get_burned'), ledgerInt(worker, market, 'get_total_staked')]);
  return { bal: await heldOf(market), rhs: e + t + b + s, esc: e, tres: t, burned: b, staked: s };
}

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    const alice = await root.devCreateAccount('alice');
    const stranger = await root.devCreateAccount('stranger');
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});
    await alice.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
    await stranger.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });

    const lotId = 's02-del-1';
    const now = Date.now();
    const d = { bid: now + 6000, wd: now + 20000, vd: now + 50000 };
    await manager.call(market, 'create_task', {
      lot_id: lotId, task_hash: 'T:' + 'b'.repeat(64),
      bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
    }, { attachedDeposit: NEAR.parse('50 N') });
    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"s02"}`;
    await alice.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    // wait past bid deadline
    for (let i = 0; i < 300; i++) {
      const b = await worker.provider.block({ finality: 'optimistic' });
      const ts = Number(BigInt(b.header.timestamp_nanosec ?? b.header.timestamp) / 1000000n);
      if (ts > d.bid) break;
      await new Promise(r => setTimeout(r, 250));
    }
    await manager.call(market, 'close_bidding', { lot_id: lotId });
    await manager.call(market, 'award_best', { lot_id: lotId });

    const pre = await snap(worker, market);
    console.log('pre-delete: escrow=' + pre.esc + ' staked=' + pre.staked);

    // (1) delete the winner/executor account
    let delOk = false, delErr = '';
    try { await alice.delete(manager.accountId); delOk = true; }
    catch (e) { delErr = String(e.message || e); }
    console.log('[S02] delete executor alice ok=' + delOk + (delErr ? ' err=' + delErr : ''));

    // (2) attempt payout via accept_work to the deleted recipient
    let accOk = false, accErr = '';
    try { await manager.call(market, 'accept_work', { lot_id: lotId }); accOk = true; }
    catch (e) { accErr = String(e.message || e); }
    const post = await snap(worker, market);

    const dbal = post.bal - pre.bal;
    const drhs = post.rhs - pre.rhs;
    const stuck = dbal - drhs;

    let lot = null, lotErr = '';
    try { lot = await market.view('get_lot', { lot_id: lotId }); }
    catch (e) { lotErr = String(e.message || e); }

    console.log('[S02] accept_work committed=' + accOk + (accErr ? ' err=' + accErr : ''));
    console.log('[S02] lot view: ' + (lot ? JSON.stringify(lot) : ('NULL' + (lotErr ? ' (' + lotErr + ')' : ''))));
    console.log('[S02] differential conservation Δbalance=' + dbal.toString()
      + ' Δrhs=' + drhs.toString() + ' stuck(gap)=' + stuck.toString());
    if (stuck !== 0n) {
      console.log('[S02] *** INVARIANT VIOLATION magnitude=' + stuck.toString()
        + ' — MUST-FINDING: escrow deducted but payout never reached deleted'
        + ' recipient (funds stuck on contract balance, unaccounted).');
    } else {
      console.log('[S02] no balance/ledger imbalance; if views converge but payout'
        + ' cannot arrive, S02 is a documented protocol risk with a real case.');
    }
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
