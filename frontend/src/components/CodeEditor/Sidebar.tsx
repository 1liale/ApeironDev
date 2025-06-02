import { useState } from "react";
import {
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { Button } from "../ui/button";
import { DndProvider } from "react-dnd";
import { 
  Tree, 
  MultiBackend, 
  getBackendOptions, 
  NodeModel
} from "@minoru/react-dnd-treeview";
// import SampleData from "./sample_data.json"; // Removed import
import { FileTreeNode } from "./FileTreeNode";
import { CustomDragPreview } from "./CustomDragPreview";
import { FileSystemNodeData, updateAllPaths, initializeTreeWithFileSystemNodeData } from "@/lib/filesystem";
import { useAuth } from "@clerk/react-router";

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
  // Initialize treeData with the default main.py file structure
  const [treeData, setTreeData] = useState<NodeModel<FileSystemNodeData>[]>(() => initializeTreeWithFileSystemNodeData(initialDefaultFile));
  // Initialize selectedNodePath to the default file's path
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>("/main.py"); 
  
  const handleDrop = (newTree: NodeModel<FileSystemNodeData>[], options: { dragSource?: NodeModel<FileSystemNodeData>; dropTargetId?: NodeModel['id'] }) => {
    const treeWithUpdatedPaths = updateAllPaths(newTree);
    setTreeData(treeWithUpdatedPaths);

    // If the active file was moved, update its path in the parent component
    if (options.dragSource && activeFile && options.dragSource.data?.path === activeFile) {
      const draggedNodeAfterDrop = treeWithUpdatedPaths.find(n => n.id === options.dragSource!.id);
      if (draggedNodeAfterDrop && draggedNodeAfterDrop.data?.type === 'file' && draggedNodeAfterDrop.data.path !== activeFile) {
        onFileSelect(draggedNodeAfterDrop.data.path);
      }
    }
    // If the selected node was dragged, update its selection path
    if (options.dragSource && selectedNodePath && options.dragSource.data?.path === selectedNodePath) {
      const draggedNodeAfterDrop = treeWithUpdatedPaths.find(n => n.id === options.dragSource!.id);
      if (draggedNodeAfterDrop && draggedNodeAfterDrop.data) {
        setSelectedNodePath(draggedNodeAfterDrop.data.path); 
      }
    }
  };
  
  // Manage open state for folders
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
    setSelectedNodePath(node.data!.path); // Always set the visually selected node path
    if (node.data?.type === 'file') {
      onFileSelect(node.data.path); // If it's a file, also tell the editor to open it
    }
  };

  // Editing State and Handlers
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
      // If it's a new node (identified by isEditing and empty text) being cancelled, delete it
      if (node && node.data?.isEditing && node.text === "") { 
        setTreeData(prevTreeData => prevTreeData.filter(n => n.id !== nodeId));
      } else {
        // For existing nodes, or new nodes that had a temp name, just cancel edit if name is empty
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
    if (node && node.data?.isEditing && node.text === "") { // New node that was never named
      setTreeData(prevTreeData => prevTreeData.filter(n => n.id !== nodeId));
    } else { // Existing node, or new node that had a temp name (not handled here, renameSubmit would apply if name was given)
      setTreeData(prevTreeData => prevTreeData.map(n => n.id === nodeId ? {...n, data: {...n.data!, isEditing: false}} : n));
    }
    setEditingNodeId(null);
  };
  
  const handleAddFileOrFolder = (type: 'file' | 'folder', parentId: NodeModel['id'] | null = null) => {
    const newId = Date.now(); // Simple unique ID
    const targetParentId = parentId === null ? 0 : parentId;

    const newNode: NodeModel<FileSystemNodeData> = {
      id: newId,
      parent: targetParentId,
      text: "", // Empty name, to be set by user input
      droppable: type === 'folder',
      data: {
        type: type,
        path: "/", // Placeholder, will be updated by updateAllPaths after rename
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

    // Update active file if deleted or its parent folder is deleted
    const activeNode = treeData.find(n => n.data?.path === activeFile);
    if (activeNode && idsToRemove.includes(activeNode.id)) {
      onFileSelect("");
    }

    // If selected node is deleted, clear selection
    if (selectedNodePath && nodeToDelete && nodeToDelete.data?.path === selectedNodePath) {
      setSelectedNodePath(null);
    } else {
        // Check if selected node was a descendant
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
              onClick={() => handleAddFileOrFolder('file')} 
              className="flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md"
            title={!isSignedIn ? "Sign in to add files" : "Add File"}
            disabled={!isSignedIn}
            >
            <FilePlus className="w-4 h-4 sm:mr-2" /> 
            <span className="hidden sm:inline">Add File</span>
          </Button>
          </div>
          <div className="relative w-full group">
            <Button 
              onClick={() => handleAddFileOrFolder('folder')} 
              className="flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md"
            title={!isSignedIn ? "Sign in to add folders" : "Add Folder"}
            disabled={!isSignedIn}
            >
            <FolderPlus className="w-4 h-4 sm:mr-2" /> 
            <span className="hidden sm:inline">Add Folder</span>
          </Button>
        </div>
      </div>
    </div>
  );
  
};
