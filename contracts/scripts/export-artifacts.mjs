import { mkdir, readFile, writeFile } from 'node:fs/promises';
const names = ['CarveContentRegistry', 'CarveFactory', 'CarveMarket', 'CarveToken',
  'CarveFactoryV2', 'CarveMarketV2', 'CarveV4Engine', 'CarveV4Router', 'CarveDeployment'];
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
for (const name of names) {
  const source = JSON.parse(await readFile(new URL(`../out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
  const artifact = {
    contractName: name,
    compiler: '0.8.37',
    evmVersion: 'cancun',
    optimizerRuns: 200,
    viaIR: true,
    productionReady: false,
    abi: source.abi,
    bytecode: source.bytecode.object,
    deployedBytecode: source.deployedBytecode.object,
  };
  await writeFile(new URL(`../artifacts/${name}.json`, import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
}
process.stdout.write(`Exported ${names.length} ABI + bytecode artifacts.\n`);
