import React, { createContext, useContext, useState, useRef, useCallback, ReactNode, useEffect } from 'react';
import { executeCode, getJobResult, JobResult, ExecuteRequestBody } from '@/lib/api';
// import type { editor as MonacoEditor } from 'monaco-editor'; // Assuming this is still problematic

const POLLING_INTERVAL_MS = 2000;
const POLLING_TIMEOUT_MS = 10000;

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

// Interface for the structure we expect from the backend for job results
interface BackendJobResult {
  Status: "queued" | "processing" | "completed" | "failed";
  Output?: string;
  Error?: string;
  // Add any other fields from the backend response that are PascalCased and used
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
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingStartTimeRef = useRef<number | null>(null); // To track polling start time

  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    pollingStartTimeRef.current = null; // Reset start time
  }, []);

  const getLanguageForExecution = (filename: string): ExecuteRequestBody['language'] | null => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'py') {
      return 'python';
    }
    return null; 
  };

  const handleJobCompletionOrFailure = useCallback((outputMessage: string) => {
    setIsExecuting(false);
    clearPolling();
    setCurrentJobId(null);
    setConsoleOutput(prev => [...prev, outputMessage]);
  }, [clearPolling, setIsExecuting, setConsoleOutput]);

  const pollForResults = useCallback((jobId: string) => {
    clearPolling();
    pollingStartTimeRef.current = Date.now(); // Set polling start time
    setCurrentJobId(jobId); // Keep track of the job being polled

    pollingIntervalRef.current = setInterval(async () => {
      if (!pollingStartTimeRef.current) { // Should not happen if logic is correct
        clearPolling();
        return;
      }

      if (Date.now() - pollingStartTimeRef.current > POLLING_TIMEOUT_MS) {
        handleJobCompletionOrFailure(`Job ${jobId} timed out after ${POLLING_TIMEOUT_MS / 1000} seconds.`);
        return;
      }
      
      const result = await getJobResult(jobId);

      // Type assertion to BackendJobResult
      const backendResult = result as unknown as BackendJobResult; 

      const jobStatus = backendResult.Status;
      const jobError = backendResult.Error;
      const jobOutput = backendResult.Output;

      if (jobStatus === 'completed') {
        handleJobCompletionOrFailure(`Output:\n${jobOutput || '(undefined)'}`);
      } else if (jobStatus === 'failed') {
        handleJobCompletionOrFailure(`Execution Failed: ${jobError || 'Unknown error'}`);
      } else if (!jobStatus) {
        handleJobCompletionOrFailure(`Error fetching result: ${(result as { error: string }).error}`);
      }
    }, POLLING_INTERVAL_MS);
  }, [clearPolling, handleJobCompletionOrFailure]);


  const execute = useCallback(async (): Promise<void> => { // Ensure execute itself is typed to return Promise<void>
    if (!editorRef.current) {
      setConsoleOutput(prev => [...prev, 'Error: Editor not available.']);
      return;
    }
    if (isExecuting) return;

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
    // Clear previous output related to execution, or keep history as desired
    // For now, appending to existing consoleOutput
    setConsoleOutput(prev => [...prev, 'Executing code...']);

    const response = await executeCode({
      code,
      language,
      input: consoleInputValue,
    });

    if (response.error || !response.job_id) {
      setConsoleOutput(prev => [...prev, `Error: ${response.error || 'Failed to start execution.'}`]);
      setIsExecuting(false);
      return;
    }

    setConsoleOutput(prev => [...prev, `Job ID: ${response.job_id}`]);
    pollForResults(response.job_id);
  }, [
    isExecuting, 
    consoleInputValue, 
    activeFileForExecution, 
    pollForResults, // pollForResults itself depends on other items in this list via handleJobCompletionOrFailure
    setIsExecuting, 
    setConsoleOutput
  ]);

  const debouncedExecute = customDebounce(execute, 1000);
  
  useEffect(() => {
    return () => {
      clearPolling(); // Cleanup on unmount
    };
  }, [clearPolling]);

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