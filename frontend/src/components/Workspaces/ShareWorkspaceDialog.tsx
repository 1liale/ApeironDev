import { useState, useEffect } from "react";
import { User, Mail, Link2, Copy, X } from "lucide-react";
import { useAuth } from "@clerk/react-router";
import { Button } from "@/components/ui/button";
import { useWorkspaceData } from "@/hooks/useWorkspaceData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import type { WorkspaceSummaryItem } from "@/types/api";
import { Badge } from "../ui/badge";

export const ShareWorkspaceDialog = ({
  workspace,
  isOpen,
  onClose,
}: {
  workspace: WorkspaceSummaryItem;
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [email, setEmail] = useState("");
  const [emailRole, setEmailRole] = useState<"viewer" | "editor" | "owner">("editor");
  const [isInviting, setIsInviting] = useState(false);
  const [linkRole, setLinkRole] = useState<"viewer" | "editor" | "owner">("editor");
  const [isLoadingLink, setIsLoadingLink] = useState(true);
  const [shareableLink, setShareableLink] = useState<string | null>(null);

  const { getToken, userId } = useAuth();
  const { members, invitations, refresh } = useWorkspaceData(workspace.workspaceId, userId);

  const linkDescriptions = {
    viewer: 'The workspace link provides view-only access',
    editor: 'The workspace link provides editing access',
    owner: 'The workspace link provides full ownership access'
  };

  useEffect(() => {
    const fetchShareableLink = async () => {
      if (!isOpen) return;
      setIsLoadingLink(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("Authentication required.");

        const response = await fetch(`/api/workspaces/${workspace.workspaceId}/share-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ role: linkRole }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to retrieve link.");
        
        setShareableLink(data.invitation.shareable_link);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to get link.");
        setShareableLink(null);
      } finally {
        setIsLoadingLink(false);
      }
    };
    fetchShareableLink();
  }, [isOpen, linkRole, workspace.workspaceId, getToken]);

  const handleEmailInvite = async () => {
    if (!email || !email.includes("@")) {
      return toast.error("Please enter a valid email address.");
    }
    setIsInviting(true);
    try {
        const token = await getToken();
        if (!token) throw new Error("Authentication required.");

        const response = await fetch(`/api/workspaces/${workspace.workspaceId}/share-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ email, role: emailRole }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to send email invitation.");

        toast.success(`Invitation sent to ${email}`);
        refresh();
        setEmail("");
    } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to send invitation.");
    } finally {
        setIsInviting(false);
    }
  };

  const handleCopyLink = () => {
    if (!shareableLink) return;
    navigator.clipboard.writeText(shareableLink);
    toast.success("Invite link copied to clipboard!");
  };
  
  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setLinkRole('editor');
      setEmailRole('editor');
      setShareableLink(null);
      setEmail('');
    }, 200);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Share "{workspace.name}"</DialogTitle>
          <DialogDescription>
            Invite collaborators to your workspace via email or a shareable link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Shareable Link Section */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Workspace link</Label>
            <div className="border rounded-lg p-1 pr-2">
              <div className="flex items-center gap-2">
                <Input
                  value={isLoadingLink ? "Generating link..." : shareableLink ?? "Could not generate link."}
                  readOnly
                  className="flex-1 font-mono text-sm border-0 bg-transparent p-1 h-auto focus-visible:ring-0"
                  disabled={isLoadingLink || !shareableLink}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyLink}
                  className="shrink-0"
                  disabled={isLoadingLink || !shareableLink}
                >
                  <Copy className="w-4 h-4 mr-1.5" />
                  Copy
                </Button>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-full">
                <Link2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-medium">Anyone with the link</div>
                <div className="text-sm text-muted-foreground">{linkDescriptions[linkRole]}</div>
              </div>
              <Select disabled={!shareableLink} value={linkRole} onValueChange={(value) => setLinkRole(value as "viewer" | "editor" | "owner")}>
                <SelectTrigger className="w-auto">
                  <SelectValue placeholder="Select a role..." >
                    <span className="capitalize">{`Is ${linkRole}`}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Can view</SelectItem>
                  <SelectItem value="editor">Can edit</SelectItem>
                  <SelectItem value="owner">Can own</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Email Invitation Section */}
          <div className="space-y-3">
             <Label className="font-medium">Or invite by email</Label>
             <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Enter email address to invite..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1"
              />
              <Select value={emailRole} onValueChange={(value) => setEmailRole(value as "viewer" | "editor" | "owner")}>
                <SelectTrigger className="w-32">
                  <SelectValue>
                    <span className="capitalize">{emailRole}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleEmailInvite} disabled={isInviting || !email}>
                {isInviting ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </div>
          
          <Separator />

          {/* Members List */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">People with access</h3>
            {members.map((member) => (
              <div key={member.user_id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="font-medium text-sm">{member.user_name || member.user_email}</div>
                        {member.user_name && <div className="text-xs text-muted-foreground">{member.user_email}</div>}
                    </div>
                </div>
                <Badge variant="secondary">{member.role}</Badge>
              </div>
            ))}
            
            {/* Pending Email Invitations */}
            {invitations.filter(inv => inv.invitation_type === "email" && inv.status === "pending").length > 0 && (
              <>
                <div className="pt-2">
                  <h4 className="font-medium text-sm">Pending email invitations</h4>
                </div>
                {invitations
                  .filter(inv => inv.invitation_type === "email" && inv.status === "pending")
                  .map((invitation) => (
                  <div key={invitation.invitation_id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                            <div className="font-medium text-sm">{invitation.invitee_email}</div>
                            <div className="text-xs text-muted-foreground">
                              Invited {new Date(invitation.created_at).toLocaleDateString()} by {invitation.inviter_name || invitation.inviter_email}
                            </div>
                        </div>
                    </div>
                    <Badge variant="outline">{invitation.invitee_role}</Badge>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 