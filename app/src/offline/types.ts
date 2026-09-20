import type { AddTxnArgs } from '@/api/types';

export interface QueuedTxn {
  id: string;
  args: AddTxnArgs;
  createdAt: string;
  attempts: number;
  error: string | null;
}

export interface QueueStorage {
  all(): Promise<QueuedTxn[]>;
  put(item: QueuedTxn): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CacheEntry {
  value: unknown;
  at: string;
}

export interface CacheStorage {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: unknown): Promise<void>;
}

export type SendOutcome = { kind: 'ok' } | { kind: 'network' } | { kind: 'rejected'; message: string };
