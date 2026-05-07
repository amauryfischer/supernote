import pino from "pino";

const logger = pino({ name: "search:embedding" });

/** Default ONNX model: 384-dim, multilingual-friendly, ~25 MB */
export const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

/** Lazy-loading wrapper around transformers.js pipeline */
export class EmbeddingEngine {
  private pipeline: EmbeddingPipelineLike | null = null;
  private readonly modelName: string;
  private readonly cacheDir: string | undefined;

  constructor(modelName = DEFAULT_MODEL, cacheDir?: string) {
    this.modelName = modelName;
    this.cacheDir = cacheDir;
  }

  /** Lazily initialize the transformers.js pipeline */
  private async getPipeline(): Promise<EmbeddingPipelineLike> {
    if (this.pipeline) return this.pipeline;

    logger.info({ model: this.modelName }, "Loading embedding model");
    // Dynamic import to avoid loading at module parse time (heavy)
    // @huggingface/transformers is the v3 package (formerly @xenova/transformers)
    const { pipeline, env } = await import("@huggingface/transformers");

    if (this.cacheDir) {
      env.cacheDir = this.cacheDir;
    }
    env.allowLocalModels = true;

    this.pipeline = await pipeline("feature-extraction", this.modelName, {
      // Use quantized int8 weights for smaller memory footprint (~25 MB)
      dtype: "q8",
    }) as unknown as EmbeddingPipelineLike;

    logger.info({ model: this.modelName }, "Embedding model loaded");
    return this.pipeline;
  }

  /** Embed a single text string to a Float32Array vector */
  async embed(text: string): Promise<Float32Array> {
    const pipe = await this.getPipeline();
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return toFloat32Array(output);
  }

  /** Embed multiple texts in a single pipeline call */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipe = await this.getPipeline();
    const output = await pipe(texts, { pooling: "mean", normalize: true });
    return toBatchFloat32Arrays(output, texts.length);
  }

  /** Clean up resources */
  dispose(): void {
    this.pipeline = null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers for extracting Float32Array from transformers.js output
// ---------------------------------------------------------------------------

interface EmbeddingPipelineLike {
  (
    input: string | string[],
    opts: { pooling: string; normalize: boolean },
  ): Promise<TensorLike>;
}

interface TensorLike {
  data: Float32Array | number[];
  dims: number[];
}

function toFloat32Array(tensor: TensorLike): Float32Array {
  const data = tensor.data;
  if (data instanceof Float32Array) return data;
  return new Float32Array(data);
}

function toBatchFloat32Arrays(
  tensor: TensorLike,
  count: number,
): Float32Array[] {
  const flat = toFloat32Array(tensor);
  const dim = flat.length / count;
  const result: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    result.push(flat.slice(i * dim, (i + 1) * dim));
  }
  return result;
}
