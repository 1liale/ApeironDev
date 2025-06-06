export class WorkspaceConflictError extends Error {
    workspaceId: string;
    newVersion?: string | number;
  
    constructor(message: string, workspaceId: string, newVersion?: string | number) {
      super(message);
      this.name = 'WorkspaceConflictError';
      this.workspaceId = workspaceId;
      this.newVersion = newVersion;
    }
}