// Read raw agent_bonds (LookupMap prefix b"r") and agents stake after award
// to get the exact frozen-bond value. Borsh: AccountId is a String -> u32 LE
// length + utf8 bytes. LookupMap key = prefix ++ borsh(key).
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');

function borshString(s) {
  const buf = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  return Buffer.concat([len, buf]);
}
function borshU128(hex) {
  return BigInt('0x' + hex);
}
function keyFor(prefix, account) {
  return Buffer.concat([Buffer.from([prefix.charCodeAt(0)]), borshString(account)]);
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
    const bidArgs = `{"lot_id":"${lotId}","price":${NEAR.parse('30 N').toString()},"eta_ms":15000,"signature":"soak-sig"}`;
    await winner.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs), {});
    await waitPast(worker, d.bid, 'bid');
    await manager.call(market, 'close_bidding', { lot_id: lotId });
    await manager.call(market, 'award_best', { lot_id: lotId });

    const rec = await market.view('get_agent', { account: winner.accountId });
    console.log('[st] get_agent stake=' + rec.stake);

    // read raw agent_bonds state (prefix 'r')
    let st = null;
    try {
      st = await worker.provider.query({
        request_type: 'view_state',
        account_id: market.accountId,
        prefix_base64: Buffer.from('r').toString('base64'),
        finality: 'optimistic',
      });
    } catch (e) {
      console.log('[st] view_state query err: ' + String(e.message || e).slice(0, 200));
    }
    if (st && st.values) {
      console.log('[st] agent_bonds raw values (' + st.values.length + '):');
      for (const v of st.values) {
        const k = Buffer.from(v.key, 'base64');
        const val = Buffer.from(v.value, 'base64');
        // last 16 bytes = u128 LE
        const u128 = BigInt('0x' + Buffer.from(val).reverse().toString('hex'));
        console.log('[st]   key=' + k.toString('hex') + ' value(u128 LE)=' + u128);
      }
    }

    // also read lot_bonds (prefix 'b')
    try {
      const st2 = await worker.provider.query({
        request_type: 'view_state',
        account_id: market.accountId,
        prefix_base64: Buffer.from('b').toString('base64'),
        finality: 'optimistic',
      });
      if (st2 && st2.values) {
        for (const v of st2.values) {
          const val = Buffer.from(v.value, 'base64');
          const u128 = BigInt('0x' + Buffer.from(val).reverse().toString('hex'));
          console.log('[st] lot_bonds value(u128 LE)=' + u128);
        }
      }
    } catch (e) { console.log('[st] lot_bonds query err: ' + String(e.message || e).slice(0, 120)); }
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
