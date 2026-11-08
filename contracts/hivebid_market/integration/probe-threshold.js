const fs = require('fs');
const { Worker, NEAR } = require('near-workspaces');
const WASM = process.env.HIVEBID_WASM || process.argv[2];

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    const alice = await root.devCreateAccount('alice');
    await root.transfer(manager.accountId, NEAR.parse('1000 N'));
    await root.transfer(alice.accountId, NEAR.parse('500 N'));
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});
    await alice.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });

    for (const win of [1000, 2000, 4000, 8000, 16000, 32000]) {
      const lotId = 'w' + win;
      const now = Date.now();
      try {
        await manager.call(market, 'create_task', {
          lot_id: lotId, task_hash: 'T:' + 'a'.repeat(64),
          bid_deadline_ms: now + win, work_deadline_ms: now + 120000,
          verify_deadline_ms: now + 240000,
        }, { attachedDeposit: NEAR.parse('100 N') });
        const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('40 N').toString()},"eta_ms":30000,"signature":"sig"}`;
        const t = await alice.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
        const lot = await market.view('get_lot', { lot_id: lotId });
        console.log('win', win, '=> submit.failed=', t.failed, 'bids=', lot.bids.length);
      } catch (e) {
        const s = String(e);
        const m = s.match(/"ExecutionError":"([^"]+)"/) || s.match(/"kind":([^}]+)/);
        console.log('win', win, '=> error', m ? m[0].slice(0, 160) : s.slice(0, 160));
      }
    }
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
