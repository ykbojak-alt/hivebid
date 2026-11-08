const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');
const log = (...a) => console.error(...a);

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
async function readBond(worker, marketId) {
  const st = await worker.provider.query({
    request_type: 'view_state',
    account_id: marketId,
    prefix_base64: Buffer.from('r').toString('base64'),
    finality: 'optimistic',
  });
  for (const v of st.values) {
    const val = Buffer.from(v.value, 'base64');
    return BigInt('0x' + Buffer.from(val).reverse().toString('hex'));
  }
  return -1n;
}
async function exactStake(market, account) {
  const rec = await market.view('get_agent', { account });
  return BigInt(rec.stake);
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
    log('[ex] registered');

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
    log('[ex] awarded');

    const bond = await readBond(worker, market.accountId);
    log('[ex] agent_bonds(winner)=' + bond.toString());
    let stake = await exactStake(market, winner.accountId);
    log('[ex] exact stakeA=' + stake.toString());
    log('[ex] stake-bond(ceiling)=' + (stake - bond).toString());

    const attempts = [
      ['5N', 5000000000000000000000000n],
      ['stake-bond', (stake - bond)],
      ['stake-bond+1', (stake - bond) + 1n],
    ];
    for (const [label, amt] of attempts) {
      try {
        await winner.call(market, 'withdraw_stake', { amount: amt.toString() });
        stake = await exactStake(market, winner.accountId);
        log('[ex] withdraw(' + label + '=' + amt + ') SUCCEEDED; stake-now=' + stake.toString());
      } catch (e) {
        stake = await exactStake(market, winner.accountId);
        log('[ex] withdraw(' + label + '=' + amt + ') REVERTED; stake-now=' + stake.toString());
      }
    }
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
