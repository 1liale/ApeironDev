import { useQuery } from '@tanstack/react-query';
import { executeCodeAuth, executeCode, createExecutionCacheKey, calculateHash } from '@/lib';
import type {
  ClientFileState,
  WorkspaceFileManifestItem,
  ExecuteAuthRequestBody,
  ExecuteCodeAuthResponse,
  ExecuteRequestBody,
  ExecuteResponse,
} from '@/types/api';

// Authenticated execution parameters
interface UseExecuteCodeAuthParams {
  type: 'authenticated';
  workspaceId: string;
  authToken: string;
  filesInEditor: ClientFileState[];
  executionDetails: ExecuteAuthRequestBody;
  currentLocalManifestItems: WorkspaceFileManifestItem[];
  currentLocalWorkspaceVersion: string;
  enabled?: boolean;
}

// Unauthenticated execution parameters
interface UseExecuteCodeAnonParams {
  type: 'unauthenticated';
  executionDetails: ExecuteRequestBody;
  enabled?: boolean;
}

type UseExecuteCodeParams = UseExecuteCodeAuthParams | UseExecuteCodeAnonParams;

/**
 * Hook for executing code with automatic caching for both authenticated and unauthenticated execution
 * 
 * For authenticated execution:
 * - Caches based on workspace ID, entrypoint, input, workspace version, and file content hash
 * - When there are no workspace changes, returns cached results instantly
 * - When there are workspace changes, performs full sync + execute
 * 
 * For unauthenticated execution:
 * - Caches based on language, code content hash, and input
 * - Returns cached results for identical code + input combinations
 */
export function useExecuteCode(params: UseExecuteCodeParams) {
  const { enabled = true } = params;

  // Generate cache key based on execution type
  const queryKey = params.type === 'authenticated' 
    ? createExecutionCacheKey(
        params.workspaceId,
        params.executionDetails.entrypointFile,
        params.executionDetails.input || '',
        params.currentLocalWorkspaceVersion,
        params.filesInEditor
      )
    : [
        'executeCodeAnon',
        params.executionDetails.language,
        calculateHash(params.executionDetails.code),
        params.executionDetails.input || ''
      ];

  // Query function based on execution type
  const queryFn = () => {
    if (params.type === 'authenticated') {
      return executeCodeAuth(
        params.workspaceId,
        params.authToken,
        params.filesInEditor,
        params.executionDetails,
        params.currentLocalManifestItems,
        params.currentLocalWorkspaceVersion
      );
    } else {
      return executeCode(params.executionDetails);
    }
  };

  return useQuery<ExecuteCodeAuthResponse | ExecuteResponse, Error>({
    queryKey,
    queryFn,
    enabled,
    // Cache never expires - same code/workspace should always produce same output
    staleTime: Infinity,
    // Keep in cache for 30 minutes after last use
    gcTime: 30 * 60 * 1000,
    // Don't retry on workspace conflicts or auth errors
    retry: (failureCount, error) => {
      if (error.message.includes('workspace_conflict') || 
          error.message.includes('401') || 
          error.message.includes('403')) {
        return false;
      }
      return failureCount < 2;
    },
  });
} 