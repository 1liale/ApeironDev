import { useState } from "react";
import {
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DndProvider } from "react-dnd";
import { 
  Tree, 
  MultiBackend, 
  getBackendOptions, 
  NodeModel
} from "@minoru/react-dnd-treeview";
import { FileTreeNode } from "./FileTreeNode"; // Adjusted path
import { CustomDragPreview } from "./CustomDragPreview"; // Adjusted path
import { FileSystemNodeData, updateAllPaths, initializeTreeWithFileSystemNodeData } from "@/lib/filesystem";
import { useAuth } from "@clerk/react-router";
import { toast } from "@/components/ui/sonner"; 
import { cn } from "@/lib/utils"; 

interface SidebarProps {
  activeFile: string;
  onFileSelect: (file: string) => void;
}

// Define the initial default file structure directly
const initialDefaultFile: NodeModel[] = [
  {
    id: 1,
    parent: 0,
    droppable: false,
    text: "main.py",
  },
];

export const Sidebar = ({ activeFile, onFileSelect }: SidebarProps) => {
  const { isSignedIn } = useAuth();
  const [treeData, setTreeData] = useState<NodeModel<FileSystemNodeData>[]>(() => initializeTreeWithFileSystemNodeData(initialDefaultFile));
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>("/main.py"); 
  
  const handleDrop = (newTree: NodeModel<FileSystemNodeData>[], options: { dragSource?: NodeModel<FileSystemNodeData>; dropTargetId?: NodeModel['id'] }) => {
    const treeWithUpdatedPaths = updateAllPaths(newTree);
    setTreeData(treeWithUpdatedPaths);

    if (options.dragSource && activeFile && options.dragSource.data?.path === activeFile) {
      const draggedNodeAfterDrop = treeWithUpdatedPaths.find(n => n.id === options.dragSource!.id);
      if (draggedNodeAfterDrop && draggedNodeAfterDrop.data?.type === 'file' && draggedNodeAfterDrop.data.path !== activeFile) {
        onFileSelect(draggedNodeAfterDrop.data.path);
      }
    }
    if (options.dragSource && selectedNodePath && options.dragSource.data?.path === selectedNodePath) {
      const draggedNodeAfterDrop = treeWithUpdatedPaths.find(n => n.id === options.dragSource!.id);
      if (draggedNodeAfterDrop && draggedNodeAfterDrop.data) {
        setSelectedNodePath(draggedNodeAfterDrop.data.path); 
      }
    }
  };
  
  const [openNodeIds, setOpenNodeIds] = useState<Array<NodeModel['id']>>([]);
  const handleNodeToggleInternal = (nodeId: NodeModel['id']) => {
    setOpenNodeIds(prevOpenIds => {
      if (prevOpenIds.includes(nodeId)) {
        return prevOpenIds.filter(id => id !== nodeId);
    } else {
        return [...prevOpenIds, nodeId];
      }
  });
};

  const handleNodeClick = (node: NodeModel<FileSystemNodeData>) => {
    setSelectedNodePath(node.data!.path);
    if (node.data?.type === 'file') {
      onFileSelect(node.data.path);
    }
  };

  const [editingNodeId, setEditingNodeId] = useState<NodeModel['id'] | null>(null);

  const initiateEditMode = (nodeId: NodeModel['id']) => {
    setTreeData(prevTreeData => 
      prevTreeData.map(n => 
        n.id === nodeId ? { ...n, data: { ...n.data!, isEditing: true } } : n
      )
    );
    setEditingNodeId(nodeId);
  };

  const handleRenameSubmit = (nodeId: NodeModel['id'], newName: string) => {
    if (!newName.trim()) {
      const node = treeData.find(n => n.id === nodeId);
      if (node && node.data?.isEditing && node.text === "") { 
        setTreeData(prevTreeData => prevTreeData.filter(n => n.id !== nodeId));
      } else {
        setTreeData(prevTreeData => prevTreeData.map(n => n.id === nodeId ? {...n, data: {...n.data!, isEditing: false}} : n));
      }
      setEditingNodeId(null);
      return;
    }

    setTreeData(prevTreeData => {
      const newTree = prevTreeData.map(node => 
        node.id === nodeId ? { ...node, text: newName, data: { ...node.data!, isEditing: false } } : node
      );
      return updateAllPaths(newTree); 
    });
    setEditingNodeId(null);
  };

  const handleEditCancel = (nodeId: NodeModel['id']) => {
    const node = treeData.find(n => n.id === nodeId);
    if (node && node.data?.isEditing && node.text === "") { 
      setTreeData(prevTreeData => prevTreeData.filter(n => n.id !== nodeId));
    } else { 
      setTreeData(prevTreeData => prevTreeData.map(n => n.id === nodeId ? {...n, data: {...n.data!, isEditing: false}} : n));
    }
    setEditingNodeId(null);
  };
  
  const handleAddFileOrFolder = (type: 'file' | 'folder', parentId: NodeModel['id'] | null = null) => {
    const newId = Date.now(); 
    const targetParentId = parentId === null ? 0 : parentId;

    const newNode: NodeModel<FileSystemNodeData> = {
      id: newId,
      parent: targetParentId,
      text: "", 
      droppable: type === 'folder',
      data: {
        type: type,
        path: "/", 
      isEditing: true,
      },
    };

    setTreeData(prevTreeData => {
      const newTree = [...prevTreeData, newNode];
      return newTree; 
    });
    
    initiateEditMode(newId);

    if (targetParentId !== 0 && !openNodeIds.includes(targetParentId)) {
      setOpenNodeIds(prev => [...prev, targetParentId]);
    }
  };

  const handleDeleteNode = (nodeId: NodeModel['id']) => {
    const nodeToDelete = treeData.find(n => n.id === nodeId);
    if (!nodeToDelete) return;
    
    const idsToRemove: Array<NodeModel['id'] > = [nodeId];
    const getDescendants = (currentId: NodeModel['id']) => {
      const children = treeData.filter(n => n.parent === currentId);
      children.forEach(child => {
        idsToRemove.push(child.id);
        if (child.droppable) getDescendants(child.id);
      });
    };
    if (nodeToDelete.droppable) getDescendants(nodeId);

    const activeNode = treeData.find(n => n.data?.path === activeFile);
    if (activeNode && idsToRemove.includes(activeNode.id)) {
      onFileSelect("");
    }

    if (selectedNodePath && nodeToDelete && nodeToDelete.data?.path === selectedNodePath) {
      setSelectedNodePath(null);
    } else {
        const selectedNode = treeData.find(n => n.data?.path === selectedNodePath);
        if (selectedNode && idsToRemove.includes(selectedNode.id)) {
            setSelectedNodePath(null);
        }
    }

    setTreeData(prevTreeData => {
      const newTree = prevTreeData.filter(n => !idsToRemove.includes(n.id));
      return updateAllPaths(newTree);
    });
  };

  return (
      <div className="h-full bg-sidebar-background border-r border-sidebar-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-sidebar-border flex-shrink-0">
          <h3 className="text-sm font-semibold text-sidebar-foreground uppercase tracking-wide">Files</h3>
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
                onToggle={() => { 
                  onToggle();
                  handleNodeToggleInternal(node.id);
                }}
                activeFile={activeFile}
                selectedNodePath={selectedNodePath}
                onNodeClick={handleNodeClick}
                editingNodeId={editingNodeId}
                onStartEdit={initiateEditMode}
                onRenameSubmit={handleRenameSubmit}
                onEditCancel={handleEditCancel}
                onDeleteNode={handleDeleteNode}
                onAddFileToFolder={(folderId) => handleAddFileOrFolder('file', folderId)}
                isDefaultFile={node.id === 1}
                isSignedIn={isSignedIn ?? false}
              />
            )}
            dragPreviewRender={(monitorProps) => (
              <CustomDragPreview monitorProps={monitorProps} />
            )}
            onDrop={handleDrop}
            classes={{
              root: "h-full p-2 overflow-auto"
            }}
          />
    
      </DndProvider>
      <div className="p-2 border-t border-sidebar-border flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 flex-shrink-0">
          <div className="relative w-full group">
            <Button 
              onClick={() => {
                if (!isSignedIn) {
                  toast.warning("Please sign in to add a new file.");
                } else {
                  handleAddFileOrFolder('file');
                }
              }}
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
              onClick={() => {
                if (!isSignedIn) {
                  toast.warning("Please sign in to add a new folder.");
                } else {
                  handleAddFileOrFolder('folder');
                }
              }} 
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