import { useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { firestoreDB } from "@/lib/firebase";
import type { FirestoreJobDocument } from "@/types/jobs";

const JOBS_COLLECTION_ID = import.meta.env.VITE_FIRESTORE_JOBS_COLLECTION;

export const useJobStatus = (
  currentJobId: string | null,
  onJobEnd: (message: string) => void,
) => {
  useEffect(() => {
    if (!currentJobId) {
      return;
    }

    const jobDocRef = doc(firestoreDB, JOBS_COLLECTION_ID, currentJobId);

    const unsubscribe = onSnapshot(
      jobDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const jobData = docSnap.data() as FirestoreJobDocument;
          const { status, output, error: jobError } = jobData;

          if (status === "completed") {
            onJobEnd(`${output}`);
          } else if (status === "failed") {
            onJobEnd(`Execution Failed: ${jobError || "Unknown error"}`);
          }
        } else {
          onJobEnd(`Error: Job document ${currentJobId} not found.`);
        }
      },
      (err) => {
        console.error(
          `Error in Firestore listener for job ${currentJobId}:`,
          err,
        );
        onJobEnd(`Error listening to job ${currentJobId}: ${err.message}`);
      },
    );

    return () => unsubscribe();
  }, [currentJobId, onJobEnd]);
}; 