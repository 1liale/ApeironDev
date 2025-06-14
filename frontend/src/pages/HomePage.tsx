import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
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
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth, useClerk } from "@clerk/clerk-react";
import { Spinner } from "@/components/ui/spinner";

const AppLayout = () => {
  const { isSignedIn } = useAuth();
  const { 
    selectedWorkspace, 
    fileContentCache, 
    workspaces,
    isLoadingWorkspaces,
    isLoadingManifest,
    isLoadingWorkspaceContents,
  } = useWorkspace();
  
  const [activeFile, setActiveFile] = useState<string>(isSignedIn ? "" : "main.py");
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    return savedTheme ? savedTheme === "dark" : true;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);

  const isContentLoading = useMemo(() => {
    if (!isSignedIn) return false; // No loading for unauthenticated view
    // Content is loading if we are fetching workspaces, the manifest, or the files.
    return isLoadingWorkspaces || isLoadingManifest || isLoadingWorkspaceContents;
  }, [isSignedIn, isLoadingWorkspaces, isLoadingManifest, isLoadingWorkspaceContents]);

  const fileContent = useMemo(() => {
    // Show nothing while loading, as the spinner will be displayed.
    if (isContentLoading) return ""; 

    if (isSignedIn) {
      if (selectedWorkspace && activeFile) {
        const content = fileContentCache[selectedWorkspace.workspaceId]?.[activeFile];
        return content ?? `# File content not available for ${activeFile}.`;
      }
      if (!selectedWorkspace && workspaces.length > 0) {
        return "# Please select a workspace from the sidebar to begin.";
      }
      if (workspaces.length === 0) {
        return "# Welcome! Create a new workspace to get started.";
      }
      return `# Select a file to view its content.`;
    }
    
    // Default content for unauthenticated users
    return `# Welcome to the public sandbox! Write and test your code here.`;
  }, [isSignedIn, selectedWorkspace, activeFile, fileContentCache, workspaces, isContentLoading]);

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

  useEffect(() => {
    const statusItem = sessionStorage.getItem("invitation_status");
    if (statusItem) {
      try {
        const { status, message } = JSON.parse(statusItem);
        if (status === "success") {
          toast.success(message);
        } else if (status === "error") {
          toast.error(message);
        }
      } catch (e) {
        console.error("Failed to parse invitation status from sessionStorage", e);
      } finally {
        sessionStorage.removeItem("invitation_status");
      }
    }
  }, []);



  // Regular app layout
  return (
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
              <div className="flex-grow overflow-auto relative">
                {isContentLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                    <Spinner size="large" />
                  </div>
                ) : (
                  <EditorPanel
                    activeFile={activeFile}
                    isDark={isDark}
                    initialContent={fileContent}
                  />
                )}
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
  );
};

const HomePage = () => {
  return (
    <TooltipProvider>
      <Toaster position="bottom-right" closeButton/>
      <WorkspaceProvider>
        <AppLayout />
      </WorkspaceProvider>
    </TooltipProvider>
  );
};

export default HomePage;
