export interface FirestoreJobDocument {
  status: "queued" | "processing" | "completed" | "failed";
  output?: string;
  error?: string;
} 