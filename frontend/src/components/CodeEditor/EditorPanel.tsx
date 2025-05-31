import { useRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";

interface EditorPanelProps {
  activeFile: string;
  isDark: boolean;
}

const fileContents: Record<string, string> = {
  "main.cpp": `#include <iostream>

using namespace std;

int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}

int main() {
    // Calculate Fibonacci sequence
    for (int i = 0; i < 10; ++i) {
        cout << "fib(" << i << ") = " << fib(i) << endl;
    }
    
    int a = 0, b = 1, c = 0;
    for (int i = 0; i < 7; ++i) {
        c = a + b;
        b = a;
        a = c;
        cout << a << endl;
    }
    
    return 0;
}`,
  "utils.h": `#ifndef UTILS_H
#define UTILS_H

#include <vector>
#include <string>

namespace utils {
    std::vector<int> parseNumbers(const std::string& input);
    void printVector(const std::vector<int>& vec);
}

#endif`,
  "fibonacci.cpp": `#include <iostream>
#include <vector>

class Fibonacci {
private:
    std::vector<long long> memo;
    
public:
    long long calculate(int n) {
        if (n <= 1) return n;
        
        if (memo.size() <= n) {
            memo.resize(n + 1, -1);
        }
        
        if (memo[n] != -1) return memo[n];
        
        memo[n] = calculate(n - 1) + calculate(n - 2);
        return memo[n];
    }
};`,
  "README.md": `# Code Editor Project

A modern web-based code editor built with React and Monaco Editor.

## Features

- Syntax highlighting
- File tree navigation  
- Real-time code editing
- Console output
- Resizable panels

## Getting Started

1. Select a file from the sidebar
2. Edit your code in the main panel
3. Click "Run" to execute
4. View output in the console`,
  "CMakeLists.txt": `cmake_minimum_required(VERSION 3.10)
project(CodeEditor)

set(CMAKE_CXX_STANDARD 17)

add_executable(main src/main.cpp)`
};

export const EditorPanel = ({ activeFile, isDark }: EditorPanelProps) => {
  const editorRef = useRef(null);

  const getLanguage = (filename: string) => {
    const ext = filename.split('.').pop();
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
        return 'plaintext';
      default:
        return 'plaintext';
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="h-10 bg-background border-b border-border flex items-center px-4 flex-shrink-0">
        <span className="text-sm text-foreground">{activeFile}</span>
      </div>
      
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={getLanguage(activeFile)}
          value={fileContents[activeFile] || `// ${activeFile}\n\n// Start coding...`}
          theme={isDark ? 'vs-dark' : 'vs'}
          onMount={handleEditorDidMount}
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
