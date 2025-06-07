import { NodeModel } from "@minoru/react-dnd-treeview";
import type {
  WorkspaceFileManifestItem,
  ClientSideWorkspaceFileManifestItem,
} from "@/types/api";
import type { FileSystemNodeData } from "@/types/filesystem";

export const buildFileTree = (manifest: WorkspaceFileManifestItem[]): NodeModel<FileSystemNodeData>[] => {
  if (!manifest || manifest.length === 0) {
    return [];
  }

  const tree: NodeModel<FileSystemNodeData>[] = [];
  const lookup = new Map<string, NodeModel['id']>(); // path -> id
  let idCounter = 1;

  // Sort by path to ensure parent directories are created before their children.
  const sortedManifest = [...manifest].sort((a, b) => a.filePath.localeCompare(b.filePath));

  sortedManifest.forEach(item => {
    const pathParts = item.filePath.split('/');
    const text = pathParts[pathParts.length - 1];
    const parentPath = pathParts.slice(0, -1).join('/');
    
    const parentId = parentPath ? lookup.get(parentPath) ?? 0 : 0;
    
    // Check if node already exists (can happen with implicit folder creation)
    if (lookup.has(item.filePath)) {
      return;
    }

    const nodeId = idCounter++;
    lookup.set(item.filePath, nodeId);

    const newNode: NodeModel<FileSystemNodeData> = {
      id: nodeId,
      parent: parentId,
      text: text,
      droppable: item.type === 'folder',
      data: {
        type: item.type,
        path: item.filePath,
        isEditing: false, 
      }
    };
    tree.push(newNode);
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

export const treeToManifest = (
  nodes: NodeModel<FileSystemNodeData>[],
): ClientSideWorkspaceFileManifestItem[] => {
  return nodes
    .filter((node) => node.data)
    .map((node) => ({
      filePath: node.data!.path,
      type: node.data!.type,
    }));
}; 