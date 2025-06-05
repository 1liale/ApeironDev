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

interface CachedManifestData {
  manifest: WorkspaceFileManifestItem[];
  version: string | number;
}

interface ActiveFileIdentifier {
  workspaceId: string;
  filePath: string;
}

interface WorkspaceContextState {
  workspaces: WorkspaceSummaryItem[];
  selectedWorkspace: WorkspaceSummaryItem | null;
  currentWorkspaceManifest: WorkspaceFileManifestItem[] | null;
  currentWorkspaceVersion: string | number | null;
  manifestAndVersionCache: Record<string, CachedManifestData>;
  activeFileIdentifier: ActiveFileIdentifier | null;
  activeFileContent: string | null;
  fileContentCache: Record<string, Record<string, string>>;
  isLoadingWorkspaces: boolean;
  isLoadingManifest: boolean;
  isLoadingWorkspaceContents: boolean;
  isCreatingWorkspace: boolean;
}

interface WorkspaceContextActions {
  selectWorkspace: (workspace: WorkspaceSummaryItem | null) => void;
  refreshWorkspaces: () => Promise<void>;
  createNewWorkspace: (name: string) => Promise<WorkspaceSummaryItem | null>;
  selectFileToView: (filePath: string) => void;
}

const WorkspaceContext = createContext<
  (WorkspaceContextState & WorkspaceContextActions) | undefined
>(undefined);

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { getToken, isSignedIn } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryItem[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceSummaryItem | null>(null);
  const [currentWorkspaceManifest, setCurrentWorkspaceManifest] = useState<WorkspaceFileManifestItem[] | null>(null);
  const [currentWorkspaceVersion, setCurrentWorkspaceVersion] = useState<string | number | null>(null);
  const [manifestAndVersionCache, setManifestAndVersionCache] = useState<Record<string, CachedManifestData>>({});

  const [activeFileIdentifier, setActiveFileIdentifier] = useState<ActiveFileIdentifier | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string | null>(null);
  const [fileContentCache, setFileContentCache] = useState<Record<string, Record<string, string>>>({});

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
    setActiveFileIdentifier(null);
    setActiveFileContent(null);
    setFileContentCache({});
    setIsLoadingWorkspaces(false);
    setIsLoadingManifest(false);
    setIsLoadingWorkspaceContents(false);
    setIsCreatingWorkspace(false);
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    if (!isSignedIn) {
      resetWorkspaceState();
      return;
    }
    setIsLoadingWorkspaces(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token not available.');
      const fetchedWorkspaces = await listWorkspaces(token);
      setWorkspaces(fetchedWorkspaces);

      if (selectedWorkspace) {
        const stillExists = fetchedWorkspaces.find(ws => ws.workspaceId === selectedWorkspace.workspaceId);
        if (stillExists) {
          setSelectedWorkspace(stillExists);
        } else {
          setSelectedWorkspace(null);
          setCurrentWorkspaceManifest(null);
          setCurrentWorkspaceVersion(null);
          if (activeFileIdentifier && activeFileIdentifier.workspaceId === selectedWorkspace.workspaceId) {
             setActiveFileIdentifier(null);
             setActiveFileContent(null);
          }
        }
      } else if (fetchedWorkspaces.length === 0) {
         setSelectedWorkspace(null);
         setCurrentWorkspaceManifest(null);
         setCurrentWorkspaceVersion(null);
      }
    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
      toast.error('Failed to load workspaces.');
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, [getToken, isSignedIn, selectedWorkspace, activeFileIdentifier]);

  const handleSelectWorkspace = useCallback(async (workspace: WorkspaceSummaryItem | null) => {
    setSelectedWorkspace(workspace);

    if (!workspace || (activeFileIdentifier && activeFileIdentifier.workspaceId !== workspace.workspaceId)) {
      setActiveFileIdentifier(null);
      setActiveFileContent(null);
    }

    if (!workspace) {
      setCurrentWorkspaceManifest(null);
      setCurrentWorkspaceVersion(null);
      return;
    }

    const { workspaceId } = workspace;

    if (manifestAndVersionCache[workspaceId]) {
      const { manifest, version } = manifestAndVersionCache[workspaceId];
      setCurrentWorkspaceManifest(manifest);
      setCurrentWorkspaceVersion(version);
      toast.info(`Workspace "${workspace.name}" manifest loaded from cache.`);
    } else {
      setIsLoadingManifest(true);
      setCurrentWorkspaceManifest(null);
      setCurrentWorkspaceVersion(null);
      try {
        const token = await getToken();
        if (!token) throw new Error('Authentication token not available.');
        
        const manifestResponse = await getWorkspaceManifestFromServer(workspaceId, token);
        const { manifest, workspaceVersion } = manifestResponse;

        setManifestAndVersionCache(prev => ({ ...prev, [workspaceId]: { manifest, version: workspaceVersion } }));
        setCurrentWorkspaceManifest(manifest);
        setCurrentWorkspaceVersion(workspaceVersion);
        toast.success(`Manifest for "${workspace.name}" loaded.`);
        setIsLoadingManifest(false);

        if (manifest && manifest.length > 0) {
          setIsLoadingWorkspaceContents(true);
          const newFileContents: Record<string, string> = {};
          const contentPromises = manifest.map(async (fileItem) => {
            if (fileItem.contentUrl) {
              const content = await fetchFileContent(fileItem.contentUrl, fileItem.filePath);
              if (content !== null) {
                newFileContents[fileItem.filePath] = content;
              }
            }
          });
          await Promise.all(contentPromises);
          setFileContentCache(prevCache => ({
            ...prevCache,
            [workspaceId]: { ...(prevCache[workspaceId] || {}), ...newFileContents },
          }));
          toast.info(`All files for "${workspace.name}" processed.`);
          setIsLoadingWorkspaceContents(false);
        } else {
           setFileContentCache(prevCache => ({ ...prevCache, [workspaceId]: {} }));
        }

      } catch (error) {
        console.error(`Failed to load manifest or contents for ${workspace.name}:`, error);
        toast.error(`Failed to load workspace data for "${workspace.name}".`);
        setCurrentWorkspaceManifest(null);
        setCurrentWorkspaceVersion(null);
        setIsLoadingManifest(false);
        setIsLoadingWorkspaceContents(false);
      }
    }
  }, [getToken, manifestAndVersionCache, activeFileIdentifier]);

  useEffect(() => {
    if (isSignedIn) {
      fetchWorkspaces();
    } else {
      resetWorkspaceState();
    }
  }, [isSignedIn, fetchWorkspaces, resetWorkspaceState]);

  const refreshWorkspaces = async () => {
    await fetchWorkspaces();
  };

  const createNewWorkspace = async (name: string): Promise<WorkspaceSummaryItem | null> => {
    if (!isSignedIn) {
      toast.error('You must be signed in to create a workspace.');
      return null;
    }
    setIsCreatingWorkspace(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token not available.');
      const body: CreateWorkspaceRequestBody = { name };
      
      const newWsData = await createWorkspace(body, token) as WorkspaceSummaryItem & { initialVersion?: string | number };
      const initialVersion = newWsData.initialVersion || '1';

      toast.success(`Workspace "${newWsData.name}" created successfully!`);
      
      await fetchWorkspaces();

      const newFullWsSummary: WorkspaceSummaryItem = {
        ...newWsData,
        userRole: 'owner',
      };

      setManifestAndVersionCache(prev => ({
        ...prev,
        [newWsData.workspaceId]: { manifest: [], version: initialVersion },
      }));
      setFileContentCache(prev => ({ ...prev, [newWsData.workspaceId]: {} }));
      
      handleSelectWorkspace(newFullWsSummary);

      return newFullWsSummary;
    } catch (error) {
      console.error('Failed to create workspace:', error);
      toast.error(`Failed to create workspace: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const selectFileToView = useCallback((filePath: string) => {
    if (!selectedWorkspace || !filePath) {
      setActiveFileIdentifier(null);
      setActiveFileContent(null);
      return;
    }
    const { workspaceId } = selectedWorkspace;
    setActiveFileIdentifier({ workspaceId, filePath });

    const cachedContent = fileContentCache[workspaceId]?.[filePath];
    if (cachedContent !== undefined) {
      setActiveFileContent(cachedContent);
    } else {
      setActiveFileContent(null);
    }
  }, [selectedWorkspace, fileContentCache]);

  const value = {
    workspaces,
    selectedWorkspace,
    currentWorkspaceManifest,
    currentWorkspaceVersion,
    manifestAndVersionCache,
    activeFileIdentifier,
    activeFileContent,
    fileContentCache,
    isLoadingWorkspaces,
    isLoadingManifest,
    isLoadingWorkspaceContents,
    isCreatingWorkspace,
    selectWorkspace: handleSelectWorkspace,
    refreshWorkspaces,
    createNewWorkspace,
    selectFileToView,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = (): WorkspaceContextState & WorkspaceContextActions => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}; 