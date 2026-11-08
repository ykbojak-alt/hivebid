const fs = require('fs');
const assert = require('assert');
const { Worker } = require('near-workspaces');

const WASM = process.env.WASM || '/root/attested-mint-qwen/attested_mint.wasm';

async function main() {
  const worker = await Worker.init({ rm: true });
  const root = worker.rootAccount;
  const owner = await root.devCreateAccount('owner');
  const eve = await root.devCreateAccount('eve');
  const mint = await root.createSubAccount('mint');

  await mint.deploy(fs.readFileSync(WASM));
  await owner.call(mint, 'new', {}, {});
  console.log('deployed + initialized attested_mint, owner =', owner.accountId);

  const meta = await mint.view('nft_metadata', {});
  console.log('nft_metadata:', JSON.stringify(meta));
  assert(meta && meta.spec === 'nft-1.0.0', 'NEP-171 metadata spec');

  await owner.call(mint, 'add_evaluator', { evaluator: eve.accountId }, {});
  console.log('evaluator added:', eve.accountId);

  const tokenId = await eve.call(mint, 'attest_mint', {
    intent_uuid: 'intent-0001-deadbeef',
    report_hash: 'r'.repeat(64),
    tee_report_hash: 't'.repeat(64),
  }, {});
  console.log('attest_mint ->', tokenId);
  assert(tokenId === 'nft-intent-0001-dead', 'token id derivation');

  const att = await mint.view('get_attestation', { intent_uuid: 'intent-0001-deadbeef' });
  assert(att && att.evaluator === eve.accountId, 'attestation recorded');
  console.log('attestation OK, evaluator =', att.evaluator);

  // one-shot: duplicate intent_uuid must revert
  try {
    await eve.call(mint, 'attest_mint', {
      intent_uuid: 'intent-0001-deadbeef', report_hash: 'x', tee_report_hash: 'y',
    }, {});
    console.log('FAIL: duplicate attestation accepted');
    process.exit(1);
  } catch (e) {
    console.log('one-shot reject OK:', String(e).slice(0, 100));
  }

  // unauthorized evaluator must revert
  const mallory = await root.devCreateAccount('mallory');
  try {
    await mallory.call(mint, 'attest_mint', {
      intent_uuid: 'intent-0002', report_hash: 'x', tee_report_hash: 'y',
    }, {});
    console.log('FAIL: unauthorized attest accepted');
    process.exit(1);
  } catch (e) {
    console.log('evaluator-gate reject OK:', String(e).slice(0, 100));
  }

  console.log('ATT-TESTNET-SMOKE: PASS');
}

main().catch(e => { console.error('SMOKE FAIL:', e); process.exit(1); });
