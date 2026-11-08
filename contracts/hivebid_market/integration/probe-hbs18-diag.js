// Standalone HB-S18 diagnostic probe (delta-7 wasm, task #339b).
// Replicates the soak's hbS18WithdrawCheck sequence but logs every step's
// success/failure and captures the exact award error, so we can tell whether
// the award commits (bond frozen) or reverts.
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');
const NOISE_TOL = 10000000000000000000000n; // 0.01 N

async function chainNowMs(worker) {
  const b = await worker.provider.block({ finality: 'optimistic' });
  const ts = b.header.timestamp_nanosec ?? b.header.timestamp;
  return Number(BigInt(ts) / 1000000n);
}
async function waitPast(worker, deadlineMs, label) {
  for (let i = 0; i < 300; i++) {
    if ((await chainNowMs(worker)) > deadlineMs) { console.log(`[diag] chain passed ${label}`); return; }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('ASSERT FAILED: chain never passed ' + label);
}
async function callLog(label, fn) {
  try { const r = await fn(); console.log(`[diag] ${label} OK`); return { ok: true, r }; }
  catch (e) { console.log(`[diag] ${label} FAILED: ${String(e.message || e).slice(0, 200)}`); return { ok: false, err: e }; }
}

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    await root.transfer(manager.accountId, NEAR.parse('20000 N'));
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});

    const winner = await root.devCreateAccount('hbs18w');
    await winner.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
    console.log('[diag] winner registered');

    const lotId = 'soak-HBS18-drain';
    const now = Date.now();
    const d = { bid: now + 6000, wd: now + 20000, vd: now + 50000 };

    let r = await callLog('create_task', () => manager.call(market, 'create_task', {
      lot_id: lotId, task_hash: 'T:' + 'a'.repeat(64),
      bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
    }, { attachedDeposit: NEAR.parse('50 N') }));

    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"soak-sig"}`;
    r = await callLog('submit_bid', () => winner.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {}));

    // count bids via view
    try {
      const sel = await market.view('select_winner', { lot_id: lotId });
      console.log('[diag] select_winner (pre-close) = ' + JSON.stringify(sel));
    } catch (e) { console.log('[diag] select_winner view err: ' + String(e.message || e).slice(0, 160)); }

    await waitPast(worker, d.bid, 'bid');
    r = await callLog('close_bidding', () => manager.call(market, 'close_bidding', { lot_id: lotId }));

    try {
      const sel = await market.view('select_winner', { lot_id: lotId });
      console.log('[diag] select_winner (post-close) = ' + JSON.stringify(sel));
    } catch (e) { console.log('[diag] select_winner view err: ' + String(e.message || e).slice(0, 160)); }

    r = await callLog('award_best', () => manager.call(market, 'award_best', { lot_id: lotId }));

    // post-award state
    const rec = await market.view('get_agent', { account: winner.accountId });
    const stakeA = BigInt(rec.stake);
    const gap = stakeA > 10000000000000000000000000n
      ? stakeA - 10000000000000000000000000n : 10000000000000000000000000n - stakeA;
    console.log('[diag] post-award winner stake=' + stakeA + ' gap(from 10N)=' + gap);
    try {
      const lot = await market.view('get_lot', { lot_id: lotId });
      console.log('[diag] lot status/winner = ' + JSON.stringify(lot).slice(0, 400));
    } catch (e) { console.log('[diag] get_lot view err (may not exist): ' + String(e.message || e).slice(0, 120)); }

    // full-drain attempt
    let wOk = false, wErr = '';
    try { await winner.call(market, 'withdraw_stake', { amount: NEAR.parse('10 N') }); wOk = true; }
    catch (e) { wErr = String(e.message || e); }
    console.log('[diag] withdraw_stake(10N) succeeded=' + wOk + (wErr ? ' err=' + wErr.slice(0, 160) : ''));
    const rec2 = await market.view('get_agent', { account: winner.accountId });
    console.log('[diag] post-withdraw winner stake=' + rec2.stake);
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
