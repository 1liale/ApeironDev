import { NodeModel } from "@minoru/react-dnd-treeview";
import type { FileSystemNodeData } from "@/types/filesystem";

// Helper function to initialize tree data with FileSystemNodeData
export const initializeTreeWithFileSystemNodeData = (nodes: NodeModel[], rootId: string | number = 0): NodeModel<FileSystemNodeData>[] => {
  const nodeMap = new Map<NodeModel['id'], NodeModel>();
  nodes.forEach(node => nodeMap.set(node.id, node));

  const buildRecursivePath = (nodeId: NodeModel['id']): string => {
    const node = nodeMap.get(nodeId);
    if (!node) return ""; // Should not happen
    if (node.parent === rootId) {
      return `/${node.text}`;
    }
    const parentNode = nodeMap.get(node.parent);
    if (!parentNode) return `/${node.text}`; // Node with non-root parent not in map, treat as root-level

    return `${buildRecursivePath(node.parent)}/${node.text}`;
  };

  const initializedNodes: NodeModel<FileSystemNodeData>[] = nodes.map(node => {
    return {
      ...node,
      data: {
        type: node.droppable ? 'folder' : 'file',
        path: "", // Path will be set by updateAllPaths
        isEditing: false,
      }
    };
  });
  
  // First, create all nodes with basic data, then update all paths recursively.
  // This avoids issues with trying to get a parent path before the parent node itself has been processed.
  return updateAllPaths(initializedNodes, rootId);
};

// Function to update all paths in the tree. Critical after D&D or rename.
export const updateAllPaths = (
  nodes: NodeModel<FileSystemNodeData>[],
  rootId: string | number = 0
): NodeModel<FileSystemNodeData>[] => {
  const nodeMap = new Map<string | number, NodeModel<FileSystemNodeData>>();
  // Deep copy nodes and their data to avoid direct state mutation issues
  const copiedNodes = nodes.map(n => ({ 
    ...n, 
    data: n.data ? { ...n.data } : undefined 
  })); 
  copiedNodes.forEach(n => nodeMap.set(n.id, n));

  const getPathForNode = (nodeId: string | number): string => {
    const node = nodeMap.get(nodeId);
    if (!node) return ""; 
    if (node.parent === rootId) {
      return `/${node.text}`;
    }
    // Find parent and recursively get its path
    const parentNode = nodeMap.get(node.parent);
    // If a node ends up without a parent in the map (shouldn't happen in a consistent tree)
    // or its parent is the root, its path starts from root.
    if (!parentNode) return `/${node.text}`; 
    
    const parentPath = getPathForNode(node.parent);
    return `${parentPath}/${node.text}`;
  };

  return copiedNodes.map(node => {
    const newPath = getPathForNode(node.id);
    if (node.data && node.data.path !== newPath) {
        return {
            ...node,
            data: {
                ...node.data,
                path: newPath,
            }
        };
    }
    return node;
  });
}; 