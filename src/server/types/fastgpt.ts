/**
 * FastGPT-compatible external knowledge base types and zod schemas.
 *
 * Single source of truth for both the probe (`external-kb-probe.ts`) and the
 * runtime client (`fastgpt-client.ts`). Replaces the previously duplicated
 * inline `as` assertions with runtime-validated schemas.
 *
 * The FastGPT API is intentionally loosely-typed (it speaks MongoDB under the
 * hood), so we keep the schemas permissive (`passthrough` + optional fields)
 * but still validate the shape we depend on.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Dataset (list endpoint)
// ---------------------------------------------------------------------------

/**
 * FastGPT serialises MongoDB ObjectIds as either a plain string, `{ $oid: "..." }`,
 * or `{ _id: "..." }` depending on the version. Use `extractDatasetId` to
 * normalise any of these shapes into a plain string.
 */
export interface FastGPTDataset {
  _id?: string | { $oid: string };
  id?: string;
  datasetId?: string;
  name?: string;
  [key: string]: unknown;
}

export const FastGPTDatasetSchema = z
  .object({
    _id: z.union([z.string(), z.object({ $oid: z.string() })]).optional(),
    id: z.string().optional(),
    datasetId: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

export const FastGPTListResponseSchema = z
  .object({
    code: z.number().optional(),
    data: z.union([z.array(FastGPTDatasetSchema), z.record(z.string(), z.unknown())]).optional(),
    message: z.string().optional(),
    statusText: z.string().optional(),
  })
  .passthrough();

export interface FastGPTListResponse {
  code?: number;
  data?: FastGPTDataset[] | Record<string, unknown>;
  message?: string;
  statusText?: string;
}

// ---------------------------------------------------------------------------
// Search response (searchTest endpoint)
// ---------------------------------------------------------------------------

const FastGPTSearchItemSchema = z
  .object({
    id: z.string().optional(),
    q: z.string().optional(),
    a: z.string().optional(),
    datasetId: z.string().optional(),
    collectionId: z.string().optional(),
    source: z.string().optional(),
    sourceName: z.string().optional(),
    sourceId: z.string().optional(),
    /**
     * FastGPT Cloud returns `score` as an array of `{type, value, index}` per channel.
     * Older versions returned a single number.
     */
    score: z
      .union([
        z.number(),
        z.array(
          z
            .object({
              type: z.string().optional(),
              value: z.number().optional(),
              index: z.number().optional(),
            })
            .passthrough(),
        ),
      ])
      .optional(),
  })
  .passthrough();

export const FastGPTSearchResponseSchema = z
  .object({
    code: z.number().optional(),
    message: z.string().optional(),
    statusText: z.string().optional(),
    error: z
      .object({
        message: z.string().optional(),
      })
      .optional(),
    data: z
      .object({
        list: z.array(FastGPTSearchItemSchema).optional(),
        duration: z.number().optional(),
        limit: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface FastGPTSearchResponseItem {
  id?: string;
  q?: string;
  a?: string;
  source?: string;
  sourceName?: string;
  sourceId?: string;
  datasetId?: string;
  collectionId?: string;
  score?: number | number[] | Array<{ type?: string; value?: number; index?: number }>;
  [key: string]: unknown;
}

export interface FastGPTSearchResponse {
  code?: number;
  message?: string;
  statusText?: string;
  data?: {
    list?: FastGPTSearchResponseItem[];
    duration?: number;
    limit?: number;
    [key: string]: unknown;
  };
  error?: { message?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pull the dataset ID out of any of the supported FastGPT serialisation shapes:
 *  - `string`                     — plain
 *  - `{ $oid: "..." }`            — MongoDB Extended JSON
 *  - `{ id: "..." }`              — some FastGPT versions
 *  - `{ datasetId: "..." }`       — some FastGPT versions
 *
 * Returns `undefined` when no recognised field is present.
 */
export function extractDatasetId(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.$oid === 'string') return obj.$oid;
    if (typeof obj.id === 'string') return obj.id;
    if (typeof obj._id === 'string') return obj._id;
    if (typeof obj.datasetId === 'string') return obj.datasetId;
  }
  return undefined;
}
