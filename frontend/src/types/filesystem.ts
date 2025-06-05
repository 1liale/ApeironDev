// Define FileSystemNodeData for our tree nodes
export interface FileSystemNodeData {
  type: 'file' | 'folder';
  path: string;       // Full path, e.g., /folder1/file.txt
  isEditing?: boolean;
} 