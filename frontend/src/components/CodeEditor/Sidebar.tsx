import { useState, useEffect } from "react";
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
import { DragDropContext, Droppable, Draggable, DropResult, ResponderProvided } from 'react-beautiful-dnd';

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

const initialFileTree: FileNode[] = [
  { id: 'file-1', name: 'README.md', type: 'file', path: 'README.md' },
  { id: 'folder-1', name: 'src', type: 'folder', path: 'src', children: [
    { id: 'file-2', name: 'index.ts', type: 'file', path: 'src/index.ts' },
    { id: 'folder-2', name: 'components', type: 'folder', path: 'src/components', children: [
      { id: 'file-3', name: 'Button.tsx', type: 'file', path: 'src/components/Button.tsx' },
    ]},
  ]},
  { id: 'file-4', name: 'package.json', type: 'file', path: 'package.json' },
  { id: 'folder-3', name: 'empty_folder', type: 'folder', path: 'empty_folder', children: []}
];

// --- Helper Functions ---
const findNodeAndParentRecursive = (nodes: FileNode[], nodeId: string, parent: FileNode | null = null): { node: FileNode | null, parent: FileNode | null, index: number } => {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.id === nodeId) return { node, parent, index: i };
    if (node.children) {
      const found = findNodeAndParentRecursive(node.children, nodeId, node);
      if (found.node) return found;
    }
  }
  return { node: null, parent: null, index: -1 };
};

const findNodeByPathRecursive = (nodes: FileNode[], path: string): FileNode | null => {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeByPathRecursive(node.children, path);
      if (found) return found;
    }
  }
  return null;
};

const sortNodes = (a: FileNode, b: FileNode): number => {
  if (a.type === 'folder' && b.type === 'file') return -1;
  if (a.type === 'file' && b.type === 'folder') return 1;
  return a.name.localeCompare(b.name);
};

const processNodeRecursive = (nodes: FileNode[], parentPath: string = ""): FileNode[] => {
  const sortedNodes = [...nodes].sort(sortNodes);
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
  const [fileTree, setFileTree] = useState<FileNode[]>(() => processNodeRecursive(initialFileTree));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src', 'src/components']));
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const updateTreeState = (newTree: FileNode[]) => {
    console.log("Updating tree state with:", newTree);
    const processedTree = processNodeRecursive(newTree);
    console.log("Processed tree state:", processedTree);
    setFileTree(processedTree);
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(folderPath)) newExpanded.delete(folderPath);
      else newExpanded.add(folderPath);
      return newExpanded;
    });
  };

  const handleAddFileOrFolder = (type: 'file' | 'folder', parentFolderId?: string) => {
    const tempId = `new-${type}-${Date.now()}`;
    const newNode: FileNode = {
      id: tempId, name: "", type, path: tempId, isEditing: true,
      ...(type === 'folder' && { children: [] }),
    };

    let newTreeArray: FileNode[];
    if (parentFolderId) {
      const addRecursive = (nodes: FileNode[]): FileNode[] => nodes.map(node => {
        if (node.id === parentFolderId && node.type === 'folder') {
          return { ...node, children: [...(node.children || []), newNode] };
        }
        return node.children ? { ...node, children: addRecursive(node.children) } : node;
      });
      newTreeArray = addRecursive(fileTree);
      const { node: parentNode } = findNodeAndParentRecursive(newTreeArray, parentFolderId);
      if (parentNode) setExpandedFolders(prev => new Set(prev).add(parentNode.path)); 
    } else {
      newTreeArray = [...fileTree, newNode];
    }
    updateTreeState(newTreeArray);
    setEditingNodeId(tempId);
  };

  const handleNodeNameChange = (id: string, newName: string) => {
    let newTreeArray = [...fileTree];
    if (!newName.trim()) {
      const { parent, index } = findNodeAndParentRecursive(newTreeArray, id);
      if (parent && parent.children) parent.children.splice(index, 1);
      else newTreeArray.splice(index, 1);
    } else {
      const updateNameRecursive = (nodes: FileNode[]): FileNode[] => nodes.map(node => {
        if (node.id === id) {
          if (node.type === 'file' && activeFile === node.path) {
            const pathSegments = node.path.split('/');
            pathSegments.pop();
            const parentP = pathSegments.join('/');
            onFileSelect(parentP ? `${parentP}/${newName}` : newName);
          }
          return { ...node, name: newName, isEditing: false };
        }
        return node.children ? { ...node, children: updateNameRecursive(node.children) } : node;
      });
      newTreeArray = updateNameRecursive(newTreeArray);
    }
    updateTreeState(newTreeArray);
    setEditingNodeId(null);
  };

  const startRenameNode = (id: string) => setEditingNodeId(id);

  const handleDeleteNode = (id: string) => {
    const treeCopy = [...fileTree];
    const { node: nodeToDelete, parent, index } = findNodeAndParentRecursive(treeCopy, id);
    if (!nodeToDelete) return;

    if (parent && parent.children) parent.children.splice(index, 1);
    else treeCopy.splice(index, 1);
    
    updateTreeState(treeCopy);

    if (activeFile === nodeToDelete.path || (nodeToDelete.type === 'folder' && activeFile.startsWith(nodeToDelete.path + '/'))) {
      onFileSelect("");
    }
  };

  const onDragEnd = (result: DropResult, provided: ResponderProvided) => {
    console.log("onDragEnd result:", JSON.parse(JSON.stringify(result))); // Full result log
    const { source, destination, draggableId } = result;

    if (!destination || (destination.droppableId === source.droppableId && destination.index === source.index)) {
        console.log("Drag ended with no change or invalid destination.");
        return;
    }

    if (destination.droppableId.startsWith(`droppable-${draggableId}`)) {
      console.warn("Attempted to drop folder into itself or its children. ID:", draggableId, "Dest:", destination.droppableId);
      return;
    }

    const currentTree = [...fileTree];
    const { node: draggedNode, parent: sourceParent, index: sourceIndex } = findNodeAndParentRecursive(currentTree, draggableId);
    
    if (!draggedNode) {
        console.error("Dragged node not found in tree:", draggableId);
        return;
    }
    console.log("Dragged node:", JSON.parse(JSON.stringify(draggedNode)));

    let activeNodeIdForUpdate: string | null = null;
    if (activeFile) {
        const activeNodeDetails = findNodeByPathRecursive(currentTree, activeFile);
        if (activeNodeDetails) activeNodeIdForUpdate = activeNodeDetails.id;
    }

    // Remove from source
    if (sourceParent && sourceParent.children) {
        console.log(`Removing ${draggedNode.name} from source parent ${sourceParent.name} at index ${sourceIndex}`);
        sourceParent.children.splice(sourceIndex, 1);
    } else {
        console.log(`Removing ${draggedNode.name} from root at index ${sourceIndex}`);
        currentTree.splice(sourceIndex, 1);
    }

    // Add to destination
    if (destination.droppableId === "root-droppable") {
      console.log(`Adding ${draggedNode.name} to root at index ${destination.index}`);
      currentTree.splice(destination.index, 0, draggedNode);
    } else {
      const destinationFolderId = destination.droppableId.replace("droppable-", "");
      console.log("Attempting to drop into folder. Destination Droppable ID:", destination.droppableId, "Extracted Folder ID:", destinationFolderId);
      const { node: destinationFolder } = findNodeAndParentRecursive(currentTree, destinationFolderId);

      if (destinationFolder && destinationFolder.type === 'folder') {
        console.log(`Adding ${draggedNode.name} to folder ${destinationFolder.name} at index ${destination.index}`);
        destinationFolder.children = destinationFolder.children || [];
        destinationFolder.children.splice(destination.index, 0, draggedNode);
        setExpandedFolders(prev => new Set(prev).add(destinationFolder.path)); 
      } else {
        console.warn("Invalid drop target or destination folder not found. Reverting. Destination Folder:", destinationFolder);
        if (sourceParent && sourceParent.children) sourceParent.children.splice(sourceIndex, 0, draggedNode);
        else currentTree.splice(sourceIndex, 0, draggedNode);
        updateTreeState(currentTree);
        return;
      }
    }
    
    updateTreeState(currentTree);

    if (activeNodeIdForUpdate) {
        const { node: activeNodeAfterMove } = findNodeAndParentRecursive(fileTree, activeNodeIdForUpdate);
        if (activeNodeAfterMove) {
            console.log("Active file found after move, new path:", activeNodeAfterMove.path);
            onFileSelect(activeNodeAfterMove.path);
        } else {
            console.log("Active file NOT found after move, clearing selection.");
            onFileSelect(""); 
        }
    }
  };

  const renderFileTree = (nodes: FileNode[], depth = 0, parentDroppableId = "root-droppable") => {
    // console.log(`RenderFileTree for droppableId: ${parentDroppableId}, nodes:`, nodes.map(n=>n.name));
    return (
      <Droppable droppableId={parentDroppableId} type="FILE_NODE">
        {(provided, snapshot) => {
          // console.log(`Droppable ${parentDroppableId} snapshot: isDraggingOver=${snapshot.isDraggingOver}, draggingOverWith=${snapshot.draggingOverWith}`);
          return (
            <div
              {...provided.droppableProps} ref={provided.innerRef}
              className={cn("py-0.5 transition-colors duration-150 ease-in-out", snapshot.isDraggingOver ? 'bg-sidebar-accent/30' : 'bg-transparent')}
              style={{ minHeight: '10px' }} // Ensure min height for empty droppables
            >
              {nodes.map((node, index) => (
                <Draggable key={node.id} draggableId={node.id} index={index}>
                  {(providedDraggable, snapshotDraggable) => {
                    // console.log(`Draggable ${node.name} snapshot: isDragging=${snapshotDraggable.isDragging}`);
                    // console.log(`Draggable ${node.name} style:`, providedDraggable.draggableProps.style);
                    return (
                        <div 
                            ref={providedDraggable.innerRef} 
                            {...providedDraggable.draggableProps} 
                            style={{
                                ...providedDraggable.draggableProps.style,
                                // When item is dragged, its source copy is controlled by RDBD, we mainly style the clone here
                                backgroundColor: snapshotDraggable.isDragging ? 'rgba(var(--sidebar-accent-rgb), 0.6)' : 'transparent',
                                boxShadow: snapshotDraggable.isDragging ? '0 0 10px rgba(0,0,0,0.3)' : 'none',
                            }}
                            className="select-none"
                        >
                            <div {...providedDraggable.dragHandleProps} 
                                className={cn(
                                    "flex items-center justify-between py-1 px-2 hover:bg-sidebar-accent text-sm group", 
                                    {"cursor-grab": !snapshotDraggable.isDragging, "cursor-grabbing": snapshotDraggable.isDragging},
                                    node.type === 'file' && activeFile === node.path && "bg-sidebar-primary/30 border-r-2 border-sidebar-ring text-sidebar-primary-foreground", 
                                    // snapshotDraggable.isDragging && "opacity-70" // Opacity can make it harder to see details
                                )}
                                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                                // Simplified onClick: only for file selection. Folder toggle is on chevron.
                                onClick={() => { if (node.type === 'file') { onFileSelect(node.path); }}}
                                onDoubleClick={() => startRenameNode(node.id)} 
                            >
                                <div className="flex items-center overflow-hidden mr-2">
                                    {node.type === 'folder' && (
                                    <div onClick={(e) => { e.stopPropagation(); toggleFolder(node.path); }} className="flex items-center mr-1 cursor-pointer p-0.5">
                                        {expandedFolders.has(node.path) ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                                    </div>
                                    )}
                                    {node.type === 'folder' ? (expandedFolders.has(node.path) ? <FolderOpen className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" /> : <Folder className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" />) : <File className="w-4 h-4 mr-1 text-muted-foreground flex-shrink-0" />}
                                    <span className={cn("text-sidebar-foreground truncate", node.type === 'file' && activeFile === node.path && "font-medium")}>{node.name}</span>
                                </div>
                                <div className="flex items-center flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                    {node.type === 'folder' && <button onClick={(e) => { e.stopPropagation(); handleAddFileOrFolder('file', node.id); }} title="Add file to folder" className="p-1 text-muted-foreground hover:text-primary"><FilePlus className="w-3 h-3" /></button>}
                                    <button onClick={(e) => { e.stopPropagation(); startRenameNode(node.id); }} className="p-1 text-muted-foreground hover:text-primary" title="Rename"><Edit3 className="w-3.5 h-3.5" /></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.id); }} className="p-1 text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            </div>
                            {editingNodeId === node.id && node.isEditing && (
                            <div style={{ paddingLeft: `${depth * 12 + 8 + 16}px` }} className="py-1 pr-2 pl-1">
                                <input type="text" defaultValue={node.name} autoFocus onBlur={(e) => handleNodeNameChange(node.id, e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleNodeNameChange(node.id, e.currentTarget.value);
                                        else if (e.key === 'Escape') {
                                        if (node.name === "" && !findNodeAndParentRecursive(initialFileTree, node.id).node) { // only delete if it was a new node
                                            handleDeleteNode(node.id); 
                                        } else {
                                            setEditingNodeId(null);
                                        }
                                        }
                                    }}
                                    className="bg-input text-foreground text-sm p-0.5 w-full focus:outline-none focus:ring-1 focus:ring-ring" />
                            </div>
                            )}
                            {node.type === 'folder' && expandedFolders.has(node.path) && editingNodeId !== node.id && (
                            renderFileTree(node.children || [], depth + 1, `droppable-${node.id}`)
                            )}
                        </div>
                    );
                  }}
                </Draggable>
              ))}
              {provided.placeholder}
              {/* Log placeholder existence and type */} 
              {/* { console.log(`Placeholder for ${parentDroppableId}:`, provided.placeholder) } */} 
            </div>
          );
        }}
      </Droppable>
    );
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="h-full bg-sidebar-background border-r border-sidebar-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-sidebar-border flex-shrink-0">
          <h3 className="text-sm font-semibold text-sidebar-foreground uppercase tracking-wide">Files</h3>
        </div>
        <div className="p-2 flex-grow overflow-auto">
          {renderFileTree(fileTree)}
        </div>
        <div className="p-2 border-t border-sidebar-border flex space-x-2 flex-shrink-0">
          <Button onClick={() => handleAddFileOrFolder('file')} className="flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md">
            <FilePlus className="w-4 h-4 mr-2" /> Add File
          </Button>
          <Button onClick={() => handleAddFileOrFolder('folder')} className="flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground rounded-md">
            <FolderPlus className="w-4 h-4 mr-2" /> Add Folder
          </Button>
        </div>
      </div>
    </DragDropContext>
  );
};
