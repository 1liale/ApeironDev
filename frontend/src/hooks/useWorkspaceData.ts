import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, QuerySnapshot, DocumentData } from "firebase/firestore";
import { firestoreDB } from "@/lib/firebase";
import type { WorkspaceMember, WorkspaceInvitation, WorkspaceData } from "@/types/workspace";

export const useWorkspaceData = (
  workspaceId: string | null,
  currentUserId: string | null
): WorkspaceData & { refresh: () => void } => {
  const [data, setData] = useState<WorkspaceData>({
    members: [],
    invitations: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!workspaceId || !currentUserId) {
      setData({
        members: [],
        invitations: [],
        isLoading: false,
        error: null,
      });
      return;
    }

    setData(prev => ({ ...prev, isLoading: true, error: null }));

    // Query for workspace memberships
    const membershipsQuery = query(
      collection(firestoreDB, "workspace_memberships"),
      where("workspace_id", "==", workspaceId)
    );

    // Query for workspace invitations
    const invitationsQuery = query(
      collection(firestoreDB, "workspace_invitations"),
      where("workspace_id", "==", workspaceId)
    );

    let membersData: WorkspaceMember[] = [];
    let invitationsData: WorkspaceInvitation[] = [];
    let membersLoaded = false;
    let invitationsLoaded = false;

    const updateData = () => {
      if (membersLoaded && invitationsLoaded) {
        setData({
          members: membersData,
          invitations: invitationsData,
          isLoading: false,
          error: null,
        });
      }
    };

    // Listen to memberships
    const unsubscribeMembers = onSnapshot(
      membershipsQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        try {
          membersData = snapshot.docs.map(doc => ({
            membership_id: doc.id,
            ...doc.data()
          } as WorkspaceMember));
          membersLoaded = true;
          updateData();
        } catch (error) {
          console.error("Error processing workspace members:", error);
          setData(prev => ({
            ...prev,
            isLoading: false,
            error: `Error loading workspace members: ${error instanceof Error ? error.message : 'Unknown error'}`
          }));
        }
      },
      (error) => {
        console.error("Error listening to workspace members:", error);
        setData(prev => ({
          ...prev,
          isLoading: false,
          error: `Error listening to workspace members: ${error.message}`
        }));
      }
    );

    // Listen to invitations
    const unsubscribeInvitations = onSnapshot(
      invitationsQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        try {
          invitationsData = snapshot.docs.map(doc => ({
            invitation_id: doc.id,
            ...doc.data()
          } as WorkspaceInvitation));
          invitationsLoaded = true;
          updateData();
        } catch (error) {
          console.error("Error processing workspace invitations:", error);
          setData(prev => ({
            ...prev,
            isLoading: false,
            error: `Error loading workspace invitations: ${error instanceof Error ? error.message : 'Unknown error'}`
          }));
        }
      },
      (error) => {
        console.error("Error listening to workspace invitations:", error);
        setData(prev => ({
          ...prev,
          isLoading: false,
          error: `Error listening to workspace invitations: ${error.message}`
        }));
      }
    );

    // Cleanup function
    return () => {
      unsubscribeMembers();
      unsubscribeInvitations();
    };
  }, [workspaceId, currentUserId]);

  const refresh = () => {
    if (workspaceId && currentUserId) {
      setData(prev => ({ ...prev, isLoading: true, error: null }));
    }
  };

  return { ...data, refresh };
}; 