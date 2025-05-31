const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

export interface ExecuteRequestBody {
  code: string;
  language: string;
  input?: string;
}

export interface ExecuteResponse {
  job_id: string;
  error?: string; 
}

export interface JobResult {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  code: string;
  language: string;
  input?: string;
  submitted_at: string; // ISO 8601 date string
  processing_started_at?: string | null; // ISO 8601 date string
  completed_at?: string | null; // ISO 8601 date string
  output?: string;
  error?: string;
}

export async function executeCode(body: ExecuteRequestBody): Promise<ExecuteResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to execute code and parse error' }));
      console.error('Execute API Error:', response.status, errorData);
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error in executeCode:', error);
    if (error instanceof Error) {
      return { job_id: '', error: error.message };
    }
    return { job_id: '', error: 'An unknown error occurred during code execution.' };
  }
}

export async function getJobResult(jobId: string): Promise<JobResult | { error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/result/${jobId}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to get job result and parse error' }));
      console.error('Get Result API Error:', response.status, errorData);
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const result = await response.json();
    // The backend might return null for dates, ensure they are typed correctly or handled
    return {
      ...result,
      processing_started_at: result.processing_started_at || null,
      completed_at: result.completed_at || null,
    };
  } catch (error) {
    console.error('Error in getJobResult:', error);
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: 'An unknown error occurred while fetching the job result.' };
  }
} 