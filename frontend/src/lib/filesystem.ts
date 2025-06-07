import { NodeModel } from "@minoru/react-dnd-treeview";
import type { WorkspaceFileManifestItem } from "@/types/api";
import type { FileSystemNodeData } from "@/types/filesystem";

export const buildFileTree = (manifest: WorkspaceFileManifestItem[]): NodeModel<FileSystemNodeData>[] => {
  if (!manifest || manifest.length === 0) {
    return [];
  }

  const tree: NodeModel<FileSystemNodeData>[] = [];
  const lookup = new Map<string, NodeModel['id']>(); // path -> id
  let idCounter = 1;

  manifest.forEach(item => {
    const pathParts = item.filePath.split('/');
    let parentId: NodeModel['id'] = 0;
    let currentPath = '';

    pathParts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!lookup.has(currentPath)) {
        const isFolder = index < pathParts.length - 1;
        const nodeId = idCounter++;
        lookup.set(currentPath, nodeId);

        const newNode: NodeModel<FileSystemNodeData> = {
          id: nodeId,
          parent: parentId,
          text: part,
          droppable: isFolder,
          data: {
            type: isFolder ? 'folder' : 'file',
            path: currentPath,
            isEditing: false, 
          }
        };
        tree.push(newNode);
      }
      parentId = lookup.get(currentPath)!;
    });
  });

  return tree;
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
      return node.text;
    }
    // Find parent and recursively get its path
    const parentNode = nodeMap.get(node.parent);
    // If a node ends up without a parent in the map (shouldn't happen in a consistent tree)
    // or its parent is the root, its path starts from root.
    if (!parentNode) return node.text; 
    
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