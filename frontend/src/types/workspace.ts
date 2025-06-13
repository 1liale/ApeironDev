export interface WorkspaceMember {
  membership_id: string;
  workspace_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string; // ISO 8601 date string
}

export interface WorkspaceInvitation {
  invitation_id: string;
  workspace_id: string;
  invitee_email: string;
  invitee_role: "owner" | "editor" | "viewer";
  inviter_id: string;
  inviter_email: string;
  inviter_name: string;
  status: "pending" | "accepted" | "declined" | "expired";
  created_at: string; // ISO 8601 date string
  expires_at: string; // ISO 8601 date string
  clerk_invitation_id?: string;
}

export interface WorkspaceData {
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  isLoading: boolean;
  error: string | null;
} 