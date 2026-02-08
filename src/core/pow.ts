
import { WASM_PATH, logger } from "../config.ts";

let wasmInstance: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

async function getWasmInstance() {
  if (wasmInstance) return { instance: wasmInstance, memory: wasmMemory };

  try {
    const wasmBytes = await Deno.readFile(WASM_PATH);
    const wasmModule = await WebAssembly.instantiate(wasmBytes, {});
    wasmInstance = wasmModule.instance;
    wasmMemory = wasmInstance.exports.memory as WebAssembly.Memory;
    logger.info(`[WASM] Loaded WASM module: ${WASM_PATH}`);
    return { instance: wasmInstance, memory: wasmMemory };
  } catch (e) {
    logger.error(`[WASM] Failed to load WASM module: ${e}`);
    throw e;
  }
}

export async function computePowAnswer(
  algorithm: string,
  challengeStr: string,
  salt: string,
  difficulty: number,
  expireAt: number,
  signature: string,
  targetPath: string
): Promise<number | null> {
  if (algorithm !== "DeepSeekHashV1") {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }

  const prefix = `${salt}_${expireAt}_`;
  const { instance, memory } = await getWasmInstance();
  if (!instance || !memory) throw new Error("WASM not initialized");

  const exports = instance.exports as any;
  const addToStack = exports.__wbindgen_add_to_stack_pointer;
  const alloc = exports.__wbindgen_export_0;
  const wasmSolve = exports.wasm_solve;

  if (!addToStack || !alloc || !wasmSolve) {
    throw new Error("Missing WASM exports");
  }

  const encodeString = (text: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const ptr = alloc(data.length, 1);
    const memArray = new Uint8Array(memory.buffer);
    memArray.set(data, ptr);
    return [ptr, data.length];
  };

  try {
    // 1. Allocate stack space (16 bytes)
    const retptr = addToStack(-16);

    // 2. Encode strings
    const [ptrChallenge, lenChallenge] = encodeString(challengeStr);
    const [ptrPrefix, lenPrefix] = encodeString(prefix);

    // 3. Call wasm_solve
    wasmSolve(retptr, ptrChallenge, lenChallenge, ptrPrefix, lenPrefix, difficulty);

    // 4. Read result
    const view = new DataView(memory.buffer);
    const status = view.getInt32(retptr, true); // Little endian
    const value = view.getFloat64(retptr + 8, true);

    // 5. Restore stack
    addToStack(16);

    if (status === 0) {
        return null;
    }
    return Math.floor(value);

  } catch (e) {
    logger.error(`[PoW] Computation failed: ${e}`);
    return null;
  }
}
