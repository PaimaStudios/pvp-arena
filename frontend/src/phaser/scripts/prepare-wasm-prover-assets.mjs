import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');
const keysDir = path.join(distDir, 'keys');
const zkirDir = path.join(distDir, 'zkir');

if (!fs.existsSync(keysDir) || !fs.existsSync(zkirDir)) {
  throw new Error(`Expected ${keysDir} and ${zkirDir} to exist before preparing wasm prover assets`);
}

const proverFiles = fs.readdirSync(keysDir).filter((file) => file.endsWith('.prover'));

for (const proverFile of proverFiles) {
  const circuitName = proverFile.slice(0, -'.prover'.length);
  const verifierFile = `${circuitName}.verifier`;
  const irFile = `${circuitName}.bzkir`;

  const verifierPath = path.join(keysDir, verifierFile);
  const irPath = path.join(zkirDir, irFile);

  if (!fs.existsSync(verifierPath)) {
    throw new Error(`Missing verifier key for circuit ${circuitName}: ${verifierPath}`);
  }

  if (!fs.existsSync(irPath)) {
    throw new Error(`Missing bzkir for circuit ${circuitName}: ${irPath}`);
  }

  const targetDir = path.join(distDir, circuitName);
  fs.mkdirSync(targetDir, { recursive: true });

  fs.copyFileSync(path.join(keysDir, proverFile), path.join(targetDir, 'pk'));
  fs.copyFileSync(verifierPath, path.join(targetDir, 'vk'));
  fs.copyFileSync(irPath, path.join(targetDir, 'ir'));
}

console.log(`[prepare-wasm-prover-assets] prepared ${proverFiles.length} circuit directories`);
