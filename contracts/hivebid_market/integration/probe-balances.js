const { Worker, NEAR } = require('near-workspaces');

async function main() {
  const worker = await Worker.init({ rm: true });
  try {
    const root = worker.rootAccount;
    const manager = await root.devCreateAccount('manager');
    const alice = await root.devCreateAccount('alice');
    const b = async (label, acc) => {
      const bal = await acc.balance();
      console.log(label, 'balance =', bal.total ? bal.total.toString() : String(bal));
    };
    await b('root', root);
    await b('manager', manager);
    await b('alice', alice);
  } finally {
    await worker.tearDown();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
