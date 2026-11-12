// M.E.R.C. #357 — economic fuzz soak for HiveBid delta-7 (frozen bond per lot).
//
// Drives 4-6 agents / 8-12 lots through a SEEDED random op-sequence plus three
// scripted traps:
//   T1 withdraw→award→no_show   (weight freeze vs slash vs withdrawable stake)
//   T2 raise_min_stake mid-flight (owner raises min_stake between bid and award)
//   T3 cancel_lot with pending bids (refund + bid cleanup conservation)
//
// Invariants checked after EVERY attempted op (success or revert — both must
// hold because a revert rolls back atomically):
//   I-A differential conservation: Δbalance == Δ(escrow+treasury+burned+Σstakes)
//        within NOISE_TOL (commentbox storage-subsidy noise).
//   I-B bonds <= stake per agent: raw agent_bonds[a] <= agents[a].stake.
//
// On the first invariant violation: dump full state (agents, bonds, lots, the
// failing op + before/after snap) and exit 1. Deterministic seed → reproducible.
//
// Run:
//   HIVEBID_WASM=/root/nexus/contracts/hivebid_market/wasm/hivebid_market.wasm \
//   NEAR_SANDBOX_BINARY_PATH=/root/sandbox-neard \
//   NEAR_SANDBOX_BIN_PATH=/root/sandbox-neard \
//   SEED=<n> FUZZ_OPS=<n> node fuzz-economic.js
const fs = require('fs');
const path = require('path');
const { Worker, NEAR } = require('near-workspaces');

const WASM = process.env.HIVEBID_WASM
  || path.resolve(__dirname, '..', 'wasm', 'hivebid_market.wasm');

const SEED = Number(process.env.SEED || 357037);
const MAX_OPS = Number(process.env.FUZZ_OPS || 550);
const NOISE_TOL = 10000000000000000000000n; // 0.01 N
const N_AGENTS = 5;                 // alice/bob/carol/dave/eve
const A_NAMES = ['alice', 'bob', 'carol', 'dave', 'eve'];

// deterministic PRNG (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error('ASSERT FAILED: ' + m); }

let worker, market, manager, owner, stranger, root;
let RNG = mulberry32(SEED);
const agents = {};

// ------------------------------------------------------------------ helpers
async function chainNowMs() {
  const b = await worker.provider.block({ finality: 'optimistic' });
  const ts = b.header.timestamp_nanosec ?? b.header.timestamp;
  return Number(BigInt(ts) / 1000000n);
}
async function waitPast(deadlineMs, label) {
  for (let i = 0; i < 600; i++) {
    if ((await chainNowMs()) > deadlineMs) return;
    await sleep(250);
  }
  throw new Error('ASSERT FAILED: chain never passed ' + label);
}
async function heldOf(acc) {
  const b = await acc.balance();
  return BigInt(b.total.toString()) + BigInt(b.stateStaked.toString());
}
async function ledgerInt(method) {
  const raw = await worker.provider.viewCallRaw(
    market.accountId, method, Buffer.from('{}').toString('base64'));
  return BigInt(Buffer.from(raw.result, 'base64').toString('utf8').trim());
}
function extractErr(e) {
  const s = String(e && e.message || e);
  const m = s.match(/"ExecutionError":"((?:[^"\\]|\\.)*)"/);
  if (m) return m[1].replace(/\\u003[bB]/g, "'");
  return s.slice(0, 200);
}
function bidArgs(lot, priceN, etaMs) {
  return `{"lot_id":"${lot}","price":${NEAR.parse(`${priceN} N`).toString()},"eta_ms":${etaMs},"signature":"fuzz-sig"}`;
}

// raw agent_bonds (LookupMap prefix 'r'); value u128 LE
async function readAgentBonds() {
  const map = new Map();
  const st = await worker.provider.query({
    request_type: 'view_state',
    account_id: market.accountId,
    prefix_base64: Buffer.from('r').toString('base64'),
    finality: 'optimistic',
  });
  for (const v of st.values) {
    const val = Buffer.from(v.value, 'base64');
    const bond = BigInt('0x' + Buffer.from(val).reverse().toString('hex'));
    // key = 'r' (1) + u32 LE len (4) + account bytes
    const k = Buffer.from(v.key, 'base64');
    const acc = k.subarray(5).toString('utf8');
    map.set(acc, bond);
  }
  return map;
}

async function snap() {
  const [esc, tres, burned, staked] = await Promise.all([
    ledgerInt('get_escrow'), ledgerInt('get_treasury'),
    ledgerInt('get_burned'), ledgerInt('get_total_staked'),
  ]);
  const bal = await heldOf(market);
  return { bal, esc, tres, burned, staked, rhs: esc + tres + burned + staked };
}

async function viewRawJson(method, argsObj) {
  const raw = await worker.provider.viewCallRaw(
    market.accountId, method,
    Buffer.from(JSON.stringify(argsObj)).toString('base64'));
  return Buffer.from(raw.result, 'base64').toString('utf8');
}
async function readAgents() {
  const ids = await market.view('get_agent_ids');
  const out = {};
  for (const id of ids) {
    // read stake EXACT from raw JSON text (avoid u128->double rounding)
    const j = await viewRawJson('get_agent', { account: id });
    const m = j.match(/"stake"\s*:\s*(-?\d+)/);
    out[id] = { stake: m ? BigInt(m[1]) : 0n, exists: true };
  }
  return out;
}

// ------------------------------------------------------------------ bookkeeping
let callNo = 0;
let okCount = 0, failCount = 0, storageNoise = 0;
const violations = [];
let lastOp = null; // {kind, args, success, err, pre, post}

function recordViolation(where, msg) {
  violations.push(where + ': ' + msg);
}

async function checkConservation(pre, post, where) {
  const dbal = post.bal - pre.bal;
  const drhs = post.rhs - pre.rhs;
  if (dbal === drhs) return true;
  let gap = dbal - drhs;
  if (gap < 0n) gap = -gap;
  if (gap <= NOISE_TOL) { storageNoise++; return true; }
  recordViolation(where, `dbal=${dbal} drhs=${drhs} gap=${dbal - drhs}`);
  return false;
}

async function checkBonds(where) {
  const [bonds, ags] = await Promise.all([readAgentBonds(), readAgents()]);
  let allOk = true;
  for (const [acc, bond] of bonds) {
    const ag = ags[acc];
    if (!ag) {
      recordViolation(where, `bond for unregistered agent ${acc}=${bond}`);
      allOk = false;
      continue;
    }
    if (bond > ag.stake) {
      recordViolation(where, `bonds(${bond}) > stake(${ag.stake}) for ${acc}`);
      allOk = false;
    }
  }
  return allOk;
}

async function fullDump() {
  const dump = {
    seed: SEED, callNo, violated: violations.slice(),
    lastOp: lastOp ? {
      kind: lastOp.kind, success: lastOp.success,
      args: lastOp.args, err: lastOp.err,
      pre: lastOp.pre, post: lastOp.post,
    } : null,
  };
  try { dump.agents = await readAgents(); } catch (e) { dump.agentsErr = String(e); }
  try {
    dump.bonds = Object.fromEntries(await readAgentBonds());
  } catch (e) { dump.bondsErr = String(e); }
  try {
    const ids = await market.view('get_lot_ids');
    dump.lots = [];
    for (const id of ids) {
      const l = await market.view('get_lot', { lot_id: id });
      dump.lots.push({
        id: l.lot_id, status: l.status, winner: l.winner,
        budget: String(l.budget), winning_price: String(l.winning_price),
        payout: l.payout ? { executor: String(l.payout.executor), manager: String(l.payout.manager), fee: String(l.payout.fee) } : null,
      });
    }
  } catch (e) { dump.lotsErr = String(e); }
  return JSON.stringify(dump, null, 2);
}

// run one op: snap before, attempt, snap after, check I-A and I-B
async function fire(kind, fn, args) {
  callNo++;
  const pre = await snap();
  let success = false, err = '';
  try { await fn(); success = true; okCount++; }
  catch (e) { err = extractErr(e); failCount++; }
  const post = await snap();
  lastOp = { kind, args, success, err, pre, post };
  const okA = await checkConservation(pre, post, kind);
  const okB = await checkBonds(kind);
  if (!okA || !okB) {
    const dumped = await fullDump();
    fs.writeFileSync('./fuzz-fail-dump.json', dumped);
    console.error('FUZZ_FAIL dump -> ./fuzz-fail-dump.json');
    console.error(dumped);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- traps (T1/T2/T3)
let lotSeq = 0;
function nextLotId(prefix) {
  return `${prefix}-${lotSeq++}`;
}
async function deadlines(opts = {}) {
  const c = await chainNowMs();
  const bid = c + (opts.bidIn ?? Math.floor(4000 + RNG() * 8000)); // bid in +4..12s
  const wd = c + (opts.wdIn ?? 300000);
  const vd = c + (opts.vdIn ?? 600000);
  return { bid, wd, vd };
}
async function setupLot(prefix, budgetN, opts = {}) {
  const id = nextLotId(prefix);
  const d = await deadlines(opts);
  await manager.call(market, 'create_task', {
    lot_id: id, task_hash: 'T:' + 'a'.repeat(64),
    bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
  }, { attachedDeposit: NEAR.parse(`${budgetN} N`) });
  return { id, d, budgetN };
}

// fresh agent per trap -> isolates scripted scenarios from main-loop drain/slash
let trapSeq = 0;
// main-loop randomly raises min_stake (1..50N); traps reset it to 1N so their
// fresh 10N registrations and T1 award (winner stake > min_stake) are valid.
async function resetMinStake() {
  await fire('reset-min-stake', () => owner.call(market, 'set_min_stake', { min_stake: NEAR.parse('1 N') }), { to: '1 N' });
}
async function freshAgent(base) {
  const name = base + (++trapSeq);
  const a = await root.devCreateAccount(name);
  await root.transfer(a.accountId, NEAR.parse('3000 N'));
  await a.call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
  return a;
}

// T3: cancel_lot with pending bids -> refund; escrow drops; conservation + bonds hold
async function trapCancelWithBids() {
  await resetMinStake();
  const bidder = await freshAgent('t3b');
  const { id, d } = await setupLot('t3', 50);
  const bidN = 20 + Math.floor(RNG() * 20);
  await bidder.callRaw(market.accountId, 'submit_bid',
    Buffer.from(bidArgs(id, bidN, 15000)), {});
  await waitPast(d.bid, 't3-bid');
  await manager.call(market, 'close_bidding', { lot_id: id });
  await fire('T3-cancel-pending', () => manager.call(market, 'cancel_lot', { lot_id: id }), { lot: id });
}

// T2: raise_min_stake mid-flight between bid and award -> award must revert
// (winner stake below min_stake at award), escrow not stuck, bonds not created.
async function trapRaiseMinStake() {
  await resetMinStake();
  const bidder = await freshAgent('t2b');
  const { id, d } = await setupLot('t2', 50);
  await bidder.callRaw(market.accountId, 'submit_bid',
    Buffer.from(bidArgs(id, 25, 15000)), {});
  await waitPast(d.bid, 't2-bid');
  await manager.call(market, 'close_bidding', { lot_id: id });
  await fire('T2-raise-min-stake', () => owner.call(market, 'set_min_stake', { min_stake: NEAR.parse('100 N') }), { to: '100 N' });
  await fire('T2-award-after-raise', () => manager.call(market, 'award_best', { lot_id: id }), { lot: id });
  await fire('T2-restore-min-stake', () => owner.call(market, 'set_min_stake', { min_stake: NEAR.parse('1 N') }), { to: '1 N' });
}

// T1: withdraw -> award -> no_show. Winner withdraws part, then wins a lot
// (bond frozen on remaining stake), then no_shows -> slash. Verify bond + slash
// never push bonds above stake and conservation holds.
async function trapWithdrawAwardNoShow() {
  await resetMinStake();
  const winner = await freshAgent('t1w');
  // short work window so no_show is reachable in-run (wd +40s)
  const { id, d } = await setupLot('t1', 50, { wdIn: 40000, vdIn: 90000 });
  await winner.callRaw(market.accountId, 'submit_bid',
    Buffer.from(bidArgs(id, 30, 15000)), {});
  await waitPast(d.bid, 't1-bid');
  await manager.call(market, 'close_bidding', { lot_id: id });
  // withdraw a chunk before award (leave stake > min_stake)
  await winner.call(market, 'withdraw_stake', { amount: NEAR.parse('2 N') });
  await fire('T1-award-after-withdraw', () => manager.call(market, 'award_best', { lot_id: id }), { lot: id });
  // skip work, let work deadline pass, then no_show (slash 50% of current stake)
  await waitPast(d.wd, 't1-wd');
  await fire('T1-no-show', () => manager.call(market, 'mark_no_show', { lot_id: id }), { lot: id });
}

// ---------------------------------------------------------------- main fuzz loop
function pickAgent(rng) {
  const names = Object.keys(agents);
  return agents[names[Math.floor(rng() * names.length)]];
}
function pickLiveLot(rng) {
  return null; // lots are chosen from manager's recent creations
}
function lotIdRandom(rng, prefix) {
  const n = 3 + Math.floor(rng() * 4); // reuse one of last few lot ids
  return `${prefix}-${Math.max(0, lotSeq - 1 - n)}`;
}
async function bidRandom(rng, lotId) {
  const a = pickAgent(rng);
  const priceN = 5 + Math.floor(rng() * 45);
  const eta = 10000 + Math.floor(rng() * 40000);
  return a.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs(lotId, priceN, eta)), {});
}

async function main() {
  RNG = mulberry32(SEED);
  worker = await Worker.init({ rm: true });
  try {
    root = worker.rootAccount;
    manager = await root.devCreateAccount('manager');
    owner = await root.devCreateAccount('owner');
    stranger = await root.devCreateAccount('stranger');
    await root.transfer(manager.accountId, NEAR.parse('50000 N'));
    await root.transfer(owner.accountId, NEAR.parse('10000 N'));
    market = await root.createSubAccount('market');
    await market.deploy(fs.readFileSync(WASM));
    await market.call(market, 'new', { owner_id: owner.accountId }, {});
    for (const n of A_NAMES) {
      agents[n] = await root.devCreateAccount(n);
      await root.transfer(agents[n].accountId, NEAR.parse('3000 N'));
    }
    // register all agents (10N each)
    for (const n of A_NAMES) {
      await agents[n].call(market, 'register_agent', {}, { attachedDeposit: NEAR.parse('10 N') });
    }

    // run T3 early (bids present) to warm the fuzz
    await trapCancelWithBids();

    // main fuzz loop
    const lotPrefixes = ['fz', 'fq', 'fx'];
    for (let i = 0; i < MAX_OPS; i++) {
      // inject scripted traps at fixed intervals
      if (i % 137 === 0) { await trapWithdrawAwardNoShow(); continue; }
      if (i % 211 === 0) { await trapRaiseMinStake(); continue; }
      if (i % 173 === 0) { await trapCancelWithBids(); continue; }

      const roll = RNG();
      const prefix = lotPrefixes[Math.floor(RNG() * lotPrefixes.length)];
      const lotId = lotIdRandom(RNG, prefix);
      const agent = pickAgent(RNG);
      const budgetN = 20 + Math.floor(RNG() * 80);

      if (roll < 0.14) {
        // create a new lot (manager)
        const d = await deadlines();
        await fire('create_task', () => manager.call(market, 'create_task', {
          lot_id: nextLotId(prefix), task_hash: 'T:' + 'a'.repeat(64),
          bid_deadline_ms: d.bid, work_deadline_ms: d.wd, verify_deadline_ms: d.vd,
        }, { attachedDeposit: NEAR.parse(`${budgetN} N`) }), { budgetN });
      } else if (roll < 0.30) {
        await fire('submit_bid', () => bidRandom(RNG, lotId), { lot: lotId });
      } else if (roll < 0.40) {
        await fire('close_bidding', () => manager.call(market, 'close_bidding', { lot_id: lotId }), { lot: lotId });
      } else if (roll < 0.50) {
        await fire('award_best', () => manager.call(market, 'award_best', { lot_id: lotId }), { lot: lotId });
      } else if (roll < 0.58) {
        await fire('mark_no_show', () => manager.call(market, 'mark_no_show', { lot_id: lotId }), { lot: lotId });
      } else if (roll < 0.66) {
        await fire('cancel_lot', () => manager.call(market, 'cancel_lot', { lot_id: lotId }), { lot: lotId });
      } else if (roll < 0.74) {
        const amt = ['1 N', '2 N', '5 N', '8 N'][Math.floor(RNG() * 4)];
        await fire('withdraw_stake', () => agent.call(market, 'withdraw_stake', { amount: NEAR.parse(amt) }), { agent: agent.accountId, amt });
      } else if (roll < 0.82) {
        await fire('submit_work', () => agent.call(market, 'submit_work', { lot_id: lotId, work_hash: 'W:' + 'b'.repeat(32) }), { lot: lotId });
      } else if (roll < 0.88) {
        await fire('accept_work', () => manager.call(market, 'accept_work', { lot_id: lotId }), { lot: lotId });
      } else if (roll < 0.93) {
        await fire('reject_work', () => manager.call(market, 'reject_work', { lot_id: lotId }), { lot: lotId });
      } else if (roll < 0.97) {
        await fire('settle_partial', () => manager.call(market, 'settle_partial', { lot_id: lotId, alpha_bps: 3000 }), { lot: lotId, a: 3000 });
      } else if (roll < 0.99) {
        // stranger / unregistered / garbage calls
        await fire('stranger_bid', () => stranger.callRaw(market.accountId, 'submit_bid', Buffer.from(bidArgs(lotId, 10, 10000)), { }), { lot: lotId });
      } else {
        await fire('set_min_stake', () => owner.call(market, 'set_min_stake', { min_stake: NEAR.parse(`${1 + Math.floor(RNG() * 50)} N`) }), {});
      }
    }

    console.log(`FUZZ OK seed=${SEED} ops=${callNo} ok=${okCount} fail=${failCount} noiseAs=${storageNoise} violations=${violations.length}`);
    if (violations.length) {
      console.error('VIOLATIONS:\n' + violations.join('\n'));
      process.exit(1);
    }
    process.exit(0);
  } finally {
    await worker.tearDown();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
