import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '@clerk/react-router';
import {
  listWorkspaces,
  createWorkspace,
  getWorkspaceManifestFromServer,
} from '@/lib/api';
import { fetchFileContent } from '@/lib/workspace';
import type {
  WorkspaceSummaryItem,
  CreateWorkspaceRequestBody,
  WorkspaceFileManifestItem,
} from '@/types/api';
import { toast } from '@/components/ui/sonner';
import { auth } from '@/lib/firebase';

interface CachedWorkspaces {
  userId: string;
  workspaces: WorkspaceSummaryItem[];
}

interface CachedManifestData {
  manifest: WorkspaceFileManifestItem[];
  version: string | number;
}

interface WorkspaceContextState {
  workspaces: WorkspaceSummaryItem[];
  selectedWorkspace: WorkspaceSummaryItem | null;
  currentWorkspaceManifest: WorkspaceFileManifestItem[] | null;
  currentWorkspaceVersion: string | number | null;
  manifestAndVersionCache: Record<string, CachedManifestData>;
  fileContentCache: Record<string, Record<string, string | null>>;
  isLoadingWorkspaces: boolean;
  isLoadingManifest: boolean;
  isLoadingWorkspaceContents: boolean;
  isCreatingWorkspace: boolean;
}

interface WorkspaceContextActions {
  selectWorkspace: (workspace: WorkspaceSummaryItem | null) => void;
  refreshWorkspaces: () => Promise<void>;
  createNewWorkspace: (name: string) => Promise<WorkspaceSummaryItem | null>;
  refreshWorkspace: (workspace: WorkspaceSummaryItem) => Promise<void>;
  setWorkspaceVersion: (version: string | number) => void;
  updateFileContent: (filePath: string, newContent: string) => void;
  addFileToCache: (filePath: string) => void;
  addFolderToCache: (folderPath: string) => void;
  renamePathInCache: (oldPath: string, newPath: string) => void;
  removePathFromCache: (path: string) => void;
}

export type WorkspaceContextType = WorkspaceContextState & WorkspaceContextActions;

const WorkspaceContext = createContext<
  WorkspaceContextType | undefined
>(undefined);

const SESSION_STORAGE_WORKSPACES_KEY = 'app_workspaces';
const SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY = 'app_selected_workspace_id';

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isSignedIn, userId } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryItem[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceSummaryItem | null>(null);
  const [currentWorkspaceManifest, setCurrentWorkspaceManifest] = useState<WorkspaceFileManifestItem[] | null>(null);
  const [currentWorkspaceVersion, setCurrentWorkspaceVersion] = useState<string | number | null>(null);
  const [manifestAndVersionCache, setManifestAndVersionCache] = useState<Record<string, CachedManifestData>>({});
  const [fileContentCache, setFileContentCache] = useState<Record<string, Record<string, string | null>>>({});
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const [isLoadingWorkspaceContents, setIsLoadingWorkspaceContents] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  const resetWorkspaceState = useCallback(() => {
    setWorkspaces([]);
    setSelectedWorkspace(null);
    setCurrentWorkspaceManifest(null);
    setCurrentWorkspaceVersion(null);
    setManifestAndVersionCache({});
    setFileContentCache({});
    setIsLoadingWorkspaces(false);
    setIsLoadingManifest(false);
    setIsLoadingWorkspaceContents(false);
    setIsCreatingWorkspace(false);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_WORKSPACES_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY);
    } catch (error) {
      console.error('Failed to clear session storage:', error);
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    if (!isSignedIn || !userId) {
      return; // Should not happen if called from the main useEffect logic, but a safeguard.
    }
    
    setIsLoadingWorkspaces(true);
    try {
      const token = await auth.currentUser.getIdToken();
      if (!token) throw new Error('Authentication token not available.');
      
      const fetchedWorkspaces = await listWorkspaces(token);
      setWorkspaces(fetchedWorkspaces);

      const cachePayload: CachedWorkspaces = { userId, workspaces: fetchedWorkspaces };
      sessionStorage.setItem(SESSION_STORAGE_WORKSPACES_KEY, JSON.stringify(cachePayload));

    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
      toast.error('Failed to load workspaces.');
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, [isSignedIn, userId]);

  useEffect(() => {
    if (isSignedIn && userId) {
      try {
        const cachedDataJSON = sessionStorage.getItem(SESSION_STORAGE_WORKSPACES_KEY);
        if (cachedDataJSON) {
          const cachedData: CachedWorkspaces = JSON.parse(cachedDataJSON);
          if (cachedData.userId === userId) {
            // Valid cache for the current user exists
            const loadedWorkspaces = cachedData.workspaces;
            setWorkspaces(loadedWorkspaces);

            // Restore selected workspace from session storage
            const lastSelectedId = sessionStorage.getItem(SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY);
            if (lastSelectedId) {
                const workspaceToSelect = loadedWorkspaces.find(ws => ws.workspaceId === lastSelectedId);
                if (workspaceToSelect) {
                    // This will trigger the next useEffect to fetch content
                    setSelectedWorkspace(workspaceToSelect);
                } else {
                    sessionStorage.removeItem(SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY);
                }
            }
            return; // Do not fetch from API
          }
        }
        // If we reach here, cache is invalid (wrong user) or doesn't exist.
        fetchWorkspaces();
      } catch (error) {
        console.error('Failed to process session cache, fetching from server:', error);
        toast.error('Failed to load workspaces. Please try manually refreshing.');
      }
    } else {
      // User is not signed in
      resetWorkspaceState();
    }
  }, [isSignedIn, userId, fetchWorkspaces, resetWorkspaceState]);

  const refreshWorkspace = useCallback(async (workspaceToRefresh: WorkspaceSummaryItem) => {
    const { workspaceId, name } = workspaceToRefresh;
    setIsLoadingManifest(true);
    // We don't clear the selected workspace, just its details
    setCurrentWorkspaceManifest(null); 
    setCurrentWorkspaceVersion(null);
    try {
      const token = await auth.currentUser.getIdToken();
      if (!token) throw new Error('Authentication token not available.');
      
      const manifestResponse = await getWorkspaceManifestFromServer(workspaceId, token);
      const { manifest, workspaceVersion } = manifestResponse;

      setManifestAndVersionCache(prev => ({ ...prev, [workspaceId]: { manifest, version: workspaceVersion } }));
      setCurrentWorkspaceManifest(manifest);
      setCurrentWorkspaceVersion(workspaceVersion);

      if (manifest && manifest.length > 0) {
        setIsLoadingWorkspaceContents(true);
        const newFileContents: Record<string, string | null> = {};
        const contentPromises = manifest.map(async (fileItem) => {
          if (fileItem.type === 'file' && fileItem.contentUrl) {
            const content = await fetchFileContent(fileItem.contentUrl, fileItem.filePath);
            if (content !== null) {
              newFileContents[fileItem.filePath] = content;
            }
          } else if (fileItem.type === 'folder') {
            newFileContents[fileItem.filePath] = null; // Explicitly mark folders
          }
        });
        await Promise.all(contentPromises);
        setFileContentCache(prevCache => ({
          ...prevCache,
          [workspaceId]: { ...(prevCache[workspaceId] || {}), ...newFileContents },
        }));
        setIsLoadingWorkspaceContents(false);
      } else {
         setFileContentCache(prevCache => ({ ...prevCache, [workspaceId]: {} }));
      }
    } catch (error) {
      console.error(`Failed to refresh manifest or contents for ${name}:`, error);
      toast.error(`Failed to refresh workspace data for "${name}".`);
      setCurrentWorkspaceManifest(null);
      setCurrentWorkspaceVersion(null);
    } finally {
      setIsLoadingManifest(false);
      setIsLoadingWorkspaceContents(false);
    }
  }, []);

  const setWorkspaceVersion = useCallback((version: string | number) => {
    setCurrentWorkspaceVersion(version);
    if (selectedWorkspace) {
      setManifestAndVersionCache(prev => ({
        ...prev,
        [selectedWorkspace.workspaceId]: {
          ...prev[selectedWorkspace.workspaceId],
          version: version,
        },
      }));
    }
  }, [selectedWorkspace]);

  const updateFileContent = useCallback((filePath: string, newContent: string) => {
    if (!selectedWorkspace) return;

    setFileContentCache(prevCache => ({
      ...prevCache,
      [selectedWorkspace.workspaceId]: {
        ...(prevCache[selectedWorkspace.workspaceId] || {}),
        [filePath]: newContent,
      },
    }));
  }, [selectedWorkspace]);

  const addFileToCache = useCallback((filePath: string) => {
    if (!selectedWorkspace) return;

    setFileContentCache(prevCache => {
      // Ensure we don't accidentally overwrite something.
      if (prevCache[selectedWorkspace.workspaceId]?.[filePath] !== undefined) {
        return prevCache;
      }
      return {
        ...prevCache,
        [selectedWorkspace.workspaceId]: {
          ...(prevCache[selectedWorkspace.workspaceId] || {}),
          [filePath]: '', // Initialize with empty content
        },
      };
    });
  }, [selectedWorkspace]);

  const addFolderToCache = useCallback((folderPath: string) => {
    if (!selectedWorkspace) return;

    setFileContentCache(prevCache => {
      if (prevCache[selectedWorkspace.workspaceId]?.[folderPath] !== undefined) {
        return prevCache;
      }
      return {
        ...prevCache,
        [selectedWorkspace.workspaceId]: {
          ...(prevCache[selectedWorkspace.workspaceId] || {}),
          [folderPath]: null, // Use null to signify a folder
        },
      };
    });
  }, [selectedWorkspace]);

  const removePathFromCache = useCallback((path: string) => {
    if (!selectedWorkspace) return;

    setFileContentCache(prevCache => {
      const workspaceCache = prevCache[selectedWorkspace.workspaceId];
      if (!workspaceCache) return prevCache;
      
      const newWorkspaceCache = { ...workspaceCache };

      // Remove the file/folder itself
      delete newWorkspaceCache[path];

      // If it's a folder, remove all children
      const pathPrefix = path + '/';
      Object.keys(newWorkspaceCache).forEach(key => {
        if (key.startsWith(pathPrefix)) {
          delete newWorkspaceCache[key];
        }
      });

      return {
        ...prevCache,
        [selectedWorkspace.workspaceId]: newWorkspaceCache,
      };
    });
  }, [selectedWorkspace]);

  const renamePathInCache = useCallback((oldPath: string, newPath: string) => {
    if (!selectedWorkspace) return;

    setFileContentCache(prevCache => {
      const workspaceCache = prevCache[selectedWorkspace.workspaceId];
      if (!workspaceCache) return prevCache;
      
      const newWorkspaceCache = { ...workspaceCache };
      
      // Handle file or empty folder rename
      if (newWorkspaceCache[oldPath] !== undefined) {
        newWorkspaceCache[newPath] = newWorkspaceCache[oldPath];
        delete newWorkspaceCache[oldPath];
      }
      
      // Handle folder content rename by checking for path prefixes
      const oldPathPrefix = oldPath + '/';
      const newPathPrefix = newPath + '/';
      Object.keys(newWorkspaceCache).forEach(key => {
        if (key.startsWith(oldPathPrefix)) {
          const newKey = newPathPrefix + key.substring(oldPathPrefix.length);
          newWorkspaceCache[newKey] = newWorkspaceCache[key];
          delete newWorkspaceCache[key];
        }
      });

      return {
        ...prevCache,
        [selectedWorkspace.workspaceId]: newWorkspaceCache,
      };
    });
  }, [selectedWorkspace]);

  // New effect to handle fetching data when a workspace is selected
  useEffect(() => {
    if (!selectedWorkspace) {
      return; // Nothing to do if no workspace is selected
    }
    const { workspaceId } = selectedWorkspace;

    // Fetch data if it's not in the in-memory cache
    if (!manifestAndVersionCache[workspaceId]) {
      refreshWorkspace(selectedWorkspace);
    } else {
      // If it is in the cache, ensure the context state is aligned.
      // This handles cases where the selection is restored from session storage
      // but the manifest data is already in the (in-memory) cache from the same session.
      const { manifest, version } = manifestAndVersionCache[workspaceId];
      setCurrentWorkspaceManifest(manifest);
      setCurrentWorkspaceVersion(version);
    }
  }, [selectedWorkspace, manifestAndVersionCache, refreshWorkspace]);

  const handleSelectWorkspace = useCallback((workspace: WorkspaceSummaryItem | null) => {
    setSelectedWorkspace(workspace);
    if (workspace) {
      sessionStorage.setItem(SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY, workspace.workspaceId);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY);
    }
  }, []);

  const createNewWorkspace = useCallback(async (name: string): Promise<WorkspaceSummaryItem | null> => {
    if (!isSignedIn) {
      toast.error('You must be signed in to create a workspace.');
      return null;
    }
    setIsCreatingWorkspace(true);
    try {
      const token = await auth.currentUser.getIdToken();
      if (!token) throw new Error('Authentication token not available.');
      const body: CreateWorkspaceRequestBody = { name };
      
      const newWsData = await createWorkspace(body, token) as WorkspaceSummaryItem & { initialVersion?: string | number };
      
      toast.success(`Workspace "${newWsData.name}" created successfully!`);
      
      await fetchWorkspaces(); // Re-fetch to get the new complete list

      const newFullWsSummary = {
        ...newWsData,
        userRole: 'owner',
      };
      
      handleSelectWorkspace(newFullWsSummary);

      return newFullWsSummary;
    } catch (error) {
      console.error('Failed to create workspace:', error);
      toast.error(`Failed to create workspace: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    } finally {
      setIsCreatingWorkspace(false);
    }
  }, [isSignedIn, fetchWorkspaces, handleSelectWorkspace]);

  const value = {
    workspaces,
    selectedWorkspace,
    currentWorkspaceManifest,
    currentWorkspaceVersion,
    manifestAndVersionCache,
    fileContentCache,
    isLoadingWorkspaces,
    isLoadingManifest,
    isLoadingWorkspaceContents,
    isCreatingWorkspace,
    selectWorkspace: handleSelectWorkspace,
    refreshWorkspaces: fetchWorkspaces, // Manual refresh just calls fetch
    createNewWorkspace,
    refreshWorkspace,
    setWorkspaceVersion,
    updateFileContent,
    addFileToCache,
    addFolderToCache,
    renamePathInCache,
    removePathFromCache,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = (): WorkspaceContextType => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}; 