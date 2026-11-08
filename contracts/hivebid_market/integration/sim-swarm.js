#!/usr/bin/env node
'use strict';

// Deterministic, no-network HiveBid scoring simulation. This is a dry-run only:
// it mirrors the contract's integer scoring math, but does not call NEAR or move funds.
const fs = require('node:fs');
const path = require('node:path');

const SCALE = 1_000_000n;
const WEIGHT_PRICE = 400_000n;
const WEIGHT_RATING = 400_000n;
const WEIGHT_ETA = 200_000n;
const RATING_PRIOR = 500_000n;
const RATING_PRIOR_SAMPLES = 3n;
const YOCTO = 10n ** 24n;
const HUNDREDTH_NEAR = YOCTO / 100n;
const BUDGET = 300n * HUNDREDTH_NEAR; // 3.00N
const BID_DEADLINE_MS = 10_000n;
const WORK_DEADLINE_MS = 100_000n;
const VERIFY_DEADLINE_MS = 120_000n;
const LOT_ID = 'LOT-SIM-001';

function parseArgs(argv) {
  let dry = false;
  let output = process.env.HIVEBID_SIM_OUTPUT || 'D:/Temp/sim-swarm.json';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry') {
      dry = true;
    } else if (arg === '--out') {
      if (!argv[i + 1]) throw new Error('--out requires a file path');
      output = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!dry) throw new Error('This runner is dry-only; pass --dry (no RPC, LLM, or real funds).');
  return { dry, output };
}

function formatNear(yocto) {
  const hundredths = yocto / HUNDREDTH_NEAR;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}N`;
}

function createScriptedBidders() {
  const bidders = [];
  for (let i = 0; i < 7; i += 1) {
    bidders.push({
      agent: `ROY-${String(i + 1).padStart(2, '0')}`,
      strategy: 'cheap-fast',
      price: BigInt(145 + i * 5) * HUNDREDTH_NEAR,
      rawRating: BigInt(520_000 + i * 10_000),
      ratingSamples: BigInt(1 + (i % 3)),
      etaMs: BigInt(18_000 + i * 2_000),
    });
  }
  for (let i = 0; i < 6; i += 1) {
    bidders.push({
      agent: `ROY-${String(i + 8).padStart(2, '0')}`,
      strategy: 'high-rating',
      price: BigInt(200 + i * 4) * HUNDREDTH_NEAR,
      rawRating: BigInt(920_000 - i * 12_000),
      ratingSamples: 8n,
      etaMs: BigInt(30_000 + i * 2_500),
    });
  }
  for (let i = 0; i < 7; i += 1) {
    bidders.push({
      agent: `ROY-${String(i + 14).padStart(2, '0')}`,
      strategy: 'balanced',
      price: BigInt(175 + i * 6) * HUNDREDTH_NEAR,
      rawRating: BigInt(700_000 + i * 12_000),
      ratingSamples: 5n,
      etaMs: BigInt(25_000 + i * 2_500),
    });
  }
  return bidders;
}

function effectiveRating({ rawRating, ratingSamples }) {
  return (ratingSamples * rawRating + RATING_PRIOR_SAMPLES * RATING_PRIOR)
    / (ratingSamples + RATING_PRIOR_SAMPLES);
}

function scoreBid(lot, bid, nowMs) {
  const fPrice = lot.budget === 0n
    ? 0n
    : SCALE - (bid.price * SCALE) / lot.budget;
  const fRating = effectiveRating(bid);
  const denominator = lot.workDeadlineMs > nowMs ? lot.workDeadlineMs - nowMs : 0n;
  const numerator = lot.workDeadlineMs > bid.etaMs ? lot.workDeadlineMs - bid.etaMs : 0n;
  const fEta = denominator === 0n
    ? 0n
    : ((numerator * SCALE) / denominator > SCALE
      ? SCALE
      : (numerator * SCALE) / denominator);
  const score = (WEIGHT_PRICE * fPrice) / SCALE
    + (WEIGHT_RATING * fRating) / SCALE
    + (WEIGHT_ETA * fEta) / SCALE;
  return { ...bid, fPrice, fRating, fEta, score };
}

function compareForAward(a, b) {
  if (a.score !== b.score) return a.score > b.score ? -1 : 1;
  if (a.price !== b.price) return a.price < b.price ? -1 : 1;
  return a.agent.localeCompare(b.agent);
}

class DryHiveBid {
  constructor() {
    this.escrow = 0n;
    this.lot = null;
  }

  create_task(lotId, budget) {
    if (this.lot) throw new Error('dry simulator supports one lot per run');
    if (budget <= 0n) throw new Error('budget must be positive');
    this.lot = { lotId, budget, status: 'Open', bids: [], workDeadlineMs: WORK_DEADLINE_MS };
    this.escrow += budget;
  }

  submit_bid(bid, nowMs) {
    if (!this.lot || this.lot.status !== 'Open') throw new Error('lot is not open');
    if (nowMs >= BID_DEADLINE_MS) throw new Error('bidding is closed');
    if (bid.price <= 0n || bid.price > this.lot.budget) throw new Error(`${bid.agent}: price out of bounds`);
    if (bid.etaMs > this.lot.workDeadlineMs) throw new Error(`${bid.agent}: ETA exceeds work deadline`);
    if (this.lot.bids.some((item) => item.agent === bid.agent)) throw new Error(`${bid.agent}: duplicate bid`);
    if (this.lot.bids.length >= 64) throw new Error('contract bid limit reached');
    this.lot.bids.push(bid);
  }

  close_bidding(nowMs) {
    if (!this.lot || this.lot.status !== 'Open') throw new Error('lot is not open');
    if (nowMs < BID_DEADLINE_MS) throw new Error('bidding deadline has not elapsed');
    this.lot.status = 'BidsClosed';
  }

  get_bid_scores(nowMs) {
    if (!this.lot) throw new Error('no lot');
    return this.lot.bids.map((bid) => scoreBid(this.lot, bid, nowMs));
  }

  award_best(nowMs) {
    if (!this.lot || this.lot.status !== 'BidsClosed') throw new Error('lot must be BidsClosed');
    const winner = this.get_bid_scores(nowMs).sort(compareForAward)[0];
    if (!winner) throw new Error('no bids');
    this.lot.status = 'Awarded';
    this.lot.winner = winner.agent;
    this.lot.winningPrice = winner.price;
    return winner;
  }

  get_escrow() {
    return this.escrow;
  }
}

function writeOutput(outputPath, payload) {
  const absolutePath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, absolutePath);
  return absolutePath;
}

function runDry(outputPath) {
  console.log('DRY-RUN: real scoring math, no funds needed, judges can run with --dry');
  console.log('No LLM, RPC, wallet, NEAR sandbox, or transaction calls are made.');

  const market = new DryHiveBid();
  const readEscrow = (step) => console.log(`get_escrow after ${step}: ${formatNear(market.get_escrow())}`);
  readEscrow('start');

  market.create_task(LOT_ID, BUDGET);
  console.log(`SIMULATE create_task lot=${LOT_ID} budget=${formatNear(BUDGET)}`);
  readEscrow('create_task');

  const bidders = createScriptedBidders();
  for (const bid of bidders) market.submit_bid(bid, 1_000n);
  console.log(`SIMULATE submit_bid x${bidders.length} (unique agents, within MAX_BIDS=64)`);
  readEscrow('submit_bid x20');

  // The contract requires BidsClosed before award_best; scoring is read after close.
  market.close_bidding(BID_DEADLINE_MS);
  console.log('SIMULATE close_bidding');
  readEscrow('close_bidding');

  const scores = market.get_bid_scores(BID_DEADLINE_MS);
  console.log('SIMULATE get_bid_scores (SCALE=1,000,000; weights=400000/400000/200000)');
  console.table(scores.map((bid) => ({
    agent: bid.agent,
    strategy: bid.strategy,
    amount: formatNear(bid.price),
    f_price: Number(bid.fPrice) / Number(SCALE),
    f_rating_eff: Number(bid.fRating) / Number(SCALE),
    f_eta: Number(bid.fEta) / Number(SCALE),
    score_norm: Number(bid.score) / Number(SCALE),
  })));
  readEscrow('get_bid_scores');

  const winner = market.award_best(BID_DEADLINE_MS);
  console.log(`SIMULATE award_best winner=${winner.agent} clearing_price=${formatNear(winner.price)}`);
  readEscrow('award_best (payout remains locked until later work/settlement)');

  const payload = {
    ok: true,
    generated_at: new Date().toISOString(),
    rounds: [{
      round: 1,
      lot: LOT_ID,
      bids: scores.map((bid) => ({
        agent: bid.agent,
        amount: formatNear(bid.price),
        score_norm: Number(bid.score) / Number(SCALE),
      })),
      winner: winner.agent,
      clearing_price: formatNear(winner.price),
    }],
  };
  const written = writeOutput(outputPath, payload);
  console.log(`JSON written: ${written}`);
  console.log(`Round 1: bids=${scores.length}, winner=${winner.agent}, clearing_price=${formatNear(winner.price)}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node sim-swarm.js --dry [--out <path>]');
    console.log('Writes scripted HiveBid scoring data; no network, LLM, wallet, or funds.');
    return;
  }
  runDry(options.output);
}

try {
  main();
} catch (error) {
  console.error(`sim-swarm: ${error.message}`);
  process.exitCode = 2;
}