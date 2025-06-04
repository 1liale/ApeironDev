import React, { createContext, useContext, useState, useRef, useCallback, ReactNode, useEffect } from 'react';
import { executeCode, ExecuteRequestBody } from '@/lib/api';
import { firestoreDB } from '@/lib/firebase'; // Firebase integration
import { doc, onSnapshot } from 'firebase/firestore'; // Firestore functions

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
      setConsoleOutput(prev => [...prev, 'Error: Editor not available.']);
      return;
    }

    const code = editorRef.current.getValue();
    if (!code.trim()) {
      setConsoleOutput(prev => [...prev, 'Error: Cannot execute empty code.']);
      return;
    }

    const language = getLanguageForExecution(activeFileForExecution);
    if (!language) {
      setConsoleOutput(prev => [...prev, `Error: Language for file "${activeFileForExecution}" is not supported for execution.`]);
      return;
    }

    setIsExecuting(true);
    setConsoleOutput(prev => [...prev, 'Executing code...']);

    try {
      const response = await executeCode({
        code,
        language,
        input: consoleInputValue,
      });

      if (response.error || !response.job_id) {
        handleJobCompletionOrFailure(`Error: ${response.error || 'Failed to start execution.'}`);
        return;
      }

      // setConsoleOutput(prev => [...prev, `Job ID: ${response.job_id}`]);
      setCurrentJobId(response.job_id); // This triggers the useEffect to start the new listener

    } catch (apiError) {
      console.error("API call to executeCode failed:", apiError);
      handleJobCompletionOrFailure(`Error starting execution: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
    }
  }, [
    consoleInputValue, 
    activeFileForExecution, 
    setIsExecuting, 
    setConsoleOutput,
    handleJobCompletionOrFailure,
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
    currentJobId, // Still useful for display or other logic if needed
    activeFileForExecution,
    setActiveFileForExecution,
  };

  return (
    <CodeExecutionContext.Provider value={contextValue}>
      {children}
    </CodeExecutionContext.Provider>
  );
}; 