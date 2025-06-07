import { getWorkspaceManifestFromServer } from './api';
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

export async function fetchWorkspaceDetails(
  workspaceId: string,
  token: string,
) {
  const manifestResponse = await getWorkspaceManifestFromServer(
    workspaceId,
    token,
  );
  const { manifest, workspaceVersion } = manifestResponse;

  const newFileContents: Record<string, string | null> = {};
  if (manifest && manifest.length > 0) {
    const contentPromises = manifest.map(async (fileItem) => {
      if (fileItem.type === "file" && fileItem.contentUrl) {
        const content = await fetchFileContent(
          fileItem.contentUrl,
          fileItem.filePath,
        );
        if (content !== null) {
          newFileContents[fileItem.filePath] = content;
        }
      } else if (fileItem.type === "folder") {
        newFileContents[fileItem.filePath] = null; // Explicitly mark folders
      }
    });
    await Promise.all(contentPromises);
  }
  return { manifest, workspaceVersion, fileContents: newFileContents };
}

// Other workspace-related utility functions can be added here in the future. 