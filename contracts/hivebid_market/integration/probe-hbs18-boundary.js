// Fresh-winner-per-attempt boundary test on the FINAL pinned wasm.
// Answers: on a PRISTINE stake after award, what is the actual withdrawable
// ceiling? If frozen bond = 50% of stake, then withdraw(stake/2) must succeed
// and withdraw(stake/2 + 1) must revert. Uses a fresh winner per attempt so no
// prior withdraw perturbs the state.
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');

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

async function runOne(worker, amt, label) {
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
  const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"soak-sig"}`;
  await winner.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
  await waitPast(worker, d.bid, 'bid');
  await manager.call(market, 'close_bidding', { lot_id: lotId });
  await manager.call(market, 'award_best', { lot_id: lotId });

  const rec = await market.view('get_agent', { account: winner.accountId });
  const stake = BigInt(rec.stake);
  try {
    await winner.call(market, 'withdraw_stake', { amount: amt.toString() });
    console.log('[bd] ' + label + ': withdraw(' + amt + ') SUCCEEDED (stake=' + stake + ')');
  } catch (e) {
    console.log('[bd] ' + label + ': withdraw(' + amt + ') REVERTED (stake=' + stake + ')');
  }
  await market.view('get_agent', { account: winner.accountId }).then(r2 => {
    console.log('[bd] ' + label + ': stake-after=' + r2.stake);
  }).catch(() => {});
}

async function main() {
  // capture dust-affected stakeA from one scenario
  const workerProbe = await Worker.init({ rm: true });
  const root = workerProbe.rootAccount;
  const manager = await root.devCreateAccount('manager');
  await root.transfer(manager.accountId, NEAR.parse('20000 N'));
  const market = await root.createSubAccount('market');
  await market.deploy(fs.readFileSync(WASM));
  await market.call(market, 'new', { owner_id: manager.accountId }, {});
  const winner = await root.devCreateAccount('hbs18w');
  await winner.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
  const lotId = 'soak-HBS18-drain';
  const cnow = await chainNowMs(workerProbe);
  const d = { bid: cnow + 8000, wd: cnow + 300000, vd: cnow + 600000 };
  await manager.call(market, 'create_task', {
    lot_id: lotId, task_hash: 'T:' + 'a'.repeat(64),
    bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
  }, { attachedDeposit: NEAR.parse('50 N') });
  const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"soak-sig"}`;
  await winner.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
  await waitPast(workerProbe, d.bid, 'bid');
  await manager.call(market, 'close_bidding', { lot_id: lotId });
  await manager.call(market, 'award_best', { lot_id: lotId });
  const rec = await market.view('get_agent', { account: winner.accountId });
  const stakeA = BigInt(rec.stake);
  const HALF = stakeA / 2n;
  await workerProbe.tearDown();
  console.log('[bd] stakeA=' + stakeA + ' HALF=' + HALF);

  // fresh worker per boundary test
  const tests = [
    ['4.9N', 4900000000000000000000000n],
    ['HALF-1', HALF - 1n],
    ['HALF', HALF],
    ['HALF+1', HALF + 1n],
  ];
  for (const [label, amt] of tests) {
    const w = await Worker.init({ rm: true });
    try { await runOne(w, amt, label); }
    finally { await w.tearDown(); }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
