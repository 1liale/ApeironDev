import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { WorkspaceConflictError } from "@/types/errors";
import type { ClientFileState } from "@/types/api";
import { useAuth } from "@clerk/react-router";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { auth } from "@/lib/firebase";
import { toast } from "@/components/ui/sonner";
import debounce from "lodash/debounce";
import { getLanguageForExecution } from "@/lib/execution";
import { useJobStatus } from "@/hooks/useJobStatus";
import { useExecuteCode } from "@/hooks/useExecuteCode";
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

  // State for triggering execution
  const [executionTrigger, setExecutionTrigger] = useState<{
    timestamp: number;
    authToken?: string;
    language: string;
    code: string;
    input: string;
    filesInEditor?: ClientFileState[];
  } | null>(null);

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

  // Prepare execution parameters
  const executionParams = executionTrigger
    ? isSignedIn && selectedWorkspace && executionTrigger.authToken && executionTrigger.filesInEditor
      ? {
          type: 'authenticated' as const,
          workspaceId: selectedWorkspace.workspaceId,
          authToken: executionTrigger.authToken,
          filesInEditor: executionTrigger.filesInEditor,
          executionDetails: {
            language: executionTrigger.language,
            entrypointFile: activeFileForExecution,
            input: executionTrigger.input,
          },
          currentLocalManifestItems: currentWorkspaceManifest || [],
          currentLocalWorkspaceVersion: currentWorkspaceVersion?.toString() ?? "0",
          enabled: true,
        }
      : {
          type: 'unauthenticated' as const,
          executionDetails: {
            language: executionTrigger.language,
            code: executionTrigger.code,
            input: executionTrigger.input,
          },
          enabled: true,
        }
    : null;

  // Use the execution hook
  const { data: executionResult, error: executionError, isFetching } = useExecuteCode(
    executionParams || {
      type: 'unauthenticated',
      executionDetails: { language: '', code: '', input: '' },
      enabled: false,
    }
  );

  const handleJobCompletionOrFailure = useCallback(
    (finalMessage: string) => {
      setIsExecuting(false);
      setConsoleOutput((prev) => [...prev, ...finalMessage.split("\n")]);
      setCurrentJobId(null);
      setExecutionTrigger(null); // Reset trigger
    },
    [setIsExecuting, setConsoleOutput],
  );

  useJobStatus(currentJobId, handleJobCompletionOrFailure);

  // Handle execution results
  useEffect(() => {
    if (executionResult && executionTrigger) {
      if ('finalWorkspaceVersion' in executionResult && executionResult.finalWorkspaceVersion) {
        setWorkspaceVersion(executionResult.finalWorkspaceVersion);
        // Only refresh manifest if the workspace version actually changed
        if (executionResult.finalWorkspaceVersion !== currentWorkspaceVersion?.toString()) {
          if (selectedWorkspace) {
            refreshManifestOnly(selectedWorkspace);
          }
        }
      }

      if (executionResult.job_id) {
        toast.success(
          `Execution started successfully at entrypoint: ${activeFileForExecution}, job_id: ${executionResult.job_id}`,
        );
        setCurrentJobId(executionResult.job_id);
      } else {
        handleJobCompletionOrFailure("Error: Failed to start execution.");
      }
    }
  }, [executionResult, executionTrigger, setWorkspaceVersion, currentWorkspaceVersion, selectedWorkspace, refreshManifestOnly, activeFileForExecution, handleJobCompletionOrFailure]);

  // Handle execution errors
  useEffect(() => {
    if (executionError && executionTrigger) {
      let errorMessage = "An unknown error occurred during execution.";
      
      if (executionError instanceof WorkspaceConflictError) {
        // Automatically recover from version conflicts
        if (executionError.newVersion) {
          setWorkspaceVersion(executionError.newVersion);
          toast.info("Workspace version updated, please try again.");
        } else {
          toast.error("Workspace is out of sync", {
            description:
              "A newer version is available. Refreshing will discard your local changes.",
            action: {
              label: "Refresh Now",
              onClick: () => {
                if (selectedWorkspace) {
                  refreshWorkspace(selectedWorkspace);
                }
              },
            },
            duration: Infinity,
          });
        }
        errorMessage = `Execution failed: Workspace conflict could not be resolved automatically.`;
      } else {
        errorMessage = `Execution failed: ${executionError.message}`;
        console.error(errorMessage, executionError);
        toast.error(executionError.message);
      }
      
      handleJobCompletionOrFailure(`Error: ${errorMessage}`);
    }
  }, [executionError, executionTrigger, setWorkspaceVersion, selectedWorkspace, refreshWorkspace, handleJobCompletionOrFailure]);

  // Update executing state based on fetching status
  useEffect(() => {
    if (executionTrigger) {
      setIsExecuting(isFetching);
    }
  }, [isFetching, executionTrigger]);

  const execute = useCallback(async (): Promise<void> => {
    if (!editorRef.current) {
      toast.error("Editor not available.");
      setConsoleOutput((prev) => [...prev, "Error: Editor not available."]);
      return;
    }

    // Prevent concurrent executions
    if (isExecuting) {
      console.warn('⚠️  Execution already in progress, skipping...');
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

    setConsoleOutput((prev) => [...prev, "Executing code..."]);

    try {
      // Prepare execution data
      const timestamp = Date.now();
      let authToken: string | undefined;
      let filesInEditor: ClientFileState[] | undefined;

      if (isSignedIn && selectedWorkspace) {
        authToken = await auth.currentUser?.getIdToken();
        if (!authToken) {
          throw new Error("Authentication token not available for signed-in user.");
        }

        filesInEditor = [];
        const workspaceCache = fileContentCache[selectedWorkspace.workspaceId];

        if (workspaceCache) {
          for (const [filePath, fileContent] of Object.entries(workspaceCache)) {
            filesInEditor.push({
              filePath,
              content: fileContent,
              type: fileContent === null ? "folder" : "file",
            });
          }
        }

        const activeFileIndex = filesInEditor.findIndex(
          (f) => f.filePath === activeFileForExecution,
        );
        if (activeFileIndex !== -1) {
          filesInEditor[activeFileIndex].content = code;
        } else {
          filesInEditor.push({
            filePath: activeFileForExecution,
            content: code,
            type: "file",
          });
        }

        if (filesInEditor.length === 0) {
          toast.error("No files to sync or execute for the workspace.");
          setConsoleOutput((prev) => [...prev, "Error: No files available for authenticated execution."]);
          return;
        }
      }

      // Trigger execution
      setExecutionTrigger({
        timestamp,
        authToken,
        language,
        code,
        input: consoleInputValue,
        filesInEditor,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
      console.error("Error preparing execution:", error);
      toast.error(`Execution failed: ${errorMessage}`);
      setConsoleOutput((prev) => [...prev, `Error: ${errorMessage}`]);
    }
  }, [
    activeFileForExecution,
    consoleInputValue,
    isSignedIn,
    selectedWorkspace,
    fileContentCache,
    isExecuting,
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
