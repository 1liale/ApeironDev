import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  ReactNode,
  useEffect,
} from "react";
import { executeCodeAuth, executeCode } from "@/lib/api";
import { WorkspaceConflictError } from "@/types/errors";
import type { ExecuteRequestBody, ClientFileState } from "@/types/api";
import { useAuth } from "@clerk/react-router";
import { useWorkspace, WorkspaceContextType } from "@/contexts/WorkspaceContext";
import { auth, firestoreDB } from "@/lib/firebase"; // Firebase integration
import { doc, onSnapshot } from "firebase/firestore"; // Firestore functions
import { toast } from "@/components/ui/sonner"; // For error notifications

const JOBS_COLLECTION_ID = import.meta.env.VITE_FIRESTORE_JOBS_COLLECTION;

// Custom debounce function
// Accepts a function F that takes specific arguments (T) and returns Promise<void> or void (R).
const customDebounce = <T extends unknown[], R extends void | Promise<void>>(
  func: (...args: T) => R,
  waitFor: number
) => {
  let timeout: NodeJS.Timeout | null = null;

  const debounced = (...args: T): Promise<void> => {
    return new Promise((resolve) => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(async () => {
        await func(...args);
        resolve();
      }, waitFor);
    });
  };

  return debounced;
};

// Interface for the structure we expect from Firestore for job documents (snake_case)
interface FirestoreJobDocument {
  status: "queued" | "processing" | "completed" | "failed"; // snake_case
  output?: string; // snake_case
  error?: string;
}

export interface CodeExecutionContextType {
  // Use a more generic type for the ref here to avoid direct monaco-editor import issues in this file.
  // The actual strong type is enforced in EditorPanel.tsx where the ref is created and assigned.
  editorRef: React.RefObject<{ getValue: () => string } | null>;
  consoleInputValue: string;
  setConsoleInputValue: (value: string) => void;
  consoleOutput: string[];
  setConsoleOutput: (
    output: string[] | ((prevOutput: string[]) => string[])
  ) => void;
  isExecuting: boolean;
  setIsExecuting: (isExecuting: boolean) => void;
  triggerExecution: () => Promise<void>; // Debounced function will return Promise<void>
  currentJobId: string | null;
  activeFileForExecution: string;
  setActiveFileForExecution: (fileName: string) => void;
}

const CodeExecutionContext = createContext<
  CodeExecutionContextType | undefined
>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useCodeExecutionContext = (): CodeExecutionContextType => {
  const context = useContext(CodeExecutionContext);
  if (!context) {
    throw new Error(
      "useCodeExecutionContext must be used within a CodeExecutionProvider"
    );
  }
  return context;
};

interface CodeExecutionProviderProps {
  children: ReactNode;
}

export const CodeExecutionProvider = ({
  children,
}: CodeExecutionProviderProps) => {
  // The ref type here matches the context type. EditorPanel will assign its more specific ref.
  const editorRef = useRef<{ getValue: () => string } | null>(null);
  const [consoleInputValue, setConsoleInputValue] = useState("");
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [activeFileForExecution, setActiveFileForExecution] =
    useState<string>("main.py");

  const { getToken, isSignedIn } = useAuth();
  const {
    selectedWorkspace,
    currentWorkspaceManifest,
    currentWorkspaceVersion,
    fileContentCache,
    manifestAndVersionCache,
    refreshWorkspace,
  } = useWorkspace();

  const handleJobCompletionOrFailure = useCallback(
    (finalMessage: string) => {
      setIsExecuting(false);
      setConsoleOutput((prev) => [...prev, finalMessage]);
      setCurrentJobId(null);
    },
    [setIsExecuting, setConsoleOutput]
  );

  const getLanguageForExecution = (
    filename: string
  ): ExecuteRequestBody["language"] | null => {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "py") {
      return "python";
    }
    // Add other languages if needed, e.g.:
    // if (ext === 'js') return 'javascript';
    // if (ext === 'go') return 'go';
    return null;
  };

  useEffect(() => {
    if (!currentJobId) {
      return; // No job to listen to, or listener was cleaned up.
    }

    const jobDocRef = doc(firestoreDB, JOBS_COLLECTION_ID, currentJobId);

    const unsubscribe = onSnapshot(
      jobDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const jobData = docSnap.data() as FirestoreJobDocument;
          const { status, output, error: jobError } = jobData;

          if (status === "completed") {
            handleJobCompletionOrFailure(`Output:\n${output}`);
          } else if (status === "failed") {
            handleJobCompletionOrFailure(
              `Execution Failed: ${jobError || "Unknown error"}`
            );
          }
        } else {
          handleJobCompletionOrFailure(
            `Error: Job document ${currentJobId} not found.`
          );
        }
      },
      (err) => {
        console.error(
          `Error in Firestore listener for job ${currentJobId}:`,
          err
        );
        handleJobCompletionOrFailure(
          `Error listening to job ${currentJobId}: ${err.message}`
        );
      }
    );

    // Return the unsubscribe function for useEffect to call on cleanup
    return () => unsubscribe();
  }, [currentJobId, handleJobCompletionOrFailure]);

  const execute = useCallback(async (): Promise<void> => {
    if (!editorRef.current) {
      toast.error("Editor not available.");
      setConsoleOutput((prev) => [...prev, "Error: Editor not available."]);
      return;
    }

    const code = editorRef.current.getValue();
    const effectiveFilenameForLanguage = activeFileForExecution;
    const language = getLanguageForExecution(effectiveFilenameForLanguage);

    if (!language) {
      toast.error(
        `Language for "${effectiveFilenameForLanguage}" is not supported.`
      );
      return;
    }

    setIsExecuting(true);
    setConsoleOutput((prev) => [...prev, "Executing code..."]);
    
    if (isSignedIn && selectedWorkspace) {
      // --- AUTHENTICATED EXECUTION ---
      try {
        const token = await auth.currentUser.getIdToken();
        if (!token) {
          throw new Error("Authentication token not available for signed-in user.");
        }

        console.log("manifestAndVersionCache", manifestAndVersionCache);

        const filesInEditorForSync: ClientFileState[] = [];
        const workspaceCache = fileContentCache[selectedWorkspace.workspaceId];

        if (workspaceCache) {
          for (const [filePath, fileContent] of Object.entries(workspaceCache)) {
            filesInEditorForSync.push({
              filePath,
              content: fileContent,
              type: fileContent === null ? 'folder' : 'file',
            });
          }
        }

        // Ensure the active file from the editor (which is the entrypoint) is the most up-to-date version
        const activeFileIndex = filesInEditorForSync.findIndex(f => f.filePath === activeFileForExecution);
        if (activeFileIndex !== -1) {
          filesInEditorForSync[activeFileIndex].content = code;
        } else {
          // This case handles when the active file is new and not yet in the cache.
          // It's unlikely with current file management, but a good safeguard.
          filesInEditorForSync.push({
            filePath: activeFileForExecution,
            content: code,
            type: 'file'
          });
        }
        
        console.log("filesInEditorForSync", filesInEditorForSync);
        console.log("workspaceCache", workspaceCache);

        if (filesInEditorForSync.length === 0) {
          toast.error("No files to sync or execute for the workspace.");
          handleJobCompletionOrFailure("Error: No files available for authenticated execution.");
          return;
        }

        const response = await executeCodeAuth(
          selectedWorkspace.workspaceId,
          token,
          filesInEditorForSync,
          {
            language,
            entrypointFile: activeFileForExecution,
            input: consoleInputValue,
          },
          currentWorkspaceManifest,
          currentWorkspaceVersion.toString()
        );
        
        if (!response.job_id) {
          handleJobCompletionOrFailure(
            `Error: Failed to start execution.`
          );
          return;
        }

        toast.success(`Execution started successfully at entrypoint: ${activeFileForExecution}, job_id: ${response.job_id}`);
        setCurrentJobId(response.job_id);
      } catch (err) {
        let errorMessage = "An unknown error occurred during authenticated execution.";
        if (err instanceof WorkspaceConflictError) {
          toast.error("Workspace is out of sync", {
            description: "A newer version is available. Refreshing will discard your local changes.",
            action: {
              label: "Refresh Now",
              onClick: () => refreshWorkspace(selectedWorkspace),
            },
            duration: Infinity
          });
          errorMessage = `Execution failed: Workspace conflict.`;
        } else if (err instanceof Error) {
          errorMessage = `API call to /execute-auth failed: ${err.message}`;
          console.error(errorMessage, err);
          toast.error(err.message);
        }
        handleJobCompletionOrFailure(`Error: ${errorMessage}`);
      }
    } else {
      // --- ANONYMOUS EXECUTION ---
      try {
        const response = await executeCode({
          language,
          code,
          input: consoleInputValue,
        });
        
        if (response.error || !response.job_id) {
          handleJobCompletionOrFailure(`Error: ${response.error || "Failed to start execution."}`);
          return;
        }
        setCurrentJobId(response.job_id);
        toast.success(`Execution started successfully at entrypoint: ${activeFileForExecution}, job_id: ${response.job_id}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        console.error("API call to /execute failed:", error);
        toast.error(`Anonymous execution failed: ${errorMessage}`);
        handleJobCompletionOrFailure(`Error: ${errorMessage}`);
      }
    }
  }, [
    editorRef,
    consoleInputValue,
    activeFileForExecution,
    setIsExecuting,
    setConsoleOutput,
    handleJobCompletionOrFailure,
    selectedWorkspace,
    currentWorkspaceManifest,
    currentWorkspaceVersion,
    fileContentCache,
    isSignedIn,
    refreshWorkspace,
  ]);

  const debouncedExecute = customDebounce(execute, 1000);

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
