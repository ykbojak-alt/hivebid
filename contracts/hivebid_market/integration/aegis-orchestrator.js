// Local-sandbox contract adapter for the HiveBid AEGIS demo orchestrator.
// This script is intentionally loopback-only and never selects testnet/mainnet.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Worker, NEAR } = require('near-workspaces');
const { SandboxServer } = require('near-workspaces/dist/server/server');

const EXPECTED_WASM_MD5 = 'c6a9ca86cbc696f015a555f78dcf85da';
const RESULT_MARKER = 'AEGIS_SANDBOX_RESULT=';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

function rpcReady(port) {
  return new Promise(resolve => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'sandbox-ready',
      method: 'block',
      params: { finality: 'final' },
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

async function waitForRpc(server) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.subprocess && server.subprocess.exitCode !== null) {
      throw new Error(`near-sandbox exited early (${server.subprocess.exitCode})`);
    }
    if (await rpcReady(server.port)) return;
    await sleep(250);
  }
  throw new Error(`loopback sandbox RPC did not start on ${server.port}`);
}

// near-workspaces 4.0 defaults its RPC/peer binds to 0.0.0.0. Keep this
// one-shot local sandbox on loopback while retaining its normal lifecycle.
SandboxServer.prototype.start = async function startLoopbackSandbox() {
  const networkPort = await SandboxServer.nextPort();
  const args = [
    '--home', this.homeDir,
    'run',
    '--rpc-addr', `127.0.0.1:${this.port}`,
    '--network-addr', `127.0.0.1:${networkPort}`,
  ];
  this.subprocess = spawn(SandboxServer.binPath, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  this.subprocess.on('exit', () => {
    if (!this.readyToDie) {
      process.stderr.write(`near-sandbox exited unexpectedly on ${this.port}\n`);
    }
  });
  await waitForRpc(this);
  return this;
};

function requireGate(plan, step, expectedAmounts = {}) {
  const gate = plan.gates && plan.gates[step];
  assert(gate && gate.outcome === 'permit',
    `AEGIS permit missing before contract operation ${step}`);
  assert(Array.isArray(gate.proposal_ids) && gate.proposal_ids.length > 0,
    `AEGIS proposal ids missing for ${step}`);
  for (const [component, amount] of Object.entries(expectedAmounts)) {
    assert(Number(gate.amounts && gate.amounts[component]) === Number(amount),
      `AEGIS ${step}/${component} amount does not match contract call`);
  }
  return gate.proposal_ids;
}

function txRow(step, method, tx, proposalIds = []) {
  const receipt = tx.transactionReceipt || {};
  const receipts = (tx.result && tx.result.receipts_outcome) || [];
  return {
    step,
    method,
    tx_hash: receipt.hash || '',
    status: tx.succeeded ? 'success' : 'failure',
    execution_status: tx.status,
    policy_proposal_ids: proposalIds,
    logs: tx.logs || [],
    receipt_results: receipts.map(item => {
      const outer = item.outcome || {};
      const inner = outer.outcome || outer;
      const receiptStatus = inner.status || outer.status || null;
      return {
        receipt_id: item.id,
        executor_id: outer.executor_id,
        status: receiptStatus,
        success: Boolean(receiptStatus && typeof receiptStatus === 'object'
          && (Object.prototype.hasOwnProperty.call(receiptStatus, 'SuccessValue')
            || Object.prototype.hasOwnProperty.call(receiptStatus, 'SuccessReceiptId'))),
        logs: outer.logs || [],
      };
    }),
  };
}

async function callStep(rows, step, account, contractId, method, args, options,
  proposalIds = []) {
  const tx = await account.callRaw(contractId, method, args, options || {});
  const row = txRow(step, method, tx, proposalIds);
  rows.push(row);
  assert(row.tx_hash, `${step} returned no transaction hash`);
  assert(tx.succeeded, `${step} failed: ${JSON.stringify(tx.status)}`);
  return tx;
}

function nearNumber(yocto) {
  const value = BigInt(String(yocto || '0'));
  const unit = 10n ** 24n;
  return Number(value / unit) + Number(value % unit) / 1e24;
}

function viewText(result) {
  return Buffer.from(result.result || []).toString('utf8');
}

function rawU128(text, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"?([0-9]+)"?`).exec(text);
  assert(match, `could not read exact u128 field ${key}`);
  return match[1];
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const plan = JSON.parse(input || '{}');
  const wasmPath = process.env.HIVEBID_WASM;
  const binDir = process.env.NEAR_SANDBOX_BINARY_PATH;

  assert(process.env.NEAR_SANDBOX_BIN_PATH === binDir,
    'both NEAR_SANDBOX_*_PATH variables must name the sandbox bin directory');
  assert(binDir && fs.existsSync(path.join(binDir, 'near-sandbox')),
    'near-sandbox binary is not present in the configured directory');
  assert(wasmPath && fs.existsSync(wasmPath), 'HIVEBID_WASM file not found');
  const wasm = fs.readFileSync(wasmPath);
  const wasmMd5 = crypto.createHash('md5').update(wasm).digest('hex');
  assert(wasmMd5 === EXPECTED_WASM_MD5,
    `unexpected wasm md5 ${wasmMd5}`);

  const requiredSteps = [
    'register_agent', 'create_task', 'award_lot', 'accept_work',
  ];
  for (const step of requiredSteps) requireGate(plan, step);

  let worker;
  const transactions = [];
  const result = {
    status: 'failed',
    network: 'local-sandbox',
    rpc_host: '127.0.0.1',
    wasm_path: wasmPath,
    wasm_md5: wasmMd5,
    scenario_id: plan.scenario_id,
    lot_id: plan.lot_id,
    transactions,
  };

  try {
    worker = await Worker.init({
      network: 'sandbox',
      rm: true,
    });
    const root = worker.rootAccount;
    const manager = await root.createSubAccount('manager');
    const executor = await root.createSubAccount('alice');
    const market = await root.createSubAccount('market');
    assert(manager.accountId === plan.manager_id,
      `unexpected manager account ${manager.accountId}`);
    assert(executor.accountId === plan.executor_id,
      `unexpected executor account ${executor.accountId}`);
    result.accounts = {
      manager: manager.accountId,
      executor: executor.accountId,
      contract: market.accountId,
    };
    result.contract_account = market.accountId;

    const deploy = await market.deploy(wasm);
    const deployRow = txRow('deploy', 'deploy_contract', deploy);
    transactions.push(deployRow);
    assert(deployRow.tx_hash && deploy.succeeded, 'contract deployment failed');

    await callStep(transactions, 'init', market, market.accountId, 'new',
      { owner_id: manager.accountId }, {});

    const stake = String(plan.stake_near || '10');
    await callStep(
      transactions, 'register_agent', executor, market.accountId,
      'register_agent', {}, { attachedDeposit: NEAR.parse(`${stake} N`) },
      requireGate(plan, 'register_agent', { stake: Number(stake) }),
    );
    transactions[transactions.length - 1].attached_deposit_near = Number(stake);

    const budget = String(plan.budget_near || '100');
    const price = String(plan.bid_price_near || '40');
    const nowMs = Date.now();
    const deadlines = {
      bid_deadline_ms: nowMs + 20000,
      work_deadline_ms: nowMs + 60000,
      verify_deadline_ms: nowMs + 120000,
    };
    await callStep(
      transactions, 'create_task', manager, market.accountId, 'create_task',
      {
        lot_id: plan.lot_id,
        task_hash: plan.task_hash,
        ...deadlines,
      },
      { attachedDeposit: NEAR.parse(`${budget} N`) },
      requireGate(plan, 'create_task', { reserve: Number(budget) }),
    );
    transactions[transactions.length - 1].attached_deposit_near =
      Number(budget);

    // The contract takes primitive Rust u128 (not json_types::U128). Send the
    // exact decimal as a raw JSON integer to avoid JS number/string coercion.
    const priceYocto = NEAR.parse(`${price} N`).toString();
    const bidArgs = Buffer.from(
      `{"lot_id":${JSON.stringify(plan.lot_id)},` +
      `"price":${priceYocto},"eta_ms":30000,` +
      `"signature":"sandbox-demo-signature"}`,
      'utf8');
    await callStep(
      transactions, 'submit_bid', executor, market.accountId, 'submit_bid',
      bidArgs, {},
    );

    await sleep(21000);
    await callStep(
      transactions, 'close_bidding', manager, market.accountId,
      'close_bidding', { lot_id: plan.lot_id }, {},
    );

    const winner = await market.view('select_winner', { lot_id: plan.lot_id });
    assert(winner === executor.accountId, 'unexpected contract winner');
    await callStep(
      transactions, 'award_lot', manager, market.accountId, 'award_lot',
      { lot_id: plan.lot_id, winner },
      {}, requireGate(plan, 'award_lot', {
        release: Number(price),
        refund: Number(budget) - Number(price),
        reserve: Number(budget),
      }),
    );

    await callStep(
      transactions, 'submit_work', executor, market.accountId, 'submit_work',
      { lot_id: plan.lot_id, work_hash: plan.work_hash }, {},
    );
    const accept = await callStep(
      transactions, 'accept_work', manager, market.accountId, 'accept_work',
      { lot_id: plan.lot_id },
      {}, requireGate(plan, 'accept_work', {
        release: Number(price),
        refund: Number(budget) - Number(price),
        reserve: Number(budget),
      }),
    );

    const lotView = await market.viewRaw('get_lot', { lot_id: plan.lot_id });
    const lotText = viewText(lotView);
    const lot = JSON.parse(lotText);
    const agentText = viewText(await market.viewRaw(
      'get_agent', { account: executor.accountId }));
    const payoutAt = lotText.indexOf('"payout"');
    const payoutOpen = lotText.indexOf('{', payoutAt);
    const payoutClose = lotText.indexOf('}', payoutOpen);
    assert(payoutAt >= 0 && payoutOpen >= 0 && payoutClose > payoutOpen,
      'raw lot view is missing payout object');
    const payoutText = lotText.slice(payoutOpen, payoutClose + 1);
    const escrowText = viewText(await market.viewRaw('get_escrow', {}));
    const escrow = String(JSON.parse(escrowText));
    const reserveYocto = rawU128(lotText, 'budget');
    const vector = {
      release: nearNumber(rawU128(payoutText, 'executor')),
      refund: nearNumber(rawU128(payoutText, 'manager')),
      reserve: nearNumber(reserveYocto),
    };
    for (const step of ['award_lot', 'accept_work']) {
      const tx = transactions.find(row => row.step === step);
      tx.payout_vector = vector;
    }
    assert(lot.status === 'Completed', `unexpected final status ${lot.status}`);
    assert(escrow === '0', `escrow not empty after accept_work: ${escrow}`);
    assert(vector.release === Number(price), 'contract release != winning bid');
    assert(vector.release + vector.refund === vector.reserve,
      'contract payout vector does not conserve escrow');

    const settlementTx = transactions.find(tx => tx.step === 'accept_work');
    result.status = 'success';
    result.final_state = {
      lot_status: lot.status,
      lot_id: lot.lot_id,
      manager: lot.manager,
      winner: lot.winner,
      payout_vector: vector,
      escrow_yocto: escrow,
      executor_stake_yocto: rawU128(agentText, 'stake'),
    };
    result.policy_proposal_ids = plan.gates;
    result.settlement_tx_hash = settlementTx.tx_hash;
    result.receipt_results = settlementTx.receipt_results;
  } catch (error) {
    result.error = error && error.message ? error.message : String(error);
  } finally {
    if (worker) {
      try { await worker.tearDown(); }
      catch (error) {
        result.teardown_error = error && error.message
          ? error.message : String(error);
      }
    }
  }

  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
  if (result.status !== 'success') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
