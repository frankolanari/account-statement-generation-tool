import type { User, Transaction } from './contracts.js';
export interface AccountRepository {
  findUsers(identifier: string): Promise<User[]>;
  getUser(userId: string): Promise<User | null>;
  fetchTransactions(userId: string, from: string, to: string): Promise<{ rows: Transaction[]; total: number }>;
}
export interface PdfRenderer { render(html: string): Promise<Uint8Array>; }
export interface ArtifactStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
