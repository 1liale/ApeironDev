import React, { createContext, useContext, useState, useRef, useCallback, ReactNode, useEffect } from 'react';
import { executeCodeAuth, executeCode } from '@/lib/api';
import type { ExecuteRequestBody } from '@/types/api';
import { useAuth } from '@clerk/react-router';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { firestoreDB } from '@/lib/firebase'; // Firebase integration
import { doc, onSnapshot } from 'firebase/firestore'; // Firestore functions
import { toast } from '@/components/ui/sonner'; // For error notifications

const JOBS_COLLECTION_ID = import.meta.env.VITE_FIRESTORE_JOBS_COLLECTION || 'Job';

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
  editorRef: React.RefObject<{ getValue: () => string; } | null>; 
  consoleInputValue: string;
  setConsoleInputValue: (value: string) => void;
  consoleOutput: string[];
  setConsoleOutput: (output: string[] | ((prevOutput: string[]) => string[])) => void;
  isExecuting: boolean;
  setIsExecuting: (isExecuting: boolean) => void;
  triggerExecution: () => Promise<void>; // Debounced function will return Promise<void>
  currentJobId: string | null;
  activeFileForExecution: string; 
  setActiveFileForExecution: (fileName: string) => void;
}

const CodeExecutionContext = createContext<CodeExecutionContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useCodeExecutionContext = (): CodeExecutionContextType => {
  const context = useContext(CodeExecutionContext);
  if (!context) {
    throw new Error('useCodeExecutionContext must be used within a CodeExecutionProvider');
  }
  return context;
};

interface CodeExecutionProviderProps {
  children: ReactNode;
}

export const CodeExecutionProvider = ({ children }: CodeExecutionProviderProps) => {
  // The ref type here matches the context type. EditorPanel will assign its more specific ref.
  const editorRef = useRef<{ getValue: () => string; } | null>(null);
  const [consoleInputValue, setConsoleInputValue] = useState('');
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [activeFileForExecution, setActiveFileForExecution] = useState<string>('main.py');
  
  const { getToken, isSignedIn } = useAuth();
  const { 
    selectedWorkspace, 
    currentWorkspaceManifest, 
    currentWorkspaceVersion,
    // fileContentCache // Not directly used in `execute` but available if needed for `filesInEditor`
  } = useWorkspace();

  const handleJobCompletionOrFailure = useCallback((finalMessage: string) => {
    setIsExecuting(false);
    setConsoleOutput(prev => [...prev, finalMessage]);
    setCurrentJobId(null);
  }, [setIsExecuting, setConsoleOutput]);

  const getLanguageForExecution = (filename: string): ExecuteRequestBody['language'] | null => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'py') {
      return 'python';
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
    
    const unsubscribe = onSnapshot(jobDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const jobData = docSnap.data() as FirestoreJobDocument;
        const { status, output, error: jobError } = jobData;

        if (status === 'completed') {
          handleJobCompletionOrFailure(`Output:\n${output}`);
        } else if (status === 'failed') {
          handleJobCompletionOrFailure(`Execution Failed: ${jobError || 'Unknown error'}`);
        }
      } else {
        handleJobCompletionOrFailure(`Error: Job document ${currentJobId} not found.`);
      }
    }, (err) => {
      console.error(`Error in Firestore listener for job ${currentJobId}:`, err);
      handleJobCompletionOrFailure(`Error listening to job ${currentJobId}: ${err.message}`);
    });

    // Return the unsubscribe function for useEffect to call on cleanup
    return () => unsubscribe();
  }, [currentJobId, handleJobCompletionOrFailure]);


  const execute = useCallback(async (): Promise<void> => {
    if (!editorRef.current) {
      toast.error('Editor not available.');
      setConsoleOutput(prev => [...prev, 'Error: Editor not available.']);
      return;
    }

    const code = editorRef.current.getValue();
    
    // Consolidated check for empty code or no active file for execution.
    // If there's an active file, its content is in `code`. If `code` is empty, the file is empty.
    // If there's no active file, but `code` is also empty, then there's nothing to run.
    if (!activeFileForExecution && !code.trim()) {
        toast.error('No active file and no code in editor to execute.');
        setConsoleOutput(prev => [...prev, 'Error: No active file and no code to execute.']);
        return;
    }
    // If there is an active file for execution (entrypoint) but its content (code) is empty.
    if (activeFileForExecution && !code.trim()) {
        toast.error(`Cannot execute empty file: "${activeFileForExecution}".`);
        setConsoleOutput(prev => [...prev, `Error: Cannot execute empty file: "${activeFileForExecution}".`]);
        return;
    }

    // Determine language. If no active file, but there is code, assume python for public execution for now.
    // This part might need refinement based on desired behavior for public execution without a file context.
    const effectiveFilenameForLanguage = activeFileForExecution || "default.py";
    const language = getLanguageForExecution(effectiveFilenameForLanguage);

    if (!language) {
      toast.error(`Language for "${effectiveFilenameForLanguage}" is not supported.`);
      setConsoleOutput(prev => [...prev, `Error: Language for file "${effectiveFilenameForLanguage}" is not supported for execution.`]);
      return;
    }

    setIsExecuting(true);
    setConsoleOutput(prev => [...prev, 'Executing code...']);

    try {
      let response;
      if (isSignedIn && selectedWorkspace && currentWorkspaceManifest && currentWorkspaceVersion !== null && activeFileForExecution) {
        const token = await getToken();
        if (!token) {
          throw new Error('Authentication token not available.');
        }

        // For executeCodeAuth, filesInEditor should represent the state of files relevant to the sync part.
        // The simplest for now is to send the state of the active file if its content has been edited.
        // A more robust implementation would consider all edited files if the editor supports multiple dirty files.
        const filesInEditor = [{ filePath: activeFileForExecution, content: code }];

        response = await executeCodeAuth(
          selectedWorkspace.workspaceId,
          token,
          filesInEditor, 
          { language, entrypointFile: activeFileForExecution, input: consoleInputValue },
          currentWorkspaceManifest,
          currentWorkspaceVersion
        );
        toast.info(`Authenticated execution started for ${activeFileForExecution} in ${selectedWorkspace.name}.`);
      } else {
        // Fallback to public execution
        if (!code.trim()){ // Public execution also requires code
            toast.error("Cannot execute empty code for public execution.");
            handleJobCompletionOrFailure("Error: Cannot execute empty code.");
            return;
        }
        response = await executeCode({
          code, 
          language, 
          input: consoleInputValue,
        });
        toast.info(`Public execution started.`);
      }

      if (response.error || !response.job_id) {
        handleJobCompletionOrFailure(`Error: ${response.error || 'Failed to start execution.'}`);
        return;
      }
      setCurrentJobId(response.job_id); 

    } catch (apiError) {
      console.error("API call to execute failed:", apiError);
      const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
      toast.error(`Execution failed: ${errorMessage}`);
      handleJobCompletionOrFailure(`Error starting execution: ${errorMessage}`);
    }
  }, [
    editorRef, 
    consoleInputValue, 
    activeFileForExecution, 
    setIsExecuting, 
    setConsoleOutput,
    handleJobCompletionOrFailure,
    isSignedIn, 
    selectedWorkspace, 
    currentWorkspaceManifest, 
    currentWorkspaceVersion, 
    getToken 
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