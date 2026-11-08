// Ground-truth probe: replicates the FULL soak main() pre-state (transfers,
// registrations, order) then runs HB-S18 with generous + short deadlines,
// printing chainNow at each step and capturing exact close/award errors.
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');
const AGENTS = ['alice', 'bob', 'carol', 'dave', 'eve'];

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
  throw new Error('waitPast never passed ' + label);
}

async function runScenario(label, d) {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    const stranger = await root.devCreateAccount('stranger');
    await root.transfer(manager.accountId, NEAR.parse('20000 N'));
    await root.transfer(stranger.accountId, NEAR.parse('500 N'));
    const agents = {};
    for (const n of AGENTS) {
      agents[n] = await root.devCreateAccount(n);
      await root.transfer(agents[n].accountId, NEAR.parse('3000 N'));
    }
    const market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: manager.accountId }, {});

    for (const n of AGENTS) {
      await agents[n].call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
    }
    await stranger.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });

    const winner = await root.devCreateAccount('hbs18w');
    await winner.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });

    const lotId = 'soak-HBS18-drain';
    const now = Date.now();

    try {
      await manager.call(market, 'create_task', {
        lot_id: lotId, task_hash: 'T:' + 'a'.repeat(64),
        bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
      }, { attachedDeposit: NEAR.parse('50 N') });
      console.log(`[${label}] create_task OK (chainNow=${await chainNowMs(worker)} deadline.bid=${d.bid})`);
    } catch (e) { console.log(`[${label}] create_task FAILED: ${extractErr(e)}`); return; }

    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"soak-sig"}`;
    try {
      await winner.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
      console.log(`[${label}] submit_bid OK`);
    } catch (e) { console.log(`[${label}] submit_bid FAILED: ${extractErr(e)}`); return; }

    try {
      const lot = await market.view('get_lot', { lot_id: lotId });
      console.log(`[${label}] lot after bid: status=${lot.status} bids=${lot.bids ? lot.bids.length : 'null'} bid_deadline_ms=${lot.bid_deadline_ms} (chainNow=${await chainNowMs(worker)})`);
    } catch (e) { console.log(`[${label}] get_lot err: ${String(e.message || e).slice(0, 120)}`); }

    await waitPast(worker, d.bid, 'bid');
    console.log(`[${label}] after waitPast: chainNow=${await chainNowMs(worker)} (bid deadline=${d.bid})`);

    try {
      await manager.call(market, 'close_bidding', { lot_id: lotId });
      console.log(`[${label}] close_bidding OK`);
    } catch (e) { console.log(`[${label}] close_bidding FAILED: ${extractErr(e)}`); return; }

    try {
      const lot = await market.view('get_lot', { lot_id: lotId });
      console.log(`[${label}] lot after close: status=${lot.status} chainNow=${await chainNowMs(worker)}`);
    } catch (e) { console.log(`[${label}] get_lot err: ${String(e.message || e).slice(0, 120)}`); }

    try {
      const w = await manager.call(market, 'award_best', { lot_id: lotId });
      console.log(`[${label}] award_best OK`);
    } catch (e) { console.log(`[${label}] award_best FAILED: ${extractErr(e)}`); }
  } finally {
    await worker.tearDown();
  }
}

function extractErr(e) {
  try {
    const r = e && e.result;
    const o = r && r.receipts_outcome && r.receipts_outcome[0];
    const st = o && o.outcome && o.outcome.status;
    if (st && st.Failure) {
      const ae = st.Failure.ActionError;
      const kind = ae && ae.kind && (ae.kind.FunctionCallError || ae.kind);
      if (kind && kind.ExecutionError) return kind.ExecutionError;
      return JSON.stringify(st.Failure).slice(0, 220);
    }
  } catch (ier) { /* ignore */ }
  return String(e && e.message || e).slice(0, 220);
}

async function main() {
  const workerProbe = await Worker.init({ rm: true });
  const chain0 = await chainNowMs(workerProbe);
  await workerProbe.tearDown();
  console.log(`[skew] Date.now()=${Date.now()} chainNow=${chain0} diff(chain-now)=${chain0 - Date.now()}`);

  // chain-relative deadlines (robust against skew)
  const c1 = await (async () => { const w = await Worker.init({ rm: true }); const c = await chainNowMs(w); await w.tearDown(); return c; })();
  await runScenario('chainrel', { bid: c1 + 8000, wd: c1 + 300000, vd: c1 + 600000 });

  // Date-based generous (to show skew still breaks it)
  const now = Date.now();
  await runScenario('dategenerous', { bid: now + 30000, wd: now + 300000, vd: now + 600000 });
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
