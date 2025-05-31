import { useState, useEffect, useRef, MouseEvent } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Trash2,
  Edit3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { DndProvider } from "react-dnd";
import { 
  Tree, 
  TreeMethods,
  MultiBackend, 
  getBackendOptions, 
  NodeModel
} from "@minoru/react-dnd-treeview";

interface SidebarProps {
  activeFile: string;
  onFileSelect: (file: string) => void;
}

interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  path: string;
  isEditing?: boolean;
}

// This type matches the TreeView NodeModel with our custom data
interface TreeNode extends NodeModel {
  data: {
    name: string;
    path: string;
    isEditing?: boolean;
    type: 'file' | 'folder';
  };
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetId: string | null;
}

// Empty file tree by default
const initialFileTree: FileNode[] = [
  {
    id: "main-py",
    name: "main.py",
    type: "file",
    path: "/main.py"
  }
];

// --- Helper Functions ---
const flattenFileTree = (fileNodes: FileNode[], rootId: string | number = "root"): TreeNode[] => {
  const result: TreeNode[] = [];
  
  const processNode = (node: FileNode, parent: string | number) => {
    result.push({
      id: node.id,
      parent: parent,
      text: node.name,
      droppable: node.type === 'folder',
      data: {
        name: node.name,
        path: node.path,
        isEditing: node.isEditing,
        type: node.type
      }
    });
    
    if (node.children) {
      for (const child of node.children) {
        processNode(child, node.id);
      }
    }
  };
  
  for (const node of fileNodes) {
    processNode(node, rootId);
  }
  
  return result;
};

const rebuildFileTreeFromFlat = (flatNodes: TreeNode[]): FileNode[] => {
  const nodeMap = new Map<string | number, FileNode>();
  const rootNodes: FileNode[] = [];

  // First pass: create all nodes
  flatNodes.forEach(node => {
    const fileNode: FileNode = {
      id: node.id.toString(),
      name: node.text,
      type: node.data.type,
      path: node.data.path,
      isEditing: node.data.isEditing,
      children: node.droppable ? [] : undefined
    };
    nodeMap.set(node.id, fileNode);
  });

  // Second pass: build the tree structure
  flatNodes.forEach(node => {
    if (node.parent === "root") {
      rootNodes.push(nodeMap.get(node.id)!);
    } else {
      const parentNode = nodeMap.get(node.parent);
      if (parentNode && parentNode.children) {
        parentNode.children.push(nodeMap.get(node.id)!);
      }
    }
  });

  return rootNodes;
};

const processNodeRecursive = (nodes: FileNode[], parentPath: string = ""): FileNode[] => {
  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.type === 'folder' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
  
  return sortedNodes.map(node => {
    const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    let processedChildren = node.children;
    if (node.children && node.children.length > 0) {
      processedChildren = processNodeRecursive(node.children, currentPath);
    } else if (node.type === 'folder' && !node.children) {
      processedChildren = [];
    }
    return { ...node, path: currentPath, children: processedChildren };
  });
};

export const Sidebar = ({ activeFile, onFileSelect }: SidebarProps) => {
  const treeRef = useRef<TreeMethods>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>(() => processNodeRecursive(initialFileTree));
  const [treeData, setTreeData] = useState<TreeNode[]>(() => flattenFileTree(processNodeRecursive(initialFileTree)));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set([]));
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetId: null
  });

  useEffect(() => {
    // Handle clicks outside the context menu to close it
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [contextMenu.visible]);

  useEffect(() => {
    // Initialize expanded folders in the Tree component
    if (treeRef.current) {
      const initialExpanded = Array.from(expandedFolders);
      initialExpanded.forEach(folderId => {
        const folderNode = treeData.find(node => node.data.path === folderId);
        if (folderNode) {
          treeRef.current?.open(folderNode.id);
        }
      });
    }
  }, []);

  const updateTreeState = (newTree: FileNode[]) => {
    console.log("Updating tree state with:", newTree);
    const processedTree = processNodeRecursive(newTree);
    console.log("Processed tree state:", processedTree);
    setFileTree(processedTree);
    setTreeData(flattenFileTree(processedTree));
  };

  const toggleFolder = (folderId: string | number, path: string) => {
    setExpandedFolders(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
        treeRef.current?.close(folderId);
      } else {
        newExpanded.add(path);
        treeRef.current?.open(folderId);
      }
      return newExpanded;
    });
  };

  const handleContextMenu = (e: MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Find the node to verify it's a folder
    const node = treeData.find(n => n.id === nodeId);
    if (node && node.droppable) {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        targetId: nodeId
      });
    }
  };

  const handleAddFileOrFolder = (type: 'file' | 'folder', parentFolderId?: string) => {
    // Close context menu if open
    if (contextMenu.visible) {
      setContextMenu(prev => ({ ...prev, visible: false }));
    }
    
    const tempId = `new-${type}-${Date.now()}`;
    const newNode: FileNode = {
      id: tempId, 
      name: "", 
      type, 
      path: tempId, 
      isEditing: true,
      ...(type === 'folder' && { children: [] }),
    };

    let newTreeArray: FileNode[];
    if (parentFolderId) {
      const parent = treeData.find(node => node.id === parentFolderId);
      const parentPath = parent?.data.path || '';
      
      // Add the node to the parent folder
      newTreeArray = [...fileTree];
      const addToParent = (nodes: FileNode[]): FileNode[] => {
        return nodes.map(node => {
          if (node.id === parentFolderId) {
            const children = node.children || [];
            return {
              ...node,
              children: [...children, newNode]
            };
          }
          if (node.children) {
            return {
              ...node,
              children: addToParent(node.children)
            };
          }
          return node;
        });
      };
      
      newTreeArray = addToParent(newTreeArray);
      
      // Make sure parent folder is expanded
      if (parent) {
        setExpandedFolders(prev => new Set(prev).add(parent.data.path));
        treeRef.current?.open(parentFolderId);
      }
    } else {
      newTreeArray = [...fileTree, newNode];
    }
    
    updateTreeState(newTreeArray);
    setEditingNodeId(tempId);
  };

  const handleNodeNameChange = (id: string, newName: string) => {
    if (!newName.trim()) {
      // Delete the node if name is empty
      handleDeleteNode(id);
    } else {
      const updatedTree = [...fileTree];
      
      const updateName = (nodes: FileNode[]): FileNode[] => {
        return nodes.map(node => {
        if (node.id === id) {
            const pathSegments = node.path.split('/');
            pathSegments.pop();
            const parentPath = pathSegments.join('/');
            const newPath = parentPath ? `${parentPath}/${newName}` : newName;
            
            // Update active file if this is the current file
            if (node.type === 'file' && activeFile === node.path) {
              onFileSelect(newPath);
            }
            
            return { 
              ...node, 
              name: newName,
              path: newPath,
              isEditing: false 
            };
          }
          
          if (node.children) {
            return {
              ...node,
              children: updateName(node.children)
            };
          }
          
          return node;
        });
      };
      
      const result = updateName(updatedTree);
      updateTreeState(result);
    }
    
    setEditingNodeId(null);
  };

  const startRenameNode = (id: string) => setEditingNodeId(id);

  const handleDeleteNode = (id: string) => {
    const nodeToDelete = treeData.find(node => node.id === id);
    if (!nodeToDelete) return;
    
    // Get all descendants
    const getDescendantIds = (nodeId: string | number): (string | number)[] => {
      const descendants: (string | number)[] = [];
      const children = treeData.filter(n => n.parent === nodeId);
      
      children.forEach(child => {
        descendants.push(child.id);
        if (child.droppable) {
          descendants.push(...getDescendantIds(child.id));
        }
      });
      
      return descendants;
    };
    
    const descendantIds = getDescendantIds(id);
    const nodesToRemove = [id, ...descendantIds];
    
    // Check if active file is being deleted
    if (nodeToDelete.data.type === 'file' && activeFile === nodeToDelete.data.path) {
      onFileSelect("");
    } else if (nodeToDelete.data.type === 'folder') {
      // Check if active file is inside this folder
      const pathPrefix = nodeToDelete.data.path + '/';
      if (activeFile.startsWith(pathPrefix)) {
        onFileSelect("");
      }
    }
    
    // Remove from tree
    const newTreeData = treeData.filter(node => !nodesToRemove.includes(node.id));
    setTreeData(newTreeData);
    setFileTree(rebuildFileTreeFromFlat(newTreeData));
  };

  const handleDrop = (newTree: NodeModel[], options: { dragSource?: NodeModel, dropTarget?: NodeModel }) => {
    console.log("Drop event:", options);
    
    // Convert back to our file tree structure and update state
    const updatedFileTree = rebuildFileTreeFromFlat(newTree as TreeNode[]);
    setFileTree(updatedFileTree);
    setTreeData(newTree as TreeNode[]);
    
    // If the active file was moved, update its path
    if (activeFile && options.dragSource) {
      const draggedNode = options.dragSource as TreeNode;
      if (draggedNode.data.type === 'file' && draggedNode.data.path === activeFile) {
        // Find the new path of the active file
        const updatedNode = newTree.find(node => node.id === draggedNode.id) as TreeNode;
        if (updatedNode) {
          onFileSelect(updatedNode.data.path);
        }
      }
    }
  };

  const renderNode = (node: NodeModel, { depth, isOpen, onToggle }: { depth: number, isOpen: boolean, onToggle: () => void }) => {
    const treeNode = node as TreeNode;
    const isEditing = editingNodeId === node.id;
    const isActiveFile = treeNode.data.type === 'file' && activeFile === treeNode.data.path;
    
    return (
      <div className="select-none">
        {isEditing ? (
          // If editing, render input field instead of the node content
          <div 
            className="flex items-center py-1 px-2"
                                style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {treeNode.data.type === 'folder' && (
              <div className="flex items-center mr-1 p-0.5">
                {isOpen ? 
                  <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : 
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                }
                                    </div>
                                    )}
            
            {treeNode.data.type === 'folder' ? 
              (isOpen ? 
                <FolderOpen className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" /> : 
                <Folder className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" />
              ) : 
              <File className="w-4 h-4 mr-1 text-muted-foreground flex-shrink-0" />
            }
            
            <input 
              type="text" 
              defaultValue={treeNode.text} 
              autoFocus 
              onBlur={(e) => handleNodeNameChange(node.id.toString(), e.target.value)}
                                    onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleNodeNameChange(node.id.toString(), e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  // Cancel editing
                  if (treeNode.text === "") {
                    handleDeleteNode(node.id.toString());
                                        } else {
                                            setEditingNodeId(null);
                                        }
                                        }
                                    }}
              className="bg-input text-foreground text-sm p-0.5 w-full focus:outline-none focus:ring-1 focus:ring-ring ml-1" 
            />
          </div>
        ) : (
          // If not editing, render normal node display
          <div 
            className={cn(
              "flex items-center justify-between py-1 px-2 hover:bg-sidebar-accent text-sm group",
              isActiveFile && "bg-sidebar-primary/30 border-r-2 border-sidebar-ring text-sidebar-primary-foreground"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => { 
              if (treeNode.data.type === 'file') { 
                onFileSelect(treeNode.data.path); 
              }
            }}
            // onDoubleClick={() => startRenameNode(node.id.toString())} TODO: ENABLE WHEN BACKEND FILESYSTEM SETUP
            onContextMenu={(e) => {
              if (treeNode.data.type === 'folder') {
                handleContextMenu(e, node.id.toString());
              }
            }}
          >
            <div className="flex items-center overflow-hidden mr-2">
              {treeNode.data.type === 'folder' && (
                <div 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    onToggle(); 
                    toggleFolder(node.id, treeNode.data.path); 
                  }} 
                  className="flex items-center mr-1 cursor-pointer p-0.5"
                >
                  {isOpen ? 
                    <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : 
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  }
                            </div>
                            )}
              {treeNode.data.type === 'folder' ? 
                (isOpen ? 
                  <FolderOpen className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" /> : 
                  <Folder className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" />
                ) : 
                <File className="w-4 h-4 mr-1 text-muted-foreground flex-shrink-0" />
              }
              <span className={cn(
                "text-sidebar-foreground truncate", 
                isActiveFile && "font-medium"
              )}>
                {treeNode.text}
              </span>
            </div>
            <div className="flex items-center flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {treeNode.data.type === 'folder' && 
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    handleAddFileOrFolder('file', node.id.toString()); 
                  }} 
                  title="Add file to folder" 
                  className="p-1 text-muted-foreground hover:text-primary"
                >
                  <FilePlus className="w-3 h-3" />
                </button>
              }
              <button 
                hidden // TODO: ENABLE WHEN BACKEND FILESYSTEM SETUP
                onClick={(e) => { 
                  e.stopPropagation(); 
                  startRenameNode(node.id.toString()); 
                }} 
                className="p-1 text-muted-foreground hover:text-primary" 
                title="Rename"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button 
                hidden // TODO: ENABLE WHEN BACKEND FILESYSTEM SETUP
                onClick={(e) => { 
                  e.stopPropagation(); 
                  handleDeleteNode(node.id.toString()); 
                }} 
                className="p-1 text-muted-foreground hover:text-destructive" 
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
                            )}
                        </div>
                    );
  };

  // Context menu component
  const ContextMenu = () => {
    if (!contextMenu.visible) return null;

    // Apply positioning styles
    const style: React.CSSProperties = {
      position: 'fixed',
      top: contextMenu.y,
      left: contextMenu.x,
      zIndex: 1000,
      minWidth: '160px',
      backgroundColor: 'var(--bg-popover)',
      borderRadius: '0.375rem',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      border: '1px solid var(--border-popover)',
      overflow: 'hidden'
    };

    return (
      <div 
        style={style} 
        className="bg-background border border-sidebar-border rounded-md shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="py-1">
          <button 
            className="w-full text-left px-4 py-2 text-sm hover:bg-sidebar-accent flex items-center"
            onClick={() => handleAddFileOrFolder('file', contextMenu.targetId || undefined)}
          >
            <FilePlus className="w-4 h-4 mr-2" /> New File
          </button>
          <button 
            className="w-full text-left px-4 py-2 text-sm hover:bg-sidebar-accent flex items-center"
            onClick={() => handleAddFileOrFolder('folder', contextMenu.targetId || undefined)}
          >
            <FolderPlus className="w-4 h-4 mr-2" /> New Folder
          </button>
        </div>
            </div>
    );
  };

  return (
    <DndProvider backend={MultiBackend} options={getBackendOptions()}>
      <div className="h-full bg-sidebar-background border-r border-sidebar-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-sidebar-border flex-shrink-0">
          <h3 className="text-sm font-semibold text-sidebar-foreground uppercase tracking-wide">Files</h3>
        </div>
        <div className="p-2 flex-grow overflow-auto">
          <Tree
            ref={treeRef}
            tree={treeData}
            rootId="root"
            render={renderNode}
            onDrop={handleDrop}
            classes={{
              root: "tree-root",
              container: "tree-container",
              dropTarget: "tree-drop-target",
              draggingSource: "tree-dragging-source"
            }}
            sort={false}
            insertDroppableFirst={true}
            canDrop={(tree, { dragSource, dropTargetId }) => {
              // Prevent dropping a node into its own descendants
              if (dragSource) {
                const getDescendantIds = (nodeId: string | number): (string | number)[] => {
                  const descendants: (string | number)[] = [];
                  const children = tree.filter(n => n.parent === nodeId);
                  
                  children.forEach(child => {
                    descendants.push(child.id);
                    descendants.push(...getDescendantIds(child.id));
                  });
                  
                  return descendants;
                };
                
                const descendants = getDescendantIds(dragSource.id);
                if (descendants.includes(dropTargetId)) {
                  return false;
                }
              }
              return undefined; // Use default drop logic
            }}
          />
          {/* Render context menu */}
          <ContextMenu />
        </div>
        <div className="p-2 border-t border-sidebar-border flex space-x-2 flex-shrink-0">
          <div className="relative w-full group">
            <Button 
              disabled
              onClick={() => handleAddFileOrFolder('file')} 
              className="flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md"
              title="Feature in development"
            >
            <FilePlus className="w-4 h-4 mr-2" /> Add File
          </Button>
            <div className="absolute invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-300 bg-gray-800 text-white text-xs rounded px-2 py-1 bottom-full left-1/2 transform -translate-x-1/2 mb-1 z-50 whitespace-nowrap">
              Feature in development
            </div>
          </div>
          <div className="relative w-full group">
            <Button 
              disabled
              onClick={() => handleAddFileOrFolder('folder')} 
              className="flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md"
              title="Feature in development"
            >
            <FolderPlus className="w-4 h-4 mr-2" /> Add Folder
          </Button>
            <div className="absolute invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-300 bg-gray-800 text-white text-xs rounded px-2 py-1 bottom-full left-1/2 transform -translate-x-1/2 mb-1 z-50 whitespace-nowrap">
              Feature in development
            </div>
          </div>
        </div>
      </div>
    </DndProvider>
  );
};
