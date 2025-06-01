import React, { createContext, useContext, useState, useRef, useCallback, ReactNode, useEffect } from 'react';
import { executeCode, ExecuteRequestBody } from '@/lib/api'; // getJobResult removed
import { firestoreDB } from '../firebase'; // Firebase integration
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore'; // Firestore functions
// import type { editor as MonacoEditor } from 'monaco-editor'; // Assuming this is still problematic

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

// Interface for the structure we expect from Firestore for job documents (PascalCase)
interface FirestoreJobDocument {
  Status: "queued" | "processing" | "completed" | "failed";
  Output?: string;
  Error?: string;
  // Add any other fields from the Firestore document that are PascalCased and used
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
  
  const firestoreListenerUnsubscribeRef = useRef<Unsubscribe | null>(null); // For Firestore listener

  // Simplified: only handles UI update after listener confirms completion/failure
  const handleJobCompletionOrFailure = useCallback((finalMessage: string) => {
    setIsExecuting(false);
    setCurrentJobId(null);
    setConsoleOutput(prev => [...prev, finalMessage]);
    // Listener is unsubscribed by startJobListener itself
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

  const startJobListener = useCallback((jobId: string) => {
    // Unsubscribe from any previous listener
    if (firestoreListenerUnsubscribeRef.current) {
      firestoreListenerUnsubscribeRef.current();
      firestoreListenerUnsubscribeRef.current = null;
    }
    setCurrentJobId(jobId);

    const jobDocRef = doc(firestoreDB, JOBS_COLLECTION_ID, jobId);
    
    const unsubscribe = onSnapshot(jobDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const jobData = docSnap.data() as FirestoreJobDocument;
        const { Status, Output, Error } = jobData;

        if (Status === 'completed') {
          handleJobCompletionOrFailure(`Output:\n${Output || '(no output)'}`);
          if (firestoreListenerUnsubscribeRef.current) { // defensive check
            firestoreListenerUnsubscribeRef.current(); // Unsubscribe after completion
            firestoreListenerUnsubscribeRef.current = null;
          }
        } else if (Status === 'failed') {
          handleJobCompletionOrFailure(`Execution Failed: ${Error || 'Unknown error'}`);
          if (firestoreListenerUnsubscribeRef.current) { // defensive check
            firestoreListenerUnsubscribeRef.current(); // Unsubscribe after failure
            firestoreListenerUnsubscribeRef.current = null;
          }
        } else if (Status === 'processing') {
          // Optionally update console for processing status if not already done
          // For example: setConsoleOutput(prev => [...prev, `Job ${jobId} is processing...`]);
          // Be careful not to flood the console if this status updates frequently without other changes.
        } else if (Status === 'queued'){
          // Optionally update console for queued status
        }

      } else {
        // Document doesn't exist (should not happen if job was created)
        handleJobCompletionOrFailure(`Error: Job document ${jobId} not found.`);
        if (firestoreListenerUnsubscribeRef.current) {
            firestoreListenerUnsubscribeRef.current();
            firestoreListenerUnsubscribeRef.current = null;
        }
      }
    }, (error) => {
      // Error in listener itself
      console.error("Error in Firestore listener:", error);
      handleJobCompletionOrFailure(`Error listening to job updates: ${error.message}`);
      if (firestoreListenerUnsubscribeRef.current) {
          firestoreListenerUnsubscribeRef.current();
          firestoreListenerUnsubscribeRef.current = null;
      }
    });

    firestoreListenerUnsubscribeRef.current = unsubscribe; // Store the unsubscribe function

  }, [firestoreDB, handleJobCompletionOrFailure]); // Ensure firestoreDB is stable or memoized if passed differently


  const execute = useCallback(async (): Promise<void> => {
    if (!editorRef.current) {
      setConsoleOutput(prev => [...prev, 'Error: Editor not available.']);
      return;
    }
    if (isExecuting) {
        // If already executing, and there's a listener, ensure it is stopped before starting a new one.
        // This might be relevant if user can click "Run" multiple times rapidly.
        // The debounce helps, but this is an additional safeguard for the listener.
        if (firestoreListenerUnsubscribeRef.current) {
            firestoreListenerUnsubscribeRef.current();
            firestoreListenerUnsubscribeRef.current = null;
        }
        // No need to return here explicitly if debounced, 
        // but good to note that the old listener is cleared.
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
        // Use handleJobCompletionOrFailure for consistency in stopping execution state
        handleJobCompletionOrFailure(`Error: ${response.error || 'Failed to start execution.'}`);
        return;
      }

      setConsoleOutput(prev => [...prev, `Job ID: ${response.job_id}`]);
      startJobListener(response.job_id); // Start listening instead of polling

    } catch (apiError) {
      console.error("API call to executeCode failed:", apiError);
      handleJobCompletionOrFailure(`Error starting execution: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
    }
  }, [
    isExecuting, 
    consoleInputValue, 
    activeFileForExecution, 
    startJobListener, // New dependency
    setIsExecuting, 
    setConsoleOutput,
    handleJobCompletionOrFailure // Added due to direct call in catch block
  ]);

  const debouncedExecute = customDebounce(execute, 1000);
  
  // Effect for cleaning up the Firestore listener on unmount
  useEffect(() => {
    return () => {
      if (firestoreListenerUnsubscribeRef.current) {
        firestoreListenerUnsubscribeRef.current();
      }
    };
  }, []); // Empty dependency array means this runs once on mount and cleanup on unmount

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