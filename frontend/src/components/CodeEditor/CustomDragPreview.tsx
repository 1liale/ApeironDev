import React from 'react';
import { NodeModel, DragLayerMonitorProps } from "@minoru/react-dnd-treeview";
import { FileSystemNodeData } from '@/lib/filesystem';
import { File, Folder } from 'lucide-react';

interface CustomDragPreviewProps {
  monitorProps: DragLayerMonitorProps<FileSystemNodeData>;
}

export const CustomDragPreview: React.FC<CustomDragPreviewProps> = ({ monitorProps }) => {
  const item = monitorProps.item as NodeModel<FileSystemNodeData>;
  const type = item.data?.type;

  return (
    <div className="inline-flex items-center bg-sidebar-accent text-sidebar-foreground px-2 py-1 rounded-md shadow-lg border border-sidebar-border text-sm">
      {type === 'folder' ? (
        <Folder className="w-4 h-4 mr-2 text-sidebar-primary flex-shrink-0" />
      ) : (
        <File className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0" />
      )}
      <span>{item.text}</span>
    </div>
  );
}; 