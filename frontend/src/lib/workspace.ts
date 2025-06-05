import { toast } from '@/components/ui/sonner';

// Function to fetch file content using a presigned URL
export const fetchFileContent = async (url: string, filePath: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch ${filePath}: ${response.status} ${response.statusText}`);
      toast.error(`Failed to load content for ${filePath}. Status: ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error(`Error fetching file content for ${filePath}:`, error);
    toast.error(`Could not load content for ${filePath}.`);
    return null;
  }
};

// Other workspace-related utility functions can be added here in the future. 