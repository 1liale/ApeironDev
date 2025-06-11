import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useAuth } from "@clerk/react-router";
import { listWorkspaces, createWorkspace } from "@/lib/api";
import { fetchWorkspaceDetails } from "@/lib/workspace";
import type {
  WorkspaceSummaryItem,
  CreateWorkspaceRequestBody,
  WorkspaceFileManifestItem,
  ClientSideWorkspaceFileManifestItem,
} from "@/types/api";
import type {
  WorkspaceContextType,
  CachedWorkspaces,
  CachedManifestData,
} from "@/types/contexts";
import { toast } from "@/components/ui/sonner";
import { auth } from "@/lib/firebase";
import { useFileCache } from "@/hooks/useFileCache";

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined,
);

const SESSION_STORAGE_WORKSPACES_KEY = "app_workspaces";
const SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY = "app_selected_workspace_id";

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { isSignedIn, userId } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryItem[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<WorkspaceSummaryItem | null>(null);
  const [
    currentWorkspaceManifest,
    setCurrentWorkspaceManifest,
  ] = useState<WorkspaceFileManifestItem[] | null>(null);
  const [currentWorkspaceVersion, setCurrentWorkspaceVersion] = useState<
    string | number | null
  >(null);
  const [manifestAndVersionCache, setManifestAndVersionCache] = useState<
    Record<string, CachedManifestData>
  >({});
  const {
    fileContentCache,
    setFileContentCache,
    updateFileContent,
    addFileToCache,
    addFolderToCache,
    renamePathInCache,
    removePathFromCache,
  } = useFileCache(selectedWorkspace);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const [isLoadingWorkspaceContents, setIsLoadingWorkspaceContents] =
    useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  const updateCurrentWorkspaceManifest = useCallback(
    (newManifest: ClientSideWorkspaceFileManifestItem[]) => {
      const updatedManifest = newManifest.map((clientItem) => {
        const existingItem = currentWorkspaceManifest?.find(
          (item) => item.filePath === clientItem.filePath,
        );
        if (existingItem) {
          return { ...existingItem, ...clientItem };
        }
        // For new items, we won't have all the backend data, so we create a partial manifest item.
        // This is acceptable because this manifest is for client-side logic, not for backend updates
        // that require all fields. The backend will regenerate these fields on the next sync.
        return {
          ...clientItem,
          fileId: "", // Placeholder
          r2ObjectKey: "", // Placeholder
          hash: null, // Placeholder
          contentUrl: null, // Placeholder
          createdAt: new Date().toISOString(), // Placeholder
          updatedAt: new Date().toISOString(), // Placeholder
        };
      });

      setCurrentWorkspaceManifest(updatedManifest);
      if (selectedWorkspace) {
        setManifestAndVersionCache((prev) => ({
          ...prev,
          [selectedWorkspace.workspaceId]: {
            ...prev[selectedWorkspace.workspaceId],
            manifest: updatedManifest,
          },
        }));
      }
    },
    [selectedWorkspace, currentWorkspaceManifest],
  );

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
      console.error("Failed to clear session storage:", error);
    }
  }, [setFileContentCache]);

  const fetchWorkspaces = useCallback(async () => {
    if (!isSignedIn || !userId) {
      return;
    }

    setIsLoadingWorkspaces(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Authentication token not available.");

      const fetchedWorkspaces = await listWorkspaces(token);
      setWorkspaces(fetchedWorkspaces);

      const cachePayload: CachedWorkspaces = {
        userId,
        workspaces: fetchedWorkspaces,
      };
      sessionStorage.setItem(
        SESSION_STORAGE_WORKSPACES_KEY,
        JSON.stringify(cachePayload),
      );
    } catch (error) {
      console.error("Failed to fetch workspaces:", error);
      toast.error("Failed to load workspaces.");
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, [isSignedIn, userId]);

  useEffect(() => {
    if (isSignedIn && userId) {
      try {
        const cachedDataJSON = sessionStorage.getItem(
          SESSION_STORAGE_WORKSPACES_KEY,
        );
        if (cachedDataJSON) {
          const cachedData: CachedWorkspaces = JSON.parse(cachedDataJSON);
          if (cachedData.userId === userId) {
            const loadedWorkspaces = cachedData.workspaces;
            setWorkspaces(loadedWorkspaces);

            const lastSelectedId = sessionStorage.getItem(
              SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY,
            );
            if (lastSelectedId) {
              const workspaceToSelect = loadedWorkspaces.find(
                (ws) => ws.workspaceId === lastSelectedId,
              );
              if (workspaceToSelect) {
                setSelectedWorkspace(workspaceToSelect);
              } else {
                sessionStorage.removeItem(
                  SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY,
                );
              }
            }
            return;
          }
        }
        fetchWorkspaces();
      } catch (error) {
        console.error(
          "Failed to process session cache, fetching from server:",
          error,
        );
        toast.error("Failed to load workspaces. Please try manually refreshing.");
      }
    } else {
      resetWorkspaceState();
    }
  }, [isSignedIn, userId, fetchWorkspaces, resetWorkspaceState]);

  const refreshWorkspace = useCallback(
    async (workspaceToRefresh: WorkspaceSummaryItem) => {
      const { workspaceId, name } = workspaceToRefresh;
      setIsLoadingManifest(true);
      setIsLoadingWorkspaceContents(true);
      setCurrentWorkspaceManifest(null);
      setCurrentWorkspaceVersion(null);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Authentication token not available.");

        const {
          manifest,
          workspaceVersion,
          fileContents,
        } = await fetchWorkspaceDetails(workspaceId, token);

        setManifestAndVersionCache((prev) => ({
          ...prev,
          [workspaceId]: { manifest, version: workspaceVersion },
        }));
        setCurrentWorkspaceManifest(manifest);
        setCurrentWorkspaceVersion(workspaceVersion);

        if (Object.keys(fileContents).length > 0) {
          setFileContentCache((prevCache) => ({
            ...prevCache,
            [workspaceId]: {
              ...(prevCache[workspaceId] || {}),
              ...fileContents,
            },
          }));
        } else {
          setFileContentCache((prevCache) => ({
            ...prevCache,
            [workspaceId]: {},
          }));
        }
      } catch (error) {
        console.error(
          `Failed to refresh manifest or contents for ${name}:`,
          error,
        );
        toast.error(`Failed to refresh workspace data for "${name}".`);
        setCurrentWorkspaceManifest(null);
        setCurrentWorkspaceVersion(null);
      } finally {
        setIsLoadingManifest(false);
        setIsLoadingWorkspaceContents(false);
      }
    },
    [setFileContentCache],
  );

  const setWorkspaceVersion = useCallback(
    (version: string | number) => {
      setCurrentWorkspaceVersion(version);
      if (selectedWorkspace) {
        setManifestAndVersionCache((prev) => ({
          ...prev,
          [selectedWorkspace.workspaceId]: {
            ...prev[selectedWorkspace.workspaceId],
            version: version,
          },
        }));
      }
    },
    [selectedWorkspace],
  );

  useEffect(() => {
    if (!selectedWorkspace) {
      return;
    }
    const { workspaceId } = selectedWorkspace;

    if (!manifestAndVersionCache[workspaceId]) {
      refreshWorkspace(selectedWorkspace);
    } else {
      const { manifest, version } = manifestAndVersionCache[workspaceId];
      setCurrentWorkspaceManifest(manifest);
      setCurrentWorkspaceVersion(version);
    }
  }, [selectedWorkspace, manifestAndVersionCache, refreshWorkspace]);

  const handleSelectWorkspace = useCallback(
    (workspace: WorkspaceSummaryItem | null) => {
      setSelectedWorkspace(workspace);
      if (workspace) {
        sessionStorage.setItem(
          SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY,
          workspace.workspaceId,
        );
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_SELECTED_WORKSPACE_ID_KEY);
      }
    },
    [],
  );

  const createNewWorkspace = useCallback(
    async (name: string): Promise<WorkspaceSummaryItem | null> => {
      if (!isSignedIn) {
        toast.error("You must be signed in to create a workspace.");
        return null;
      }

      setIsCreatingWorkspace(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Authentication token not available.");
        const body: CreateWorkspaceRequestBody = { name };

        const newWsData = (await createWorkspace(
          body,
          token,
        )) as WorkspaceSummaryItem & { initialVersion?: string | number };

        toast.success(`Workspace "${newWsData.name}" created successfully!`);

        await fetchWorkspaces();

        const newFullWsSummary = {
          ...newWsData,
          userRole: "owner" as const,
        };

        handleSelectWorkspace(newFullWsSummary);

        return newFullWsSummary;
      } catch (error) {
        console.error("Failed to create workspace:", error);
        toast.error(
          `Failed to create workspace: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        return null;
      } finally {
        setIsCreatingWorkspace(false);
      }
    },
    [isSignedIn, fetchWorkspaces, handleSelectWorkspace],
  );

  const value: WorkspaceContextType = {
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
    refreshWorkspaces: fetchWorkspaces,
    createNewWorkspace,
    refreshWorkspace,
    setWorkspaceVersion,
    updateFileContent,
    addFileToCache,
    addFolderToCache,
    renamePathInCache,
    removePathFromCache,
    updateCurrentWorkspaceManifest,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = (): WorkspaceContextType => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}; 