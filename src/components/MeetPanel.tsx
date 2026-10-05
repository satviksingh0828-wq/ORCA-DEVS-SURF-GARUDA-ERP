import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Expand,
  LoaderCircle,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Plus,
  Search,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/session";
import { useOrcaAI } from "@/lib/orca-context";
import { cn } from "@/lib/utils";
import {
  serverCreateMeeting,
  serverEndMeeting,
  serverHeartbeatMeeting,
  serverJoinMeeting,
  serverLeaveMeeting,
  serverListMeetings,
  serverListMeetUsers,
  serverMeetingSnapshot,
  serverPollMeetSignals,
  serverSendMeetSignal,
} from "@/lib/meeting-actions";
import type {
  MeetParticipant,
  MeetRecord,
  MeetSignal,
  MeetSignalPayload,
  MeetUser,
} from "@/lib/meeting-actions";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
const displayName = (person: Pick<MeetUser, "full_name" | "username">) =>
  person.full_name || person.username;
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const toDescriptionPayload = (description: RTCSessionDescription): MeetSignalPayload => ({
  type: description.type,
  sdp: description.sdp ?? null,
});

type ActiveCall = { meeting: MeetRecord; joinedAt: string; signalCursor: number };

export function MeetPanel({ onExpandChange }: { onExpandChange: (expanded: boolean) => void }) {
  const { user } = useSession();
  const { setOpen, expanded } = useOrcaAI();
  const [meetings, setMeetings] = useState<MeetRecord[]>([]);
  const [inviteUsers, setInviteUsers] = useState<MeetUser[]>([]);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const isAdmin = user?.role === "admin";
  const sessionToken = user?.sessionToken ?? "";

  const refreshMeetings = useCallback(async () => {
    if (!sessionToken) return;
    setError("");
    try {
      const rows = await serverListMeetings({ data: { sessionToken } });
      setMeetings(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your meetings.");
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    void refreshMeetings();
    if (!isAdmin || !sessionToken) return;
    serverListMeetUsers({ data: { sessionToken } })
      .then(setInviteUsers)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load users."),
      );
  }, [refreshMeetings, isAdmin, sessionToken]);

  useEffect(() => {
    if (!sessionToken || activeCall) return;
    const timer = window.setInterval(() => void refreshMeetings(), 30_000);
    return () => window.clearInterval(timer);
  }, [sessionToken, activeCall, refreshMeetings]);

  const enterMeeting = useCallback(
    async (meeting: MeetRecord) => {
      if (!sessionToken) return;
      setCreating(true);
      setError("");
      try {
        const joined = await serverJoinMeeting({ data: { sessionToken, meetingId: meeting.id } });
        setActiveCall({ meeting, joinedAt: joined.joinedAt, signalCursor: joined.signalCursor });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not join this meeting.");
        void refreshMeetings();
      } finally {
        setCreating(false);
      }
    },
    [sessionToken, refreshMeetings],
  );

  const createMeeting = useCallback(async () => {
    if (!sessionToken) return;
    setCreating(true);
    setError("");
    try {
      const meetingId = await serverCreateMeeting({
        data: { sessionToken, title: title.trim() || "Team meeting", inviteeIds: selectedIds },
      });
      const joined = await serverJoinMeeting({ data: { sessionToken, meetingId } });
      const meeting: MeetRecord = {
        id: meetingId,
        title: title.trim() || "Team meeting",
        status: "live",
        created_at: new Date().toISOString(),
        started_at: joined.joinedAt,
        created_by: user?.id ?? "",
        participants: [],
        my_status: "joined",
      };
      setShowCreate(false);
      setSelectedIds([]);
      setTitle("");
      setActiveCall({ meeting, joinedAt: joined.joinedAt, signalCursor: joined.signalCursor });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the meeting.");
    } finally {
      setCreating(false);
    }
  }, [sessionToken, title, selectedIds, user?.id]);

  const leaveCall = useCallback(
    async (closePanel = false) => {
      if (activeCall && sessionToken) {
        try {
          await serverLeaveMeeting({ data: { sessionToken, meetingId: activeCall.meeting.id } });
        } catch {
          // Local media is still stopped by unmount if the network drops.
        }
      }
      setActiveCall(null);
      onExpandChange(false);
      await refreshMeetings();
      if (closePanel) setOpen(false);
    },
    [activeCall, sessionToken, refreshMeetings, onExpandChange, setOpen],
  );

  const endMeeting = useCallback(async () => {
    if (!activeCall || !sessionToken) return;
    try {
      await serverEndMeeting({ data: { sessionToken, meetingId: activeCall.meeting.id } });
      await leaveCall();
      toast.success("Meeting ended for everyone");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end the meeting.");
    }
  }, [activeCall, sessionToken, leaveCall]);

  const filteredUsers = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return inviteUsers;
    return inviteUsers.filter((person) =>
      `${person.full_name} ${person.username} ${person.role}`.toLowerCase().includes(query),
    );
  }, [inviteUsers, searchText]);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label="Meet"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {activeCall ? (
            <button
              type="button"
              onClick={() => void leaveCall()}
              title="Back to meetings"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Video className="size-4" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              {activeCall ? activeCall.meeting.title : "Meet"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {activeCall ? "Live meeting" : isAdmin ? "Administrator" : "Your invited meetings"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!activeCall && isAdmin && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setShowCreate(true);
              }}
              title="Create a meeting"
              aria-label="Create a meeting"
              className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              <Plus className="size-4" />
            </button>
          )}
          {activeCall && (
            <button
              type="button"
              onClick={() => onExpandChange(true)}
              title="Expand meeting"
              aria-label="Expand meeting"
              className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
            >
              <Maximize2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void leaveCall(true)}
            title="Close Meet"
            aria-label="Close Meet"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      {error && !activeCall && (
        <div
          role="alert"
          className="mx-4 mt-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {activeCall ? (
        <VideoCall
          call={activeCall}
          sessionToken={sessionToken}
          currentUser={
            user
              ? { id: user.id, username: user.username, full_name: user.fullName, role: user.role }
              : null
          }
          canEnd={isAdmin}
          expanded={expanded}
          onLeave={() => void leaveCall()}
          onEnd={() => void endMeeting()}
          onMeetingEnded={() => {
            setError("This meeting has ended.");
            void leaveCall();
          }}
          onExpandChange={onExpandChange}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-5 rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4">
              <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-background/80 text-primary shadow-sm">
                <Video className="size-4" />
              </div>
              <h1 className="text-base font-semibold">Meet with your team</h1>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {isAdmin
                  ? "Start a call and invite the people who need to be there."
                  : "When you’re invited to a live meeting, it will appear here."}
              </p>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {loading ? "Loading meetings" : `Live meetings · ${meetings.length}`}
              </p>
              <button
                type="button"
                onClick={() => void refreshMeetings()}
                aria-label="Refresh meetings"
                title="Refresh"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Refresh
              </button>
            </div>
            {loading ? (
              <div className="flex justify-center py-10 text-muted-foreground">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : meetings.length ? (
              <div className="space-y-2.5">
                {meetings.map((meeting) => {
                  const joinedCount = meeting.participants.filter(
                    (person) => person.status === "joined",
                  ).length;
                  return (
                    <article
                      key={meeting.id}
                      className="rounded-2xl border border-border bg-card p-3.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="mb-1.5 flex items-center gap-1.5">
                            <span className="relative flex size-2">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                            </span>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                              Live now
                            </span>
                          </div>
                          <h2 className="truncate text-sm font-semibold">{meeting.title}</h2>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Started {timeLabel(meeting.started_at)} · {joinedCount} in meeting
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void enterMeeting(meeting)}
                          disabled={creating}
                          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
                        >
                          {creating ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Video className="size-3.5" />
                          )}
                          Join
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 border-t border-border/70 pt-2.5">
                        <Users className="size-3 text-muted-foreground" />
                        <p className="min-w-0 truncate text-[10px] text-muted-foreground">
                          {meeting.participants
                            .slice(0, 4)
                            .map((person) => displayName(person))
                            .join(", ") || "Invited participants"}
                          {meeting.participants.length > 4
                            ? ` +${meeting.participants.length - 4}`
                            : ""}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Users className="size-5" />
                </div>
                <p className="text-sm font-medium">No live meetings</p>
                <p className="mx-auto mt-1 max-w-[240px] text-xs leading-relaxed text-muted-foreground">
                  {isAdmin
                    ? "Create a meeting with the plus button when you’re ready to bring everyone together."
                    : "You’ll see a meeting here when an administrator invites you."}
                </p>
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-border px-4 py-3 text-[10px] text-muted-foreground">
            Your camera and microphone stay off until you join.
          </div>
        </>
      )}

      {showCreate && isAdmin && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreate(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meet-create-title"
            className="flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 id="meet-create-title" className="text-base font-semibold">
                  Start a meeting
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Choose who to invite, then jump in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <label className="block text-xs font-medium">
                Meeting name <span className="font-normal text-muted-foreground">(optional)</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={100}
                  placeholder="Team catch-up"
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
                />
              </label>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium">Invite people</label>
                  <span className="text-[10px] text-muted-foreground">
                    {selectedIds.length} selected
                  </span>
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Find a user"
                    className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary/60"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
                  {filteredUsers.length ? (
                    filteredUsers.map((person) => {
                      const selected = selectedIds.includes(person.id);
                      return (
                        <button
                          type="button"
                          key={person.id}
                          onClick={() =>
                            setSelectedIds((previous) =>
                              selected
                                ? previous.filter((id) => id !== person.id)
                                : [...previous, person.id],
                            )
                          }
                          className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left last:border-0 hover:bg-muted/50"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                            {initials(displayName(person))}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {displayName(person)}
                            </span>
                            <span className="block truncate text-[10px] capitalize text-muted-foreground">
                              {person.role.replaceAll("_", " ")} · {person.username}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded-md border",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border text-transparent",
                            )}
                          >
                            {selected && <Check className="size-3.5" />}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-4 py-5 text-center text-xs text-muted-foreground">
                      No active users found.
                    </p>
                  )}
                </div>
              </div>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <div className="flex gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createMeeting()}
                disabled={creating}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {creating ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Video className="size-4" />
                )}
                {creating ? "Starting…" : "Start meeting"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function VideoCall({
  call,
  sessionToken,
  currentUser,
  canEnd,
  expanded,
  onLeave,
  onEnd,
  onMeetingEnded,
  onExpandChange,
}: {
  call: ActiveCall;
  sessionToken: string;
  currentUser: MeetUser | null;
  canEnd: boolean;
  expanded: boolean;
  onLeave: () => void;
  onEnd: () => void;
  onMeetingEnded: () => void;
  onExpandChange: (expanded: boolean) => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const sendersRef = useRef(new Map<string, { audio?: RTCRtpSender; video?: RTCRtpSender }>());
  const remoteStreamsRef = useRef(new Map<string, MediaStream>());
  const remoteVideoRefs = useRef(new Map<string, HTMLVideoElement>());
  const queuedIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const iceRestartingRef = useRef(new Set<string>());
  const signalCursorRef = useRef(call.signalCursor);
  const mountedRef = useRef(true);
  const mediaRequestInProgressRef = useRef(false);
  const [participants, setParticipants] = useState<MeetParticipant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [peerStates, setPeerStates] = useState<Map<string, RTCPeerConnectionState>>(new Map());
  const [remoteMedia, setRemoteMedia] = useState<
    Map<string, { audio: boolean; video: boolean; sharing: boolean }>
  >(new Map());
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  const [mediaReady, setMediaReady] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [requestingMedia, setRequestingMedia] = useState(false);
  const myId = currentUser?.id ?? "";

  const requestMedia = useCallback(async () => {
    if (mediaRequestInProgressRef.current) return;
    mediaRequestInProgressRef.current = true;
    setRequestingMedia(true);
    setMediaError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera and microphone access is not supported by this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: { ideal: "user" } },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = stream;
      const audio = stream.getAudioTracks()[0] ?? null;
      const camera = stream.getVideoTracks()[0] ?? null;
      for (const senders of sendersRef.current.values()) {
        if (senders.audio) await senders.audio.replaceTrack(audio).catch(() => undefined);
        if (senders.video && !screenStreamRef.current)
          await senders.video.replaceTrack(camera).catch(() => undefined);
      }
      if (audio) audio.enabled = true;
      if (camera) camera.enabled = true;
      setMicOn(Boolean(audio));
      setCameraOn(Boolean(camera));
      if (!audio && !camera) setMediaError("No camera or microphone was found on this device.");
    } catch (err) {
      const errorName = err instanceof Error ? err.name : "";
      const message =
        errorName === "NotAllowedError" || errorName === "PermissionDeniedError"
          ? "Camera/microphone permission is blocked. Allow access in your browser’s site settings, then retry."
          : errorName === "NotFoundError" || errorName === "DevicesNotFoundError"
            ? "No camera or microphone was found. Connect a device, then retry."
            : err instanceof Error
              ? err.message
              : "Could not access your camera or microphone. Check browser permissions, then retry.";
      setMediaError(message);
      setMicOn(false);
      setCameraOn(false);
    } finally {
      mediaRequestInProgressRef.current = false;
      setRequestingMedia(false);
      if (mountedRef.current) setMediaReady(true);
    }
  }, []);

  const attachLocalVideo = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    const stream = screenStreamRef.current ?? localStreamRef.current;
    if (node && stream) {
      node.srcObject = stream;
      void node.play().catch(() => undefined);
    }
  }, []);

  const signal = useCallback(
    async (receiverId: string, kind: MeetSignal["kind"], payload: MeetSignalPayload) => {
      if (!sessionToken || !mountedRef.current) return;
      try {
        await serverSendMeetSignal({
          data: { sessionToken, meetingId: call.meeting.id, receiverId, kind, payload },
        });
      } catch {
        // Short-lived signaling is retried naturally by the presence/signal polling loops.
      }
    },
    [sessionToken, call.meeting.id],
  );

  const makePeer = useCallback(
    (peerId: string) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
        ],
      });
      const local = localStreamRef.current;
      const tracks: { audio?: RTCRtpSender; video?: RTCRtpSender } = {};
      if (local) {
        const audio = local.getAudioTracks()[0];
        const camera = local.getVideoTracks()[0];
        if (audio) tracks.audio = pc.addTrack(audio, local);
        const screen = screenStreamRef.current?.getVideoTracks()[0];
        if (screen) tracks.video = pc.addTrack(screen, screenStreamRef.current!);
        else if (camera) tracks.video = pc.addTrack(camera, local);
      }
      if (!tracks.audio)
        tracks.audio = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      if (!tracks.video)
        tracks.video = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidate = event.candidate.toJSON();
        void signal(peerId, "ice", {
          candidate: candidate.candidate ?? "",
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          usernameFragment: candidate.usernameFragment ?? null,
        });
      };
      pc.ontrack = (event) => {
        const stream = remoteStreamsRef.current.get(peerId) ?? new MediaStream();
        if (!stream.getTracks().some((track) => track.id === event.track.id))
          stream.addTrack(event.track);
        remoteStreamsRef.current.set(peerId, stream);
        event.track.onended = () => {
          stream.removeTrack(event.track);
          if (stream.getTracks().length === 0) remoteStreamsRef.current.delete(peerId);
          setRemoteStreams((previous) => {
            const next = new Map(previous);
            if (stream.getTracks().length) next.set(peerId, stream);
            else next.delete(peerId);
            return next;
          });
        };
        setRemoteStreams((previous) => new Map(previous).set(peerId, stream));
      };
      pc.onconnectionstatechange = () => {
        if (!mountedRef.current) return;
        setPeerStates((previous) => new Map(previous).set(peerId, pc.connectionState));
        if (pc.connectionState === "connected") iceRestartingRef.current.delete(peerId);
        if (
          pc.connectionState === "failed" &&
          myId.localeCompare(peerId) > 0 &&
          !iceRestartingRef.current.has(peerId)
        ) {
          iceRestartingRef.current.add(peerId);
          void (async () => {
            try {
              const offer = await pc.createOffer({ iceRestart: true });
              await pc.setLocalDescription(offer);
              if (pc.localDescription)
                await signal(peerId, "offer", toDescriptionPayload(pc.localDescription));
            } catch {
              iceRestartingRef.current.delete(peerId);
            }
          })();
        }
      };
      peersRef.current.set(peerId, pc);
      setPeerStates((previous) => new Map(previous).set(peerId, pc.connectionState));
      sendersRef.current.set(peerId, tracks);
      void signal(peerId, "media", {
        audio: micOn,
        video: cameraOn,
        sharing: Boolean(screenStreamRef.current),
      });
      return pc;
    },
    [signal, micOn, cameraOn, myId],
  );

  const processSignal = useCallback(
    async (incoming: MeetSignal) => {
      const senderId = incoming.sender_id;
      if (senderId === myId) return;
      if (incoming.kind === "media") {
        const media = incoming.payload as { audio?: boolean; video?: boolean; sharing?: boolean };
        setRemoteMedia((previous) =>
          new Map(previous).set(senderId, {
            audio: media.audio !== false,
            video: media.video !== false,
            sharing: media.sharing === true,
          }),
        );
        return;
      }
      const pc = makePeer(senderId);
      try {
        if (incoming.kind === "offer") {
          const description: RTCSessionDescriptionInit = {
            type: incoming.payload.type as RTCSdpType,
            sdp: typeof incoming.payload.sdp === "string" ? incoming.payload.sdp : undefined,
          };
          await pc.setRemoteDescription(description);
          for (const candidate of queuedIceRef.current.get(senderId) ?? [])
            await pc.addIceCandidate(candidate).catch(() => undefined);
          queuedIceRef.current.delete(senderId);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (pc.localDescription)
            await signal(senderId, "answer", toDescriptionPayload(pc.localDescription));
        } else if (incoming.kind === "answer") {
          await pc.setRemoteDescription({
            type: incoming.payload.type as RTCSdpType,
            sdp: typeof incoming.payload.sdp === "string" ? incoming.payload.sdp : undefined,
          });
          for (const candidate of queuedIceRef.current.get(senderId) ?? [])
            await pc.addIceCandidate(candidate).catch(() => undefined);
          queuedIceRef.current.delete(senderId);
        } else if (incoming.kind === "ice") {
          if (typeof incoming.payload.candidate !== "string") return;
          const candidate: RTCIceCandidateInit = {
            candidate: incoming.payload.candidate,
            sdpMid: typeof incoming.payload.sdpMid === "string" ? incoming.payload.sdpMid : null,
            sdpMLineIndex:
              typeof incoming.payload.sdpMLineIndex === "number"
                ? incoming.payload.sdpMLineIndex
                : null,
            usernameFragment:
              typeof incoming.payload.usernameFragment === "string"
                ? incoming.payload.usernameFragment
                : null,
          };
          if (pc.remoteDescription) await pc.addIceCandidate(candidate).catch(() => undefined);
          else
            queuedIceRef.current.set(senderId, [
              ...(queuedIceRef.current.get(senderId) ?? []),
              candidate,
            ]);
        }
      } catch {
        // A stale negotiation can happen if someone reconnects while peers are changing.
      }
    },
    [myId, makePeer, signal],
  );

  useEffect(() => {
    mountedRef.current = true;
    const peers = peersRef.current;
    const senders = sendersRef.current;
    const remoteStreams = remoteStreamsRef.current;
    const remoteVideos = remoteVideoRefs.current;
    void requestMedia();
    return () => {
      mountedRef.current = false;
      for (const peer of peers.values()) peer.close();
      peers.clear();
      senders.clear();
      for (const stream of remoteStreams.values())
        stream.getTracks().forEach((track) => track.stop());
      remoteStreams.clear();
      remoteVideos.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      screenStreamRef.current = null;
    };
  }, [call.meeting.id, requestMedia]);

  useEffect(() => {
    if (!sessionToken || !myId) return;
    const heartbeat = () => {
      void serverHeartbeatMeeting({
        data: { sessionToken, meetingId: call.meeting.id },
      }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 20_000);
    return () => window.clearInterval(timer);
  }, [call.meeting.id, sessionToken, myId]);

  useEffect(() => {
    if (!mediaReady || !sessionToken || !myId) return;
    let disposed = false;
    let snapshotBusy = false;
    let signalsBusy = false;
    const syncPeers = async () => {
      if (snapshotBusy || disposed) return;
      snapshotBusy = true;
      try {
        const snapshot = await serverMeetingSnapshot({
          data: { sessionToken, meetingId: call.meeting.id },
        });
        if (disposed) return;
        if (snapshot.status === "ended") {
          onMeetingEnded();
          return;
        }
        setParticipants(snapshot.participants);
        const current = snapshot.participants.find((person) => person.id === myId);
        for (const person of snapshot.participants) {
          if (
            person.id === myId ||
            !person.joined_at ||
            !current?.joined_at ||
            peersRef.current.has(person.id)
          )
            continue;
          // Stable user-id ordering picks one offerer per pair, avoiding glare after retries.
          if (myId.localeCompare(person.id) > 0) {
            const pc = makePeer(person.id);
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              if (pc.localDescription)
                await signal(person.id, "offer", toDescriptionPayload(pc.localDescription));
            } catch {
              /* retry on the next sync if the peer did not finish joining */
            }
          }
        }
        const activeIds = new Set(snapshot.participants.map((person) => person.id));
        for (const [peerId, peer] of peersRef.current) {
          if (!activeIds.has(peerId)) {
            peer.close();
            peersRef.current.delete(peerId);
            sendersRef.current.delete(peerId);
            remoteStreamsRef.current
              .get(peerId)
              ?.getTracks()
              .forEach((track) => track.stop());
            remoteStreamsRef.current.delete(peerId);
            setRemoteStreams((previous) => {
              const next = new Map(previous);
              next.delete(peerId);
              return next;
            });
            setRemoteMedia((previous) => {
              const next = new Map(previous);
              next.delete(peerId);
              return next;
            });
            setPeerStates((previous) => {
              const next = new Map(previous);
              next.delete(peerId);
              return next;
            });
            setMutedPeers((previous) => {
              if (!previous.has(peerId)) return previous;
              const next = new Set(previous);
              next.delete(peerId);
              return next;
            });
          }
        }
      } catch {
        // Presence polling continues through transient network interruptions.
      } finally {
        snapshotBusy = false;
      }
    };
    const pollSignals = async () => {
      if (signalsBusy || disposed) return;
      signalsBusy = true;
      try {
        const incoming = await serverPollMeetSignals({
          data: { sessionToken, meetingId: call.meeting.id, afterId: signalCursorRef.current },
        });
        for (const item of incoming) {
          signalCursorRef.current = Math.max(signalCursorRef.current, item.id);
          await processSignal(item);
        }
      } catch {
        // retry on next interval
      } finally {
        signalsBusy = false;
      }
    };
    void syncPeers();
    void pollSignals();
    const presenceTimer = window.setInterval(() => void syncPeers(), 2200);
    const signalTimer = window.setInterval(() => void pollSignals(), 700);
    return () => {
      disposed = true;
      window.clearInterval(presenceTimer);
      window.clearInterval(signalTimer);
    };
  }, [
    mediaReady,
    sessionToken,
    myId,
    call.meeting.id,
    makePeer,
    signal,
    processSignal,
    onMeetingEnded,
  ]);

  useEffect(() => {
    const local = localStreamRef.current;
    if (local)
      local.getAudioTracks().forEach((track) => {
        track.enabled = micOn;
      });
    for (const [peerId] of peersRef.current)
      void signal(peerId, "media", { audio: micOn, video: cameraOn, sharing });
  }, [micOn, cameraOn, sharing, mediaReady, signal]);

  const toggleMic = () => {
    if (!localStreamRef.current?.getAudioTracks().length) {
      void requestMedia();
      return;
    }
    setMicOn((value) => !value);
  };
  const toggleCamera = () => {
    if (!localStreamRef.current?.getVideoTracks().length) {
      void requestMedia();
      return;
    }
    const next = !cameraOn;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    for (const sender of sendersRef.current.values())
      if (sender.video?.track && !sharing) sender.video.track.enabled = next;
    setCameraOn(next);
  };

  const toggleScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      const camera = localStreamRef.current?.getVideoTracks()[0] ?? null;
      for (const sender of sendersRef.current.values()) {
        if (sender.video) {
          await sender.video.replaceTrack(camera).catch(() => undefined);
          if (sender.video.track) sender.video.track.enabled = cameraOn;
        }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setSharing(false);
      return;
    }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw new Error("Screen sharing is not available in this browser.");
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenStreamRef.current = display;
      for (const [peerId, senders] of sendersRef.current) {
        if (senders.video) await senders.video.replaceTrack(track).catch(() => undefined);
        else {
          const peer = peersRef.current.get(peerId);
          if (peer) senders.video = peer.addTrack(track, display);
        }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = display;
      setSharing(true);
      track.onended = () => {
        if (screenStreamRef.current) void toggleScreenShare();
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not share your screen.";
      if (reason.toLowerCase().includes("cancel")) return;
      setMediaError(reason);
    }
  };

  const allParticipants = useMemo(() => {
    const others = participants.filter((person) => person.id !== myId);
    return currentUser
      ? [{ ...currentUser, status: "joined" as const, joined_at: call.joinedAt }, ...others]
      : others;
  }, [participants, myId, currentUser, call.joinedAt]);
  const gridClass =
    allParticipants.length <= 1
      ? "grid-cols-1"
      : allParticipants.length <= 4
        ? "grid-cols-2"
        : "grid-cols-2 lg:grid-cols-3";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#101319] text-white">
      <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold">{call.meeting.title}</p>
            <p className="mt-0.5 text-[10px] text-white/55">
              {allParticipants.length} participant{allParticipants.length === 1 ? "" : "s"} ·{" "}
              {!mediaReady
                ? "Requesting camera & mic…"
                : localStreamRef.current
                  ? "Camera & mic ready"
                  : "Camera/mic unavailable"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onExpandChange(!expanded)}
            aria-label={expanded ? "Exit expanded view" : "Expand meeting"}
            title={expanded ? "Exit expanded view" : "Expand meeting"}
            className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/80 hover:bg-white/15 md:flex"
          >
            {expanded ? <Minimize2 className="size-4" /> : <Expand className="size-4" />}
          </button>
        </div>
        {mediaError && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100"
          >
            <span>{mediaError}</span>
            <button
              type="button"
              onClick={() => void requestMedia()}
              disabled={requestingMedia}
              className="rounded-lg border border-amber-200/30 px-2.5 py-1.5 font-semibold hover:bg-amber-100/10 disabled:opacity-50"
            >
              {requestingMedia ? "Requesting…" : "Allow camera & mic"}
            </button>
          </div>
        )}
        <div
          className={cn("grid min-h-[180px] flex-1 auto-rows-fr gap-2 overflow-y-auto", gridClass)}
        >
          {allParticipants.map((person) => {
            const isLocal = person.id === myId;
            const media = isLocal
              ? { audio: micOn, video: cameraOn, sharing }
              : (remoteMedia.get(person.id) ?? { audio: true, video: true, sharing: false });
            const stream = isLocal ? undefined : remoteStreams.get(person.id);
            const peerState = isLocal ? "connected" : (peerStates.get(person.id) ?? "new");
            const showVideo = isLocal ? cameraOn || sharing : media.video || media.sharing;
            return (
              <article
                key={person.id}
                className="relative min-h-[155px] overflow-hidden rounded-2xl border border-white/10 bg-[#20242d] sm:min-h-[210px]"
              >
                {showVideo &&
                (isLocal
                  ? mediaReady && (localStreamRef.current || screenStreamRef.current)
                  : stream) ? (
                  <video
                    ref={
                      isLocal
                        ? attachLocalVideo
                        : (node) => {
                            if (!node) {
                              remoteVideoRefs.current.delete(person.id);
                              return;
                            }
                            remoteVideoRefs.current.set(person.id, node);
                            if (stream && node.srcObject !== stream) node.srcObject = stream;
                            void node.play().catch(() => {
                              node.muted = true;
                              setMutedPeers((previous) =>
                                previous.has(person.id)
                                  ? previous
                                  : new Set(previous).add(person.id),
                              );
                              void node.play().catch(() => undefined);
                            });
                          }
                    }
                    autoPlay
                    playsInline
                    muted={isLocal || mutedPeers.has(person.id)}
                    className={cn(
                      "absolute inset-0 size-full object-cover",
                      isLocal && !sharing && "[transform:scaleX(-1)]",
                    )}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#292e3a] to-[#171a22]">
                    <span className="flex size-16 items-center justify-center rounded-full bg-white/10 text-xl font-semibold text-white/90">
                      {initials(displayName(person))}
                    </span>
                    {!isLocal && (
                      <p className="mt-3 px-3 text-center text-[10px] text-white/50">
                        {peerState === "failed"
                          ? "Connection failed — check the network"
                          : peerState === "disconnected"
                            ? "Reconnecting…"
                            : peerState === "connected" && !media.video
                              ? "Camera is off"
                              : peerState === "connected"
                                ? "Waiting for video"
                                : "Connecting video…"}
                      </p>
                    )}
                  </div>
                )}
                {!isLocal && mutedPeers.has(person.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      const video = remoteVideoRefs.current.get(person.id);
                      if (video) {
                        video.muted = false;
                        void video.play().catch(() => undefined);
                      }
                      setMutedPeers((previous) => {
                        const next = new Set(previous);
                        next.delete(person.id);
                        return next;
                      });
                    }}
                    className="absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1.5 text-[10px] font-medium text-white backdrop-blur"
                  >
                    Tap to enable audio
                  </button>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8">
                  <span className="truncate text-xs font-medium">
                    {isLocal ? "You" : displayName(person)}
                    {media.sharing ? " · sharing screen" : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-white/85">
                    {!media.audio && <MicOff className="size-3.5" />}
                    {!media.video && !media.sharing && <VideoOff className="size-3.5" />}
                  </span>
                </div>
                {isLocal && !mediaReady && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <LoaderCircle className="size-5 animate-spin text-white/70" />
                  </div>
                )}
              </article>
            );
          })}
          {allParticipants.length < 2 && (
            <div className="flex min-h-[90px] items-center justify-center rounded-2xl border border-dashed border-white/15 px-4 text-center text-xs text-white/50">
              You’re in. Invitees can join from their Meet panel.
            </div>
          )}
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-[#171a21] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={toggleMic}
          title={micOn ? "Mute microphone" : "Turn microphone on"}
          aria-label={micOn ? "Mute microphone" : "Turn microphone on"}
          className={cn(
            "flex size-11 items-center justify-center rounded-full transition",
            micOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-white text-[#171a21]",
          )}
        >
          {micOn ? <Mic className="size-4.5" /> : <MicOff className="size-4.5" />}
        </button>
        <button
          type="button"
          onClick={toggleCamera}
          title={cameraOn ? "Turn camera off" : "Turn camera on"}
          aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
          className={cn(
            "flex size-11 items-center justify-center rounded-full transition",
            cameraOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-white text-[#171a21]",
          )}
        >
          {cameraOn ? <Video className="size-4.5" /> : <VideoOff className="size-4.5" />}
        </button>
        <button
          type="button"
          onClick={() => void toggleScreenShare()}
          title={sharing ? "Stop sharing" : "Share screen"}
          aria-label={sharing ? "Stop sharing" : "Share screen"}
          className={cn(
            "flex size-11 items-center justify-center rounded-full transition",
            sharing
              ? "bg-primary text-primary-foreground"
              : "bg-white/10 text-white hover:bg-white/15",
          )}
        >
          <MonitorUp className="size-4.5" />
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="flex h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-xs font-semibold text-white transition hover:bg-red-500"
        >
          <ArrowLeft className="size-4" />
          <span>Leave</span>
        </button>
        {canEnd && (
          <button
            type="button"
            onClick={onEnd}
            title="End for everyone"
            className="flex h-11 items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-3 text-[11px] font-medium text-red-200 transition hover:bg-red-500/20"
          >
            <X className="size-3.5" />
            <span>End meeting</span>
          </button>
        )}
      </footer>
    </div>
  );
}

export function MeetTrigger() {
  const { open, toggle } = useOrcaAI();
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        open
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Video className="size-3.5" />
      Meet
    </button>
  );
}
