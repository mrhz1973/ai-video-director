/**
 * Server entry for batch queue plan helpers (Node UUID factory).
 * Browser code must import ./batch-queue-plan-core.mjs directly.
 */

import { randomUUID } from "node:crypto";
import { setBatchQueuePlanRandomIdFactory } from "./batch-queue-plan-core.mjs";

setBatchQueuePlanRandomIdFactory(() => randomUUID());

export * from "./batch-queue-plan-core.mjs";
