import { useRef, useEffect } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from 'monaco-editor';
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface EditorPanelProps {
  activeFile: string;
  isDark: boolean;
  initialContent?: string;
  // Props related to console output/input and execution state are now managed by context
}

export const EditorPanel = ({
  activeFile,
  isDark,
  initialContent,
}: EditorPanelProps) => {
  // Use the editorRef from the context. 
  // The context provider initializes it, and we assign the actual editor instance to it onMount.
  const { editorRef, setActiveFileForExecution } = useCodeExecutionContext();
  const { selectedWorkspace, updateFileContent } = useWorkspace();
  // Use the specific type for the local ref for strong typing within this component
  const localEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  // Update the context's active file for execution when the panel's active file changes
  useEffect(() => {
    setActiveFileForExecution(activeFile);
  }, [activeFile, setActiveFileForExecution]);

  const getLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'cpp':
      case 'h':
        return 'cpp';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'py':
        return 'python';
      case 'md':
        return 'markdown';
      case 'txt':
      default:
        return 'plaintext';
    }
  };

  const handleEditorDidMount: OnMount = (editorInstance, monacoInstance) => {
    localEditorRef.current = editorInstance;
    if (editorRef) {
      // Assign to context's ref. The context ref is { getValue: () => string } | null
      // which is compatible with IStandaloneCodeEditor.
      (editorRef as React.MutableRefObject<MonacoEditor.IStandaloneCodeEditor | null>).current = editorInstance;
    }
    // No need to set value here, `defaultValue` or `value` prop handles it.
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && activeFile && selectedWorkspace) {
      updateFileContent(activeFile, value);
    }
  };

  // The useEffect to manually sync initialContent is no longer needed.
  // The `key` prop on the Editor component handles re-mounting with the correct content
  // when the active file changes, which is a cleaner and more idiomatic React approach.

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={getLanguage(activeFile)}
          key={activeFile}
          defaultValue={initialContent ?? ''}
          theme={isDark ? 'vs-dark' : 'vs'}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
          options={{
            fontSize: 14,
            fontFamily: "'Fira Code', 'Monaco', 'Menlo', monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbers: "on",
            wordWrap: "on",
            tabSize: 4,
            insertSpaces: true,
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
          }}
        />
      </div>
    </div>
  );
}; 