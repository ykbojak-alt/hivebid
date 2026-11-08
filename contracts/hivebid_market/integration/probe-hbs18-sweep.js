// Isolated HB-S18 withdraw-ceiling sweep on the FINAL pinned wasm.
// After award, try a sequence of withdraw amounts on a fresh winner to map the
// real withdrawable ceiling (and thus the real frozen bond). All panics surface
// as `unreachable` (panic=abort), so each attempt is classified by revert vs
// success. A fresh winner per attempt would be cleanest but is slow; here we
// do them in increasing order on one winner and track remaining stake.
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
    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"soak-sig"}`;
    await winner.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    await waitPast(worker, d.bid, 'bid');
    await manager.call(market, 'close_bidding', { lot_id: lotId });
    await manager.call(market, 'award_best', { lot_id: lotId });

    let rec = await market.view('get_agent', { account: winner.accountId });
    let stake = BigInt(rec.stake);
    const HALF = stake / 2n;
    console.log('[sw] stakeA=' + stake + ' HALF=' + HALF);

    const attempts = [
      1n,                         // 1 yocto
      1000000000000000000000000n, // 0.001 N
      HALF - 1n,
      HALF,
      HALF + 1n,
      stake,
    ];
    for (const amt of attempts) {
      try {
        await winner.call(market, 'withdraw_stake', { amount: amt.toString() });
        rec = await market.view('get_agent', { account: winner.accountId });
        const before = stake;
        stake = BigInt(rec.stake);
        console.log('[sw] withdraw(' + amt + ') SUCCEEDED (stake ' + before + ' -> ' + stake + ')');
      } catch (e) {
        console.log('[sw] withdraw(' + amt + ') REVERTED');
      }
    }
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
