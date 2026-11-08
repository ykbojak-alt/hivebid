// M.E.R.C. #363 — репетиция деплоя на sandbox.
// Воспроизводит цикл deploy-testnet-nearcli.sh (init + smoke) на локальном
// sandbox-neard (protocol-88) с каноническим wasm d9e0b300 (463640B), ДО
// owner-гейта. НИЧЕГО не деплоится на testnet.
//
// init:  new {owner_id: MGR}  (owner = manager, как в скрипте)
// smoke: register_agent(AGT,10N) -> create_task(MGR,50N)
//        -> submit_bid(AGT,30N) -> close_bidding -> award_best
//        -> withdraw_stake(AGT,1N) [после award, free=5N] -> submit_work
//        -> accept_work -> view get_lot/get_agent.
//
// Run:
//   HIVEBID_WASM=/root/nexus/contracts/hivebid_market/wasm/hivebid_market.wasm \
//   NEAR_SANDBOX_BINARY_PATH=/root/sandbox-neard \
//   NEAR_SANDBOX_BIN_PATH=/root/sandbox-neard \
//   node deploy-rehearsal-363.js
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function chainNowMs(worker) {
  const b = await worker.provider.block({ finality: 'optimistic' });
  const ts = b.header.timestamp_nanosec ?? b.header.timestamp;
  return Number(BigInt(ts) / 1000000n);
}
async function waitPast(worker, deadlineMs, label) {
  for (let i = 0; i < 600; i++) {
    if ((await chainNowMs(worker)) > deadlineMs) return;
    await sleep(250);
  }
  throw new Error('ASSERT FAILED: chain never passed ' + label);
}

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const MGR = await root.devCreateAccount('manager');
    const AGT = await root.devCreateAccount('agent');
    await root.transfer(MGR.accountId, NEAR.parse('10000 N'));
    await root.transfer(AGT.accountId, NEAR.parse('3000 N'));
    const market = await root.createSubAccount('market');

    // --- deploy + init (как deploy-скрипт: new {owner_id: MGR}) ---
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: MGR.accountId }, {});
    console.log('deploy+new OK, owner_id =', MGR.accountId);

    // --- smoke: register ---
    await AGT.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
    console.log('register_agent OK (10N)');

    // --- smoke: create_task (MGR) ---
    const c = await chainNowMs(worker);
    const BID = c + 20000; // bid deadline +20s
    const WD = c + 120000; // work deadline +120s
    const VD = c + 240000; // verify deadline +240s
    const lot = 'demo-1';
    await MGR.call(market, 'create_task', {
      lot_id: lot, task_hash: 'T:' + 'a'.repeat(64),
      bid_deadline_ms: BID, work_deadline_ms: WD, verify_deadline_ms: VD,
    }, { attachedDeposit: NEAR.parse('50 N') });
    console.log('create_task OK lot=' + lot, ' budget=50N');

    // --- smoke: submit_bid (AGT) ---
    const bidArgs = `{"lot_id":"${lot}","price":${NEAR.parse('30 N').toString()},"eta_ms":${WD},"signature":"demo"}`;
    await AGT.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    console.log('submit_bid OK price=30N');

    await waitPast(worker, BID, 'bid-deadline');
    await MGR.call(market, 'close_bidding', { lot_id: lot });
    console.log('close_bidding OK');

    await MGR.call(market, 'award_best', { lot_id: lot });
    console.log('award_best OK');

    // --- smoke: withdraw_stake (AGT) free=5N после award (bond=5N) ---
    await AGT.call(market, 'withdraw_stake', { amount: NEAR.parse('1 N') });
    console.log('withdraw_stake OK (1N of free 5N)');

    // --- smoke: submit_work -> accept_work ---
    await AGT.call(market, 'submit_work', { lot_id: lot, work_hash: 'W:demo' });
    console.log('submit_work OK');
    await MGR.call(market, 'accept_work', { lot_id: lot });
    console.log('accept_work OK');

    // --- view ---
    const l = await market.view('get_lot', { lot_id: lot });
    const a = await market.view('get_agent', { account: AGT.accountId });
    console.log('get_lot status=' + l.status, ' winner=' + l.winner, ' escrow_check n/a');
    console.log('get_agent stake=' + a.stake, ' rating=' + a.rating);
    if (l.status !== 'Completed') throw new Error('lot not Completed: ' + l.status);
    console.log('REHEARSAL-DEPLOY-363: PASS');
    process.exit(0);
  } finally {
    await worker.tearDown();
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
