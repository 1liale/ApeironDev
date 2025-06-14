import { calculateHash } from "./hashUtils";
import type {
  ClientFileState,
  WorkspaceFileManifestItem,
  SyncFileClientStateAPI,
} from "@/types/api";

/**
 * Creates a deterministic cache key for TanStack Query execution caching
 */
export function createExecutionCacheKey(
  workspaceId: string,
  entrypointFile: string,
  input: string,
  workspaceVersion: string,
  filesInEditor: ClientFileState[]
): string[] {
  const filesHash = calculateFilesContentHash(filesInEditor);
  
  return [
    'executeCodeAuth',
    workspaceId,
    entrypointFile,
    input,
    workspaceVersion,
    filesHash
  ];
}

/**
 * Creates a deterministic hash of all file contents and paths
 */
export function calculateFilesContentHash(files: ClientFileState[]): string {
  const sortedFiles = [...files].sort((a, b) => a.filePath.localeCompare(b.filePath));
  const contentString = sortedFiles
    .map(file => `${file.filePath}:${file.type}:${file.content || ''}`)
    .join('|');
  return calculateHash(contentString);
}

/**
 * Calculates hash for a single file's content
 */
export function calculateFileHash(content: string): string {
  return calculateHash(content);
}

/**
 * Detects and returns all workspace changes as sync states
 */
export function detectWorkspaceChanges(
  filesInEditor: ClientFileState[],
  currentLocalManifestItems: WorkspaceFileManifestItem[]
): SyncFileClientStateAPI[] {
  const localManifestMap = new Map(
    currentLocalManifestItems.map((item) => [item.filePath, item])
  );
  const editorFileMap = new Map(
    filesInEditor.map((file) => [file.filePath, file])
  );
  const changes: SyncFileClientStateAPI[] = [];

  // Check for new and modified files
  for (const file of filesInEditor) {
    const manifestItem = localManifestMap.get(file.filePath);
    
    if (file.type === 'folder') {
      if (!manifestItem) {
        changes.push({ 
          filePath: file.filePath, 
          action: 'new', 
          type: 'folder' 
        });
      }
      continue; // Folders can't be "modified"
    }
    
    // Handle files
    const currentHash = calculateFileHash(file.content ?? '');
    if (!manifestItem) {
      changes.push({
        filePath: file.filePath,
        clientHash: currentHash,
        action: "new",
        type: "file",
      });
    } else if (manifestItem.hash !== currentHash) {
      changes.push({
        filePath: file.filePath,
        clientHash: currentHash,
        action: "modified",
        type: "file",
      });
    }
  }

  // Check for deleted files or folders
  for (const manifestItem of currentLocalManifestItems) {
    if (!editorFileMap.has(manifestItem.filePath)) {
      changes.push({
        filePath: manifestItem.filePath,
        action: "deleted",
        type: manifestItem.type,
      });
    }
  }

  return changes;
}

/**
 * Creates file maps for easier lookup operations
 */
export function createFileMaps(
  filesInEditor: ClientFileState[],
  manifestItems: WorkspaceFileManifestItem[]
) {
  const editorFileMap = new Map(
    filesInEditor.map((file) => [file.filePath, file])
  );
  const manifestMap = new Map(
    manifestItems.map((item) => [item.filePath, item])
  );
  
  return { editorFileMap, manifestMap };
} 