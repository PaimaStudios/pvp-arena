import init, {
  CostModel,
  MidnightWasmParamsProvider,
  Rng,
  WasmProver,
  WasmResolver,
  initThreadPool,
} from '@paima/midnight-wasm-prover';
import type { ProverRequest, ProverResponse } from './wasm-prover-types';

let prover: WasmProver | undefined;
let rng: Rng | undefined;
let wasmInitialized = false;

const threadCount = () => {
  const concurrency = self.navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(4, concurrency));
};

const postError = (requestId: number, error: unknown) => {
  self.postMessage({
    type: 'error',
    requestId,
    message: error instanceof Error ? error.message : String(error),
  } satisfies ProverResponse);
};

const initializeWasm = async () => {
  if (wasmInitialized) return;

  await init();
  rng = Rng.new();

  if (self.crossOriginIsolated) {
    await initThreadPool(threadCount());
  } else {
    console.warn('[wasm-prover] crossOriginIsolated=false, skipping rayon thread pool init');
  }

  wasmInitialized = true;
};

self.onmessage = async (event: MessageEvent<ProverRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'init': {
        await initializeWasm();
        prover = WasmProver.new(
          WasmResolver.new(message.baseUrl),
          MidnightWasmParamsProvider.new(message.baseUrl),
        );
        self.postMessage({
          type: 'init-ready',
          requestId: message.requestId,
        } satisfies ProverResponse);
        return;
      }
      case 'prove': {
        if (!prover || !rng) {
          throw new Error('WASM prover worker is not initialized');
        }

        const startedAt = performance.now();
        const provenTx = await prover.prove(
          rng,
          message.serializedTx,
          CostModel.initialCostModel(),
        );

        self.postMessage(
          {
            type: 'success',
            requestId: message.requestId,
            serializedTx: provenTx,
            durationMs: Math.round(performance.now() - startedAt),
          } satisfies ProverResponse,
          { transfer: [provenTx.buffer] },
        );
        return;
      }
    }
  } catch (error) {
    postError(message.requestId, error);
  }
};
