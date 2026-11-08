const fs = require('fs');
const { Worker } = require('near-workspaces');

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const c = await root.createSubAccount('mincontr');
    await c.deploy(fs.readFileSync('/tmp/mincontr/target/wasm32-unknown-unknown/release/mincontr.wasm'));
    console.log('mincontr deployed OK');
    await c.call(c, 'new', {}, {});
    const n = await c.view('get', {});
    console.log('mincontr new()+get() =', n, '(expect 42)');
    console.log('MINIMAL NEAR-SDK 5.x CONTRACT WORKS ON SANDBOX');
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
