import { useState, useRef, useEffect } from "react";
import { Sidebar } from "@/components/CodeEditor/LeftPanel/Sidebar";
import { EditorPanel } from "@/components/CodeEditor/EditorPanel/EditorPanel";
import { RightPanel } from "@/components/CodeEditor/RightPanel/RightPanel";
import { TopBar } from "@/components/CodeEditor/EditorPanel/TopBar";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { CodeExecutionProvider } from "@/contexts/CodeExecutionContext";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { Toaster } from "@/components/ui/sonner";

const HomePage = () => {
  const [activeFile, setActiveFile] = useState<string>("/main.py");
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    return savedTheme ? savedTheme === "dark" : true;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);

  const toggleSidebar = () => {
    if (sidebarPanelRef.current) {
      if (isSidebarCollapsed) {
        sidebarPanelRef.current.expand();
      } else {
        sidebarPanelRef.current.collapse();
      }
    }
  };

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    // Dispatch a custom event so ClerkThemeProviderWrapper can react immediately
    window.dispatchEvent(new CustomEvent("themeChanged"));
  }, [isDark]);

  return (
    <TooltipProvider>
      <Toaster position="bottom-right"/>

      <CodeExecutionProvider>
        <div className={`h-screen flex flex-col ${isDark ? "dark" : ""}`}>
          <TopBar isDark={isDark} onToggleTheme={toggleTheme} />

          <ResizablePanelGroup direction="horizontal" className="flex-1">
            <ResizablePanel
              ref={sidebarPanelRef}
              defaultSize={20}
              minSize={20}
              maxSize={30}
              collapsible={true}
              collapsedSize={0}
              onCollapse={() => setIsSidebarCollapsed(true)}
              onExpand={() => setIsSidebarCollapsed(false)}
            >
              <Sidebar activeFile={activeFile} onFileSelect={setActiveFile} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={60} minSize={30}>
              <div className="flex flex-col h-full">
                <div className="p-1.5 border-b border-border flex items-center bg-muted flex-shrink-0 h-[41px]">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    title={isSidebarCollapsed ? "Open Files" : "Close Files"}
                  >
                    {isSidebarCollapsed ? (
                      <PanelLeftOpen className="h-5 w-5" />
                    ) : (
                      <PanelLeftClose className="h-5 w-5" />
                    )}
                  </Button>
                  <span className="ml-2 text-sm text-muted-foreground truncate">
                    {activeFile ||
                      (isSidebarCollapsed && !activeFile
                        ? "Select a file"
                        : "No file selected")}
                  </span>
                </div>
                <div className="flex-grow overflow-auto">
                  <EditorPanel
                    activeFile={activeFile}
                    isDark={isDark}
                    initialContent={`# Welcome to ${
                      activeFile || "new_file.py"
                    }\nprint("Hello, world!")`}
                  />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={20} minSize={20} maxSize={30}>
              <RightPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </CodeExecutionProvider>
    </TooltipProvider>
  );
};

export default HomePage;
