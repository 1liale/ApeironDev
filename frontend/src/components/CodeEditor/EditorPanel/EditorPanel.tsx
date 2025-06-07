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
    if (initialContent) {
      editorInstance.setValue(initialContent);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && activeFile && selectedWorkspace) {
      updateFileContent(activeFile, value);
    }
  };

  // Update editor content when activeFile or initialContent changes
  // This ensures if the file is changed from sidebar, editor updates.
  useEffect(() => {
    if (localEditorRef.current && activeFile) {
      // Only update if the content is genuinely different to avoid resetting cursor/scroll
      if (localEditorRef.current.getValue() !== (initialContent || `# ${activeFile}\n\n# Start coding...`)) {
         localEditorRef.current.setValue(initialContent || `# ${activeFile}\n\n# Start coding...`);
      }
    } else if (localEditorRef.current && !activeFile && initialContent) {
        // Handle case where activeFile might be cleared but there's initial content (e.g. new unsaved file)
        if (localEditorRef.current.getValue() !== initialContent) {
            localEditorRef.current.setValue(initialContent);
        }
    }
  }, [activeFile, initialContent]);

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* <div className="h-10 bg-background border-b border-border flex items-center justify-between px-4 flex-shrink-0">
        <span className="text-sm text-foreground">{activeFile || "Untitled"}</span>
      </div> */}
      
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={getLanguage(activeFile)}
          defaultValue={initialContent || `# ${activeFile || 'Untitled'}\n\n# Start coding...`}
          theme={isDark ? 'vs-dark' : 'vs'}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
          // The key prop can help force re-mount if truly needed, but typically not for content changes.
          // key={activeFile} 
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