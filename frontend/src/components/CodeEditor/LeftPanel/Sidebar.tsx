import { useState, useEffect } from "react";
import { FilePlus, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DndProvider } from "react-dnd";
import {
  Tree,
  MultiBackend,
  getBackendOptions,
  NodeModel,
} from "@minoru/react-dnd-treeview";
import { FileTreeNode } from "./FileTreeNode";
import { CustomDragPreview } from "./CustomDragPreview";
import type { FileSystemNodeData } from "@/types/filesystem";
import {
  updateAllPaths,
  buildFileTree,
  treeToManifest,
} from "@/lib/filesystem";
import { useAuth } from "@clerk/react-router";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { v4 as uuidv4 } from "uuid";

interface SidebarProps {
  activeFile: string;
  onFileSelect: (file: string) => void;
}

const defaultFileTree: NodeModel<FileSystemNodeData>[] = [
  {
    id: 1,
    parent: 0,
    droppable: false,
    text: "main.py",
    data: {
      type: "file",
      path: "main.py",
      isEditing: false,
    },
  },
];

export const Sidebar = ({ activeFile, onFileSelect }: SidebarProps) => {
  const { isSignedIn } = useAuth();
  const {
    selectedWorkspace,
    currentWorkspaceManifest,
    updateFileContent,
    addFileToCache,
    addFolderToCache,
    renamePathInCache,
    removePathFromCache,
    updateCurrentWorkspaceManifest,
    fileContentCache,
  } = useWorkspace();
  const [treeData, setTreeData] = useState<NodeModel<FileSystemNodeData>[]>([]);
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [openNodeIds, setOpenNodeIds] = useState<Array<NodeModel["id"]>>([]);
  const [editingNodeId, setEditingNodeId] = useState<
    NodeModel["id"] | null
  >(
    null
  );
  const isWorkspaceActionsDisabled = !isSignedIn || !selectedWorkspace;

  // Effect 1: Rebuild the file tree only when the workspace or manifest changes.
  useEffect(() => {
    if (isSignedIn) {
      if (selectedWorkspace && currentWorkspaceManifest) {
        setTreeData(buildFileTree(currentWorkspaceManifest));
      } else {
        // Auth user, but no workspace selected or manifest loading.
        setTreeData([]);
      }
    } else {
      // Unauthenticated user always sees the default file.
      setTreeData(defaultFileTree);
    }
  }, [isSignedIn, selectedWorkspace, currentWorkspaceManifest]);

  // Effect 2: Handle file selection logic when the tree or user session changes.
  useEffect(() => {
    if (isSignedIn) {
      // For authenticated users, logic depends on the state of the tree.
      if (treeData.length > 0) {
        const currentActiveNode = treeData.find(
          (n) => n.data?.path === activeFile
        );
        // If the active file isn't in the current tree, select the first file.
        if (!currentActiveNode) {
          const firstFile = treeData.find((node) => node.data?.type === "file");
          if (firstFile?.data?.path) {
            onFileSelect(firstFile.data.path);
            setSelectedNodePath(firstFile.data.path);
          } else {
            // The tree has folders but no files.
            onFileSelect("");
            setSelectedNodePath(null);
          }
        } else {
          // The active file is valid, just ensure it's marked as selected.
          setSelectedNodePath(activeFile);
        }
      } else {
        // The tree is empty (new workspace or no files).
        onFileSelect("");
        setSelectedNodePath(null);
      }
    } else {
      // For unauthenticated users, always select main.py.
      onFileSelect("main.py");
      setSelectedNodePath("main.py");
    }
  }, [treeData, isSignedIn, onFileSelect, activeFile]);

  const handleDrop = (
    newTree: NodeModel<FileSystemNodeData>[],
    options: {
      dragSource?: NodeModel<FileSystemNodeData>;
      dropTargetId?: NodeModel["id"];
    }
  ) => {
    const { dragSource } = options;
    if (!dragSource?.data) {
      setTreeData(newTree);
      return;
    }

    const oldPath = dragSource.data.path;
    const treeWithUpdatedPaths = updateAllPaths(newTree);
    const draggedNodeAfterDrop = treeWithUpdatedPaths.find(
      (n) => n.id === dragSource.id
    );
    const newPath = draggedNodeAfterDrop?.data?.path;

    if (newPath && oldPath !== newPath) {
      renamePathInCache(oldPath, newPath);
    }

    // Update tree immediately for visual feedback
    setTreeData(treeWithUpdatedPaths);
    // NOTE: Do NOT update the local manifest here for moves!
    // This allows sync to detect the move as delete + create operations

    // If the active file was the one dragged (or inside the dragged folder), update its path
    if (activeFile.startsWith(oldPath)) {
      const updatedActiveFile = activeFile.replace(oldPath, newPath || "");
      onFileSelect(updatedActiveFile);
    }

    // Also update the selected node path if it was affected by the drag
    if (selectedNodePath && selectedNodePath.startsWith(oldPath)) {
      const updatedSelectedNodePath = selectedNodePath.replace(
        oldPath,
        newPath || ""
      );
      setSelectedNodePath(updatedSelectedNodePath);
    }
  };

  /* File Tree Operations */

  const handleNodeClick = (node: NodeModel<FileSystemNodeData>) => {
    setSelectedNodePath(node.data!.path);
    if (node.data?.type === "file") {
      onFileSelect(node.data.path);
    }
  };

  const initiateEditMode = (nodeId: NodeModel["id"]) => {
    setTreeData((prevTreeData) =>
      prevTreeData.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data!, isEditing: true } } : n
      )
    );
    setEditingNodeId(nodeId);
  };

  const handleRenameSubmit = (nodeId: NodeModel["id"], nodeName: string) => {
    const node = treeData.find((n) => n.id === nodeId);
    if (!node) return;

    // If the name is empty, we either remove the transient new node or cancel the edit.
    if (!nodeName.trim()) {
      if (node.data?.isEditing && node.text === "") {
        setTreeData((prevTreeData) =>
          prevTreeData.filter((n) => n.id !== nodeId)
        );
      } else {
        setTreeData((prevTreeData) =>
          prevTreeData.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data!, isEditing: false } }
              : n
          )
        );
      }
      setEditingNodeId(null);
      return;
    }

    const oldPath = node.data.path;
    const isNewFileCreation = oldPath === "";

    // Update the node in the tree with the new name and recalculate all paths
    const newTreeData = treeData.map((n) =>
      n.id === nodeId
        ? { ...n, text: nodeName, data: { ...n.data!, isEditing: false } }
        : n
    );
    const treeWithUpdatedPaths = updateAllPaths(newTreeData);
    const newNode = treeWithUpdatedPaths.find((n) => n.id === nodeId);
    if (!newNode?.data) return; // Should not happen

    const newPath = newNode.data.path;

    // Handle caching and active file selection
    if (isNewFileCreation) {
      if (newNode.data.type === "file") {
        addFileToCache(newPath);
        onFileSelect(newPath); // Select the new file
      } else if (newNode.data.type === "folder") {
        addFolderToCache(newPath);
      }
      // NOTE: Do NOT update manifest for new items!
      // This allows sync to detect them as new items that need to be synced to the server
      
      // Update tree to reflect the new file/folder
      setTreeData(treeWithUpdatedPaths);
    } else {
      if (oldPath !== newPath) {
        renamePathInCache(oldPath, newPath);
        // If active file was affected by rename, update its path
        if (activeFile.startsWith(oldPath)) {
          const updatedActiveFile = activeFile.replace(oldPath, newPath);
          onFileSelect(updatedActiveFile);
        }
      }
      // NOTE: Do NOT update manifest for renames/moves!
      // This allows sync to detect the rename as delete + create operations
      
      // Update tree immediately for visual feedback
      setTreeData(treeWithUpdatedPaths);
    }

    setEditingNodeId(null);
  };

  const handleAddFileOrFolder = (
    type: "file" | "folder",
    parentId: NodeModel["id"] | null = null
  ) => {
    if (isWorkspaceActionsDisabled) {
      toast.warning(
        "Please create or select a workspace to add files or folders."
      );
      return;
    }
    const newId = uuidv4();
    const targetParentId = parentId || 0; // rootId is 0 by default
    const newNode: NodeModel<FileSystemNodeData> = {
      id: newId,
      parent: targetParentId,
      text: "",
      droppable: type === "folder",
      data: {
        type: type,
        path: "", // Important: not '/' or Firestore will throw ERROR
        isEditing: true,
      },
    };

    setTreeData((prevTreeData) => {
      const newTree = [...prevTreeData, newNode];
      return newTree;
    });

    initiateEditMode(newId);

    if (targetParentId !== 0 && !openNodeIds.includes(targetParentId)) {
      setOpenNodeIds((prev) => [...prev, targetParentId]);
    }
  };

  const handleDeleteNode = (nodeId: NodeModel["id"]) => {
    const nodeToDelete = treeData.find((n) => n.id === nodeId);
    if (!nodeToDelete?.data) return;

    const { path } = nodeToDelete.data;
    removePathFromCache(path);

    const idsToRemove: Array<NodeModel["id"]> = [nodeId];
    const getDescendants = (currentId: NodeModel["id"]) => {
      const children = treeData.filter((n) => n.parent === currentId);
      children.forEach((child) => {
        idsToRemove.push(child.id);
        if (child.droppable) getDescendants(child.id);
      });
    };
    if (nodeToDelete.droppable) getDescendants(nodeId);

    const activeNode = treeData.find((n) => n.data?.path === activeFile);
    if (activeNode && idsToRemove.includes(activeNode.id)) {
      onFileSelect("");
    }

    if (
      selectedNodePath &&
      nodeToDelete &&
      nodeToDelete.data?.path === selectedNodePath
    ) {
      setSelectedNodePath(null);
    } else {
      const selectedNode = treeData.find(
        (n) => n.data?.path === selectedNodePath
      );
      if (selectedNode && idsToRemove.includes(selectedNode.id)) {
        setSelectedNodePath(null);
      }
    }

    const newTree = treeData.filter((n) => !idsToRemove.includes(n.id));
    const treeWithUpdatedPaths = updateAllPaths(newTree);
    
    // Update tree immediately for visual feedback - user sees deletion right away
    setTreeData(treeWithUpdatedPaths);
    // NOTE: Do NOT update manifest for deletes!
    // This allows sync to detect deleted files and handle server-side deletion
  };

  return (
    <div className="h-full bg-sidebar-background border-r border-sidebar-border flex flex-col overflow-hidden">
      <div className="p-3 border-b border-sidebar-border flex-shrink-0">
        <h3 className="text-sm font-semibold text-sidebar-foreground uppercase tracking-wide">
          Files
        </h3>
      </div>
      <DndProvider backend={MultiBackend} options={getBackendOptions()}>
        <Tree
          tree={treeData}
          rootId={0}
          render={(node, { depth, isOpen, onToggle }) => (
            <FileTreeNode
              node={node}
              depth={depth}
              isOpen={isOpen}
              onToggle={onToggle}
              activeFile={activeFile}
              selectedNodePath={selectedNodePath}
              onNodeClick={handleNodeClick}
              editingNodeId={editingNodeId}
              onStartEdit={initiateEditMode}
              onRenameSubmit={handleRenameSubmit}
              onDeleteNode={handleDeleteNode}
              onAddFileToFolder={(folderId) =>
                handleAddFileOrFolder("file", folderId)
              }
              isDefaultFile={!isSignedIn && node.id === 1}
              isSignedIn={isSignedIn ?? false}
            />
          )}
          dragPreviewRender={(monitorProps) => (
            <CustomDragPreview monitorProps={monitorProps} />
          )}
          onDrop={handleDrop}
          classes={{
            root: "flex-grow overflow-y-auto p-2",
            draggingSource: "opacity-70",
            dropTarget: "bg-sidebar-accent",
          }}
        />
      </DndProvider>
      <div className="p-2 border-t border-sidebar-border flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 flex-shrink-0">
          <div className="relative w-full group">
            <Button 
              onClick={() => handleAddFileOrFolder('file')}
              disabled={isWorkspaceActionsDisabled}
              className={cn(
                "flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md",
                !isSignedIn && "opacity-50 cursor-not-allowed"
              )}
            >
              <FilePlus className="w-4 h-4 sm:mr-2" /> 
              <span className="hidden sm:inline">Add File</span>
            </Button>
          </div>
          <div className="relative w-full group">
            <Button 
              onClick={() => handleAddFileOrFolder('folder')}
              disabled={isWorkspaceActionsDisabled}
              className={cn(
                "flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md",
                !isSignedIn && "opacity-50 cursor-not-allowed"
              )}
            >
              <FolderPlus className="w-4 h-4 sm:mr-2" /> 
              <span className="hidden sm:inline">Add Folder</span>
            </Button>
          </div>
      </div>
    </div>
  );
};
