import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { WorkspaceConflictError } from "@/types/errors";
import type { ClientFileState, WorkspaceFileManifestItem } from "@/types/api";
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

// Type for execution parameters
type ExecutionParams = {
  type: 'authenticated';
  workspaceId: string;
  authToken: string;
  filesInEditor: ClientFileState[];
  executionDetails: {
    language: string;
    entrypointFile: string;
    input: string;
  };
  currentLocalManifestItems: WorkspaceFileManifestItem[];
  currentLocalWorkspaceVersion: string;
  enabled: boolean;
} | {
  type: 'unauthenticated';
  executionDetails: {
    language: string;
    code: string;
    input: string;
  };
  enabled: boolean;
};

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
  // Editor and UI state
  const editorRef = useRef<{ getValue: () => string } | null>(null);
  const [consoleInputValue, setConsoleInputValue] = useState("");
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [activeFileForExecution, setActiveFileForExecution] = useState<string>("main.py");
  
  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [executionParams, setExecutionParams] = useState<ExecutionParams | null>(null);

  // Context dependencies
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

  // Execute code hook
  const { data: executionResult, error: executionError, isFetching } = useExecuteCode(
    executionParams || {
      type: 'unauthenticated',
      executionDetails: { language: '', code: '', input: '' },
      enabled: false,
    }
  );

  // Job completion handler
  const handleJobCompletion = useCallback((finalMessage: string) => {
    setIsExecuting(false);
    setConsoleOutput((prev) => [...prev, ...finalMessage.split("\n")]);
    setCurrentJobId(null);
    setExecutionParams(null); // Reset execution params
  }, []);

  // Job status monitoring
  useJobStatus(currentJobId, handleJobCompletion);

  // Prepare authenticated execution data
  const prepareAuthenticatedExecution = useCallback(async (code: string, language: string) => {
    if (!selectedWorkspace) {
      throw new Error("No workspace selected");
    }

    const authToken = await auth.currentUser?.getIdToken();
    if (!authToken) {
      throw new Error("Authentication token not available for signed-in user.");
    }

    const filesInEditor: ClientFileState[] = [];
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

    // Update active file with current editor content
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
      throw new Error("No files available for authenticated execution.");
    }

    return {
      type: 'authenticated' as const,
      workspaceId: selectedWorkspace.workspaceId,
      authToken,
      filesInEditor,
      executionDetails: {
        language,
        entrypointFile: activeFileForExecution,
        input: consoleInputValue,
      },
      currentLocalManifestItems: currentWorkspaceManifest || [],
      currentLocalWorkspaceVersion: currentWorkspaceVersion?.toString() ?? "0",
      enabled: true,
    };
  }, [selectedWorkspace, fileContentCache, activeFileForExecution, consoleInputValue, currentWorkspaceManifest, currentWorkspaceVersion]);

  // Prepare unauthenticated execution data
  const prepareUnauthenticatedExecution = useCallback((code: string, language: string) => {
    return {
      type: 'unauthenticated' as const,
      executionDetails: {
        language,
        code,
        input: consoleInputValue,
      },
      enabled: true,
    };
  }, [consoleInputValue]);

  // Handle execution success
  const handleExecutionSuccess = useCallback((result: { finalWorkspaceVersion?: string; job_id?: string }) => {
    // Handle workspace version updates for authenticated execution
    if ('finalWorkspaceVersion' in result && result.finalWorkspaceVersion) {
      setWorkspaceVersion(result.finalWorkspaceVersion);
      
      // Refresh manifest if workspace version changed
      if (result.finalWorkspaceVersion !== currentWorkspaceVersion?.toString()) {
        if (selectedWorkspace) {
          refreshManifestOnly(selectedWorkspace);
        }
      }
    }

    // Handle job ID for monitoring
    if (result.job_id) {
      toast.success(
        `Execution started successfully at entrypoint: ${activeFileForExecution}, job_id: ${result.job_id}`,
      );
      setCurrentJobId(result.job_id);
    } else {
      handleJobCompletion("Error: Failed to start execution.");
    }
  }, [currentWorkspaceVersion, selectedWorkspace, activeFileForExecution, setWorkspaceVersion, refreshManifestOnly, handleJobCompletion]);

  // Handle execution error
  const handleExecutionError = useCallback((error: Error) => {
    let errorMessage = "An unknown error occurred during execution.";
    
    if (error instanceof WorkspaceConflictError) {
      // Handle workspace conflicts
      if (error.newVersion) {
        setWorkspaceVersion(error.newVersion);
        toast.info("Workspace version updated, please try again.");
      } else {
        toast.error("Workspace is out of sync", {
          description: "A newer version is available. Refreshing will discard your local changes.",
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
      errorMessage = `Execution failed: ${error.message}`;
      console.error(errorMessage, error);
      toast.error(error.message);
    }
    
    handleJobCompletion(`Error: ${errorMessage}`);
  }, [selectedWorkspace, setWorkspaceVersion, refreshWorkspace, handleJobCompletion]);

  // Main execution function
  const executeCode = useCallback(async (): Promise<void> => {
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
      toast.error(`Language for "${activeFileForExecution}" is not supported.`);
      return;
    }

    setConsoleOutput((prev) => [...prev, "Executing code..."]);

    try {
      // Prepare execution parameters based on authentication state
      const params = isSignedIn && selectedWorkspace
        ? await prepareAuthenticatedExecution(code, language)
        : prepareUnauthenticatedExecution(code, language);

      // Trigger execution
      setExecutionParams(params);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
      console.error("Error preparing execution:", error);
      toast.error(`Execution failed: ${errorMessage}`);
      setConsoleOutput((prev) => [...prev, `Error: ${errorMessage}`]);
    }
  }, [
    activeFileForExecution,
    isSignedIn,
    selectedWorkspace,
    isExecuting,
    prepareAuthenticatedExecution,
    prepareUnauthenticatedExecution,
  ]);

  // Handle execution result or error changes in a single effect
  useEffect(() => {
    if (!executionParams) return;

    if (executionResult) {
      handleExecutionSuccess(executionResult);
    } else if (executionError) {
      handleExecutionError(executionError);
    }
  }, [executionResult, executionError, executionParams, handleExecutionSuccess, handleExecutionError]);

  // Update executing state based on fetching status
  useEffect(() => {
    if (executionParams) {
      setIsExecuting(isFetching);
    }
  }, [isFetching, executionParams]);

  // Debounced execution
  const debouncedExecute = debounce(executeCode, 1000);

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
