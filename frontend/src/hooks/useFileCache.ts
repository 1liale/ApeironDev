import { useState, useCallback } from "react";
import type { WorkspaceSummaryItem } from "@/types/api";

export const useFileCache = (
  selectedWorkspace: WorkspaceSummaryItem | null,
) => {
  const [fileContentCache, setFileContentCache] = useState<
    Record<string, Record<string, string | null>>
  >({});

  const updateFileContent = useCallback(
    (filePath: string, newContent: string) => {
      if (!selectedWorkspace) return;
      const { workspaceId } = selectedWorkspace;

      setFileContentCache((prevCache) => ({
        ...prevCache,
        [workspaceId]: {
          ...(prevCache[workspaceId] || {}),
          [filePath]: newContent,
        },
      }));
    },
    [selectedWorkspace],
  );

  const addFileToCache = useCallback(
    (filePath: string) => {
      if (!selectedWorkspace) return;
      const { workspaceId } = selectedWorkspace;

      setFileContentCache((prevCache) => {
        if (prevCache[workspaceId]?.[filePath] !== undefined) {
          return prevCache;
        }
        return {
          ...prevCache,
          [workspaceId]: {
            ...(prevCache[workspaceId] || {}),
            [filePath]: "", // Initialize with empty content
          },
        };
      });
    },
    [selectedWorkspace],
  );

  const addFolderToCache = useCallback(
    (folderPath: string) => {
      if (!selectedWorkspace) return;
      const { workspaceId } = selectedWorkspace;

      setFileContentCache((prevCache) => {
        if (prevCache[workspaceId]?.[folderPath] !== undefined) {
          return prevCache;
        }
        return {
          ...prevCache,
          [workspaceId]: {
            ...(prevCache[workspaceId] || {}),
            [folderPath]: null, // Use null to signify a folder
          },
        };
      });
    },
    [selectedWorkspace],
  );

  const removePathFromCache = useCallback(
    (path: string) => {
      if (!selectedWorkspace) return;
      const { workspaceId } = selectedWorkspace;

      setFileContentCache((prevCache) => {
        const workspaceCache = prevCache[workspaceId];
        if (!workspaceCache) return prevCache;

        const newWorkspaceCache = { ...workspaceCache };

        // Remove the file/folder itself
        delete newWorkspaceCache[path];

        // If it's a folder, remove all children
        const pathPrefix = path + "/";
        Object.keys(newWorkspaceCache).forEach((key) => {
          if (key.startsWith(pathPrefix)) {
            delete newWorkspaceCache[key];
          }
        });

        return {
          ...prevCache,
          [workspaceId]: newWorkspaceCache,
        };
      });
    },
    [selectedWorkspace],
  );

  const renamePathInCache = useCallback(
    (oldPath: string, newPath: string) => {
      if (!selectedWorkspace) return;
      const { workspaceId } = selectedWorkspace;

      setFileContentCache((prevCache) => {
        const workspaceCache = prevCache[workspaceId];
        if (!workspaceCache) return prevCache;

        const newWorkspaceCache = { ...workspaceCache };

        // Handle file or empty folder rename
        if (newWorkspaceCache[oldPath] !== undefined) {
          newWorkspaceCache[newPath] = newWorkspaceCache[oldPath];
          delete newWorkspaceCache[oldPath];
        }

        // Handle folder content rename by checking for path prefixes
        const oldPathPrefix = oldPath + "/";
        const newPathPrefix = newPath + "/";
        Object.keys(newWorkspaceCache).forEach((key) => {
          if (key.startsWith(oldPathPrefix)) {
            const newKey = newPathPrefix + key.substring(oldPathPrefix.length);
            newWorkspaceCache[newKey] = newWorkspaceCache[key];
            delete newWorkspaceCache[key];
          }
        });

        return {
          ...prevCache,
          [workspaceId]: newWorkspaceCache,
        };
      });
    },
    [selectedWorkspace],
  );

  return {
    fileContentCache,
    setFileContentCache,
    updateFileContent,
    addFileToCache,
    addFolderToCache,
    removePathFromCache,
    renamePathInCache,
  };
}; 