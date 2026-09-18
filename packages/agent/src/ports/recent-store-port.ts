export interface RecentStorePort {
  list(): Promise<string[]>;
  record(path: string): Promise<void>;
}
