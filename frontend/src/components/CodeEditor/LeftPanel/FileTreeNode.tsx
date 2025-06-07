import React from 'react';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  Trash2,
  Edit3
} from "lucide-react";
import { NodeModel } from "@minoru/react-dnd-treeview";
import { FileSystemNodeData } from "@/types/filesystem"; // Corrected import name
import { cn } from '@/lib/utils';

interface FileTreeNodeProps {
  node: NodeModel<FileSystemNodeData>;
  depth: number;
  isOpen: boolean;
  onToggle: () => void;
  activeFile: string;
  selectedNodePath: string | null;
  onNodeClick: (node: NodeModel<FileSystemNodeData>) => void;
  editingNodeId: NodeModel['id'] | null;
  onStartEdit: (nodeId: NodeModel['id']) => void; // Will be used later
  onRenameSubmit: (nodeId: NodeModel['id'], newName: string) => void;
  onDeleteNode: (nodeId: NodeModel['id']) => void;
  onAddFileToFolder?: (folderId: NodeModel['id']) => void; // Optional, only for folders
  isDefaultFile?: boolean; // Added prop to identify the default file
  isSignedIn: boolean; // Added prop for auth status
}

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  depth,
  isOpen,
  onToggle,
  activeFile,
  selectedNodePath,
  onNodeClick,
  editingNodeId,
  onStartEdit, // Keep for future use
  onRenameSubmit,
  onEditCancel,
  onDeleteNode,
  onAddFileToFolder,
  isDefaultFile = false, // Provide default value
  isSignedIn,
}) => {
  const { type, path } = node.data!;
  const isEditorActiveFile = type === 'file' && activeFile === path;
  const isVisuallySelected = selectedNodePath === path;
  const isCurrentlyEditing = editingNodeId === node.id;

  if (isCurrentlyEditing) {
    return (
      <div 
        style={{ paddingLeft: depth * 12 + 8 }} 
        className="flex items-center py-1 px-2 text-sm group"
      >
        {node.droppable && (
          <div className="flex items-center mr-1 p-0.5">
            {isOpen ? 
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : 
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            }
          </div>
        )}
        {type === 'folder' ? 
          (isOpen ? 
            <FolderOpen className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" /> : 
            <Folder className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" />
          ) : 
          <File className="w-4 h-4 mr-1 text-muted-foreground flex-shrink-0" />
        }
        <input 
          type="text" 
          defaultValue={node.text} 
          autoFocus 
          onBlur={(e) => onRenameSubmit(node.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRenameSubmit(node.id, e.currentTarget.value);
            }
          }}
          className="bg-input text-foreground text-sm p-0.5 w-full focus:outline-none focus:ring-1 focus:ring-ring ml-1"
        />
      </div>
    );
  }

  return (
    <div 
      style={{ paddingLeft: depth * 12 + 8 }} 
      className={cn(
        "flex items-center justify-between py-1 px-2 text-sm group",
        isVisuallySelected && "bg-sidebar-primary/30 border-r-2 border-sidebar-ring text-sidebar-primary-foreground"
      )}
      onClick={() => {
        onNodeClick(node);
      }}
    >
      <div className="flex items-center overflow-hidden mr-2">
        {node.droppable && (
          <div 
            onClick={(e) => { e.stopPropagation(); onToggle();}} // Stop propagation for toggle
            className="flex items-center mr-1 cursor-pointer p-0.5"
          >
            {isOpen ? 
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : 
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            }
          </div>
        )}
        {type === 'folder' ? 
          (isOpen ? 
            <FolderOpen className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" /> : 
            <Folder className="w-4 h-4 mr-1 text-sidebar-primary flex-shrink-0" />
          ) : 
          <File className="w-4 h-4 mr-1 text-muted-foreground flex-shrink-0" />
        }
        <span className={cn(
          "text-sidebar-foreground truncate",
          isVisuallySelected && "font-medium"
        )}>
          {node.text}
        </span>
      </div>
      <div className="flex items-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {type === 'folder' && onAddFileToFolder &&
          <button 
            onClick={(e) => { e.stopPropagation(); onAddFileToFolder(node.id); }} 
            title={!isSignedIn ? "Sign in to add files to folder" : "Add file to folder"} 
            className="p-1 text-muted-foreground hover:text-primary"
            disabled={!isSignedIn} // Disable if not signed in
          >
            <FilePlus className="w-3 h-3" />
          </button>
        }
        <button 
          onClick={(e) => { e.stopPropagation(); onStartEdit(node.id); }} 
          className="p-1 text-muted-foreground hover:text-primary" 
          title="Rename"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        {!isDefaultFile && ( // Conditionally render Delete button
          <button 
            onClick={(e) => { e.stopPropagation(); onDeleteNode(node.id); }} 
            className="p-1 text-muted-foreground hover:text-destructive" 
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}; 