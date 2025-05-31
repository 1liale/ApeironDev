// Fix TypeScript error by declaring the env property on ImportMeta
declare global {
  interface ImportMeta {
    env: Record<string, string>;
  }
}

const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

/**
 * Function to execute code on the backend
 * @param data - An object containing the code, language, and optional input
 * @returns The response data from the API with JobID
 * @throws Will throw an error if the API call fails
 */
export const executeCode = async (data: { code: string; language: string; input?: string }) => {
  try {
    const response = await fetch(`${API_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: data.code,
        language: data.language || "python", // Default to python if not specified
        input: data.input || "",  // Default to empty string if not provided
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
      throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error executing code:", error);
    throw error;
  }
};

/**
 * Function to poll for code execution results
 * @param jobId - The ID of the execution job
 * @returns The response data containing execution status, output, and error
 * @throws Will throw an error if the API call fails
 */
export const getExecutionResult = async (jobId: string) => {
  try {
    const response = await fetch(`${API_URL}/result/${jobId}`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
      throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching results for job ${jobId}:`, error);
    throw error;
  }
};
