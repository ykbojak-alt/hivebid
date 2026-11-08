// Isolated HB-S18 free-part withdraw probe on the FINAL pinned wasm.
// Purpose: determine whether withdraw_stake(amount == stake − bonded) succeeds
// or traps with `unreachable` in isolation (ground truth vs the soak failure).
// Also probes the boundary amount+1 to see if it reverts cleanly.
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');

function findExec(raw) {
  const r = (raw && typeof raw === 'object') ? raw : null;
  if (!r) return null;
  for (const o of (r.receipts_outcome || [])) {
    const st = o && o.outcome && o.outcome.status;
    if (st && st.Failure && st.Failure.ActionError) {
      const kind = st.Failure.ActionError.kind;
      const ex = kind && (kind.FunctionCallError || kind);
      if (ex && ex.ExecutionError) return ex.ExecutionError;
    }
  }
  const st2 = r.status && r.status.Failure;
  if (st2 && st2.ActionError) {
    const kind = st2.ActionError.kind;
    const ex = kind && (kind.FunctionCallError || kind);
    if (ex && ex.ExecutionError) return ex.ExecutionError;
  }
  if (st2) return JSON.stringify(st2).slice(0, 260);
  return null;
}
function extractErr(e) {
  const s = String(e && e.message || e);
  const m = s.match(/"ExecutionError":"((?:[^"\\]|\\.)*)"/);
  if (m) return m[1].replace(/\\u003[bB]/g, "'");
  try {
    let raw = e && e.result;
    if (!raw) { try { raw = JSON.parse(s); } catch (p2) { /* not json */ } }
    const found = findExec(raw);
    if (found) return found;
  } catch (ier) { /* ignore */ }
  return s.slice(0, 260);
}

async function chainNowMs(worker) {
  const b = await worker.provider.block({ finality: 'optimistic' });
  const ts = b.header.timestamp_nanosec ?? b.header.timestamp;
  return Number(BigInt(ts) / 1000000n);
}
async function waitPast(worker, deadlineMs, label) {
  for (let i = 0; i < 300; i++) {
    if ((await chainNowMs(worker)) > deadlineMs) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('chain never passed ' + label);
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

    const lotId = 'soak-HBS18-drain';
    const cnow = await chainNowMs(worker);
    const d = { bid: cnow + 8000, wd: cnow + 300000, vd: cnow + 600000 };

    await manager.call(market, 'create_task', {
      lot_id: lotId, task_hash: 'T:' + 'a'.repeat(64),
      bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
    }, { attachedDeposit: NEAR.parse('50 N') });
    console.log('[fp] create_task OK');

    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"soak-sig"}`;
    await winner.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    console.log('[fp] submit_bid OK');

    await waitPast(worker, d.bid, 'bid');
    await manager.call(market, 'close_bidding', { lot_id: lotId });
    console.log('[fp] close_bidding OK');
    await manager.call(market, 'award_best', { lot_id: lotId });
    console.log('[fp] award_best OK');

    const rec = await market.view('get_agent', { account: winner.accountId });
    const stakeA = BigInt(rec.stake);
    const BOND = stakeA * 5000n / 10000n;
    const FREE = stakeA - BOND;
    console.log('[fp] stakeA=' + stakeA + ' BOND=' + BOND + ' FREE=' + FREE);

    // full-drain attempt → expect clean revert
    try {
      await winner.call(market, 'withdraw_stake', { amount: NEAR.parse('10 N') });
      console.log('[fp] withdraw(10N) SUCCEEDED (unexpected)');
    } catch (e) { console.log('[fp] withdraw(10N) reverted: ' + extractErr(e)); }

    // free-part withdraw → the boundary case
    try {
      await winner.call(market, 'withdraw_stake', { amount: FREE.toString() });
      console.log('[fp] withdraw(FREE=' + FREE + ') SUCCEEDED');
    } catch (e) { console.log('[fp] withdraw(FREE) FAILED: ' + extractErr(e)); }

    const rec2 = await market.view('get_agent', { account: winner.accountId });
    console.log('[fp] post-free-withdraw stake=' + rec2.stake);

    // boundary + 1 → expect clean revert
    const after = await market.view('get_agent', { account: winner.accountId });
    const stakeC = BigInt(after.stake);
    const BONDC = stakeC * 5000n / 10000n;
    const FREEC = stakeC - BONDC;
    try {
      await winner.call(market, 'withdraw_stake', { amount: (FREEC + 1n).toString() });
      console.log('[fp] withdraw(FREE+1=' + (FREEC + 1n) + ') SUCCEEDED (unexpected)');
    } catch (e) { console.log('[fp] withdraw(FREE+1) reverted: ' + extractErr(e)); }
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
