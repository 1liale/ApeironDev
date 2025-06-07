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

    const parentNode = nodeMap.get(node.parent);
    if (!parentNode || node.parent === rootId) {
      return node.text;
    }
    
    const parentPath = getPathForNode(node.parent);
    return `${parentPath}/${node.text}`;
  };

  return copiedNodes.map(node => {
    if (!node.data) return node; // Return node as is if it has no data
    
    const newPath = getPathForNode(node.id);
    if (node.data.path !== newPath) {
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