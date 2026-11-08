// Probe: does the sandbox compile a known-good bundled wasm (testnet-linkdrop.wasm)?
// If even this fails with PrepareError:Deserialization -> environment/toolchain-wide
// incompatibility. If it succeeds (method-not-found is fine) -> our contract wasm is the issue.
const fs = require('fs');
const { Worker } = require('near-workspaces');

const WASM = require('path').join(
  require('path').dirname(require.resolve('near-workspaces/package.json')),
  'core_contracts', 'testnet-linkdrop.wasm'
);

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const c = await root.createSubAccount('linkdrop');
    await c.deploy(fs.readFileSync(WASM));
    console.log('linkdrop deployed OK (bytes =', fs.statSync(WASM).size, ')');
    // Try calling something. Linkdrop has 'create_account'/'send' etc.
    // Unknown-method -> MethodNotFound; CompilationError -> environment broken.
    try {
      await c.call(c, 'totally_missing_method', {}, {});
      console.log('PROBE: call returned success (unexpected)');
    } catch (e) {
      const s = JSON.stringify(e);
      if (s.includes('CompilationError') || s.includes('PrepareError')) {
        console.log('PROBE FAIL: got Compilation/PrepareError on bundled wasm');
        console.log('  -> environment/toolchain-wide incompatibility confirmed');
        process.exit(2);
      }
      console.log('PROBE OK: bundled wasm compiled; error was non-compilation:', s.slice(0, 120));
    }
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
