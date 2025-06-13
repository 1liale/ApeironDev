import { useState } from "react";
import { User, Mail, UserPlus, Copy, X } from "lucide-react";
import { useAuth } from "@clerk/react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import type { WorkspaceSummaryItem } from "@/types/api";

interface ShareWorkspaceDialogProps {
  workspace: WorkspaceSummaryItem;
  isOpen: boolean;
  onClose: () => void;
}

interface WorkspaceInvitation {
  id: string;
  email: string;
  role: "viewer" | "editor" | "admin";
  status: "pending" | "accepted";
  invitedAt: string;
}

interface WorkspaceMember {
  id: string;
  email: string;
  name?: string;
  role: "owner" | "admin" | "editor" | "viewer";
  joinedAt: string;
}

// Mock data - in a real app, this would come from your backend
const mockMembers: WorkspaceMember[] = [
  {
    id: "1",
    email: "john@example.com",
    name: "John Doe",
    role: "owner",
    joinedAt: "2024-01-01",
  },
];

const mockInvitations: WorkspaceInvitation[] = [];

export const ShareWorkspaceDialog = ({
  workspace,
  isOpen,
  onClose,
}: ShareWorkspaceDialogProps) => {
  const { getToken } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor" | "owner">("editor");
  const [isInviting, setIsInviting] = useState(false);
  const [members] = useState<WorkspaceMember[]>(mockMembers);
  const [invitations] = useState<WorkspaceInvitation[]>(mockInvitations);

  const handleInvite = async () => {
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsInviting(true);
    try {
      const token = await getToken({ template: "integration_firebase" });
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      const response = await fetch(`/api/workspaces/${workspace.workspaceId}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          role,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to send invitation");
      }

      const data = await response.json();
      if (data.success) {
        toast.success(`Invitation sent to ${email}`);
      } else {
        throw new Error(data.error || "Failed to send invitation");
      }
    } catch (error) {
      console.error("Invitation error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to send invitation");
    } finally {
      setIsInviting(false);
      setEmail("");
    }
  };

  const handleCopyInviteLink = () => {
    // TODO: Generate actual invite link
    const inviteLink = `${window.location.origin}/invite/${workspace.workspaceId}`;
    navigator.clipboard.writeText(inviteLink);
    toast.success("Invite link copied to clipboard");
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "admin":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "editor":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "viewer":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Share "{workspace.name}" workspace
          </DialogTitle>
          <DialogDescription>
            Invite others to collaborate on this workspace
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Invite new member */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              <Label className="text-sm font-medium">Invite new member</Label>
            </div>
            
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !isInviting && handleInvite()}
                />
              </div>
              <Select value={role} onValueChange={(value: "viewer" | "editor" | "owner") => setRole(value)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleInvite} disabled={isInviting || !email}>
                {isInviting ? "..." : "Invite"}
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyInviteLink}
                className="h-8"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy invite link
              </Button>
              <span>or send a direct link</span>
            </div>
          </div>

          <Separator />

          {/* Current members */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Members ({members.length})
              </Label>
            </div>
            
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                      <User className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {member.name || member.email}
                      </div>
                      {member.name && (
                        <div className="text-xs text-muted-foreground">
                          {member.email}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getRoleColor(member.role)}>
                      {member.role}
                    </Badge>
                    {member.role !== "owner" && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pending invitations */}
          {invitations.length > 0 && (
            <>
              <Separator />
              <div className="space-y-4">
                <Label className="text-sm font-medium">
                  Pending invitations ({invitations.length})
                </Label>
                
                <div className="space-y-2">
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-dashed"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                          <Mail className="w-4 h-4 text-orange-600 dark:text-orange-300" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{invitation.email}</div>
                          <div className="text-xs text-muted-foreground">
                            Invited • {invitation.invitedAt}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getRoleColor(invitation.role)}>
                          {invitation.role}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}; 