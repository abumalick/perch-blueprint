export interface Viewer {
  detach: () => void;
}

export class ViewerRegistry {
  private readonly holders = new Map<string, Viewer>();

  acquire(workspaceId: string, viewer: Viewer): void {
    const current = this.holders.get(workspaceId);
    if (current && current !== viewer) {
      current.detach();
    }
    this.holders.set(workspaceId, viewer);
  }

  release(workspaceId: string, viewer: Viewer): void {
    if (this.holders.get(workspaceId) === viewer) {
      this.holders.delete(workspaceId);
    }
  }
}
