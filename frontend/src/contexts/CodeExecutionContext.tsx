import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
} from "react";
import { executeCodeAuth, executeCode } from "@/lib/api";
import { WorkspaceConflictError } from "@/types/errors";
import type { ExecuteRequestBody, ClientFileState } from "@/types/api";
import { useAuth } from "@clerk/react-router";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { auth } from "@/lib/firebase";
import { toast } from "@/components/ui/sonner";
import debounce from "lodash/debounce";
import { getLanguageForExecution } from "@/lib/execution";
import { useJobStatus } from "@/hooks/useJobStatus";
import type {
  CodeExecutionContextType,
  CodeExecutionProviderProps,
} from "@/types/contexts";

const CodeExecutionContext = createContext<
  CodeExecutionContextType | undefined
>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useCodeExecutionContext = (): CodeExecutionContextType => {
  const context = useContext(CodeExecutionContext);
  if (!context) {
    throw new Error(
      "useCodeExecutionContext must be used within a CodeExecutionProvider",
    );
  }
  return context;
};

export const CodeExecutionProvider = ({
  children,
}: CodeExecutionProviderProps) => {
  const editorRef = useRef<{ getValue: () => string } | null>(null);
  const [consoleInputValue, setConsoleInputValue] = useState("");
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [activeFileForExecution, setActiveFileForExecution] =
    useState<string>("main.py");

  const { isSignedIn } = useAuth();
  const {
    selectedWorkspace,
    currentWorkspaceManifest,
    currentWorkspaceVersion,
    fileContentCache,
    setWorkspaceVersion,
    refreshWorkspace,
    refreshManifestOnly,
  } = useWorkspace();

  const handleJobCompletionOrFailure = useCallback(
    (finalMessage: string) => {
      setIsExecuting(false);
      setConsoleOutput((prev) => [...prev, ...finalMessage.split("\n")]);
      setCurrentJobId(null);
    },
    [setIsExecuting, setConsoleOutput],
  );

  useJobStatus(currentJobId, handleJobCompletionOrFailure);

  const executeAuthenticated = useCallback(
    async (
      language: ExecuteRequestBody["language"],
      code: string,
      input: string,
      isRetry: boolean = false
    ) => {
      // Prevent concurrent executions that could cause version conflicts
      if (isExecuting) {
        console.warn('⚠️  Execution already in progress, skipping...');
        return;
      }
      
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          throw new Error(
            "Authentication token not available for signed-in user.",
          );
        }

        if (!selectedWorkspace) {
          throw new Error("No workspace selected for authenticated execution.");
        }

        const filesInEditorForSync: ClientFileState[] = [];
        const workspaceCache = fileContentCache[selectedWorkspace.workspaceId];

        if (workspaceCache) {
          for (const [filePath, fileContent] of Object.entries(
            workspaceCache,
          )) {
            filesInEditorForSync.push({
              filePath,
              content: fileContent,
              type: fileContent === null ? "folder" : "file",
            });
          }
        }

        const activeFileIndex = filesInEditorForSync.findIndex(
          (f) => f.filePath === activeFileForExecution,
        );
        if (activeFileIndex !== -1) {
          filesInEditorForSync[activeFileIndex].content = code;
        } else {
          filesInEditorForSync.push({
            filePath: activeFileForExecution,
            content: code,
            type: "file",
          });
        }

        if (filesInEditorForSync.length === 0) {
          toast.error("No files to sync or execute for the workspace.");
          handleJobCompletionOrFailure(
            "Error: No files available for authenticated execution.",
          );
          return;
        }

        const response = await executeCodeAuth(
          selectedWorkspace.workspaceId,
          token,
          filesInEditorForSync,
          {
            language,
            entrypointFile: activeFileForExecution,
            input,
          },
          currentWorkspaceManifest || [],
          currentWorkspaceVersion?.toString() ?? "0",
        );

        if (response.finalWorkspaceVersion) {
          setWorkspaceVersion(response.finalWorkspaceVersion);
          // Only refresh manifest if the workspace version actually changed
          // This reduces unnecessary API calls to the backend
          if (response.finalWorkspaceVersion !== currentWorkspaceVersion?.toString()) {
            await refreshManifestOnly(selectedWorkspace);
          }
        }

        if (!response.job_id) {
          handleJobCompletionOrFailure("Error: Failed to start execution.");
          return;
        }

        toast.success(
          `Execution started successfully at entrypoint: ${activeFileForExecution}, job_id: ${response.job_id}`,
        );
        setCurrentJobId(response.job_id);
      } catch (err) {
        let errorMessage =
          "An unknown error occurred during authenticated execution.";
        if (err instanceof WorkspaceConflictError) {
          // Automatically recover from version conflicts
          if (err.newVersion && !isRetry) {
            setWorkspaceVersion(err.newVersion);
            toast.info("Workspace version updated, retrying...");
            // Retry once with the updated version, with longer delay to ensure state propagation
            setTimeout(() => executeAuthenticated(language, code, input, true), 500);
            return;
          } else {
            toast.error("Workspace is out of sync", {
              description:
                "A newer version is available. Refreshing will discard your local changes.",
              action: {
                label: "Refresh Now",
                onClick: () =>
                  selectedWorkspace && refreshWorkspace(selectedWorkspace),
              },
              duration: Infinity,
            });
            errorMessage = `Execution failed: Workspace conflict could not be resolved automatically.`;
          }
        } else if (err instanceof Error) {
          errorMessage = `API call to /execute-auth failed: ${err.message}`;
          console.error(errorMessage, err);
          toast.error(err.message);
        }
        handleJobCompletionOrFailure(`Error: ${errorMessage}`);
      }
    },
    [
      activeFileForExecution,
      currentWorkspaceManifest,
      currentWorkspaceVersion,
      fileContentCache,
      handleJobCompletionOrFailure,
      refreshWorkspace,
      selectedWorkspace,
      setWorkspaceVersion,
      refreshManifestOnly,
      isExecuting,
    ],
  );

  const executeAnonymous = useCallback(
    async (
      language: ExecuteRequestBody["language"],
      code: string,
      input: string,
    ) => {
      try {
        const response = await executeCode({
          language,
          code,
          input,
        });

        if (response.error || !response.job_id) {
          handleJobCompletionOrFailure(
            `Error: ${response.error || "Failed to start execution."}`,
          );
          return;
        }
        setCurrentJobId(response.job_id);
        toast.success(
          `Execution started successfully at entrypoint: ${activeFileForExecution}, job_id: ${response.job_id}`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred";
        console.error("API call to /execute failed:", error);
        toast.error(`Anonymous execution failed: ${errorMessage}`);
        handleJobCompletionOrFailure(`Error: ${errorMessage}`);
      }
    },
    [activeFileForExecution, handleJobCompletionOrFailure],
  );

  const execute = useCallback(async (): Promise<void> => {
    if (!editorRef.current) {
      toast.error("Editor not available.");
      setConsoleOutput((prev) => [...prev, "Error: Editor not available."]);
      return;
    }

    const code = editorRef.current.getValue();
    const language = getLanguageForExecution(activeFileForExecution);

    if (!language) {
      toast.error(
        `Language for "${activeFileForExecution}" is not supported.`,
      );
      return;
    }

    setIsExecuting(true);
    setConsoleOutput((prev) => [...prev, "Executing code..."]);

    if (isSignedIn && selectedWorkspace) {
      await executeAuthenticated(language, code, consoleInputValue);
    } else {
      await executeAnonymous(language, code, consoleInputValue);
    }
  }, [
    activeFileForExecution,
    consoleInputValue,
    isSignedIn,
    selectedWorkspace,
    executeAuthenticated,
    executeAnonymous,
  ]);

  const debouncedExecute = debounce(execute, 1000);

  const contextValue: CodeExecutionContextType = {
    editorRef,
    consoleInputValue,
    setConsoleInputValue,
    consoleOutput,
    setConsoleOutput,
    isExecuting,
    setIsExecuting,
    triggerExecution: debouncedExecute,
    currentJobId,
    activeFileForExecution,
    setActiveFileForExecution,
  };

  return (
    <CodeExecutionContext.Provider value={contextValue}>
      {children}
    </CodeExecutionContext.Provider>
  );
};
