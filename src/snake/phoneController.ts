import { action, makeObservable, observable, runInAction } from "mobx";
import Peer from "simple-peer";
import { getTrpcClient } from "~/trpc/client";
import {
  type Direction,
  type GameStatus,
  type IceCandidateSignal,
  type PhoneMessage,
  type SdpSignal,
  type TvMessage,
} from "./types";

// Debug logging helper
const log = (msg: string, data?: unknown) => {
  const timestamp = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[Phone ${timestamp}] ${msg}`, data);
  } else {
    console.log(`[Phone ${timestamp}] ${msg}`);
  }
};

let phoneController: PhoneController | undefined;

export function getPhoneController() {
  if (typeof window === "undefined") {
    return null;
  }
  phoneController ??= new PhoneController();
  return phoneController;
}

class PhoneController {
  @observable isConnected = false;
  @observable gameStatus: GameStatus = "waiting";
  @observable score = 0;
  @observable connectionStatus: "disconnected" | "connecting" | "connected" =
    "disconnected";

  private trpc = getTrpcClient();
  private peer: Peer.Instance | null = null;
  private sessionId: string | null = null;
  private phoneId: string | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private iceCandidatePollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastTvCandidateIndex = 0;
  private pendingIceCandidates: IceCandidateSignal[] = [];

  constructor() {
    makeObservable(this);
    log("PhoneController constructor called");
    void this.connectToTv();
  }

  @action
  private async connectToTv() {
    log("connectToTv starting");
    this.connectionStatus = "connecting";

    // Poll for available TV session
    log("Starting polling for TV session (every 1s)");
    this.pollingInterval = setInterval(() => {
      void this.pollForTvSession();
    }, 1000);
  }

  private async pollForTvSession() {
    log("Polling for TV session...");
    const { session } = await this.trpc.signaling.getAvailableSession.query();
    log("Got session response", { hasSession: !!session });

    if (session && !this.peer) {
      log("Found TV session", {
        sessionId: session.sessionId,
        offerLength: session.offer.sdp.length,
        tvCandidateCount: session.tvIceCandidates.length,
      });
      this.stopPolling();
      this.sessionId = session.sessionId;
      this.createPeerAndConnect(session.offer, session.tvIceCandidates);
    }
  }

  private stopPolling() {
    log("Stopping session polling");
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private stopIceCandidatePolling() {
    log("Stopping ICE candidate polling");
    if (this.iceCandidatePollingInterval) {
      clearInterval(this.iceCandidatePollingInterval);
      this.iceCandidatePollingInterval = null;
    }
  }

  private createPeerAndConnect(offer: SdpSignal, initialTvCandidates: IceCandidateSignal[]) {
    log("Creating peer (non-initiator) with STUN servers");
    this.peer = new Peer({
      initiator: false,
      trickle: true,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      },
    });

    this.peer.on("signal", (data) => {
      log("Peer emitted signal event", { type: data.type, hasCandidate: "candidate" in data });
      void this.handleSignal(data);
    });

    this.peer.on("connect", () => {
      log("Peer CONNECTED! Data channel is open");
      this.stopIceCandidatePolling();
      runInAction(() => {
        this.isConnected = true;
        this.connectionStatus = "connected";
      });
    });

    this.peer.on("data", (data: Uint8Array) => {
      log("Received data from TV", data.toString());
      this.handleTvMessage(data);
    });

    this.peer.on("close", () => {
      log("Peer connection CLOSED");
      runInAction(() => {
        this.isConnected = false;
        this.connectionStatus = "disconnected";
        this.gameStatus = "waiting";
      });
      // Reinitialize for reconnection
      void this.reinitialize();
    });

    this.peer.on("error", (err) => {
      log("Peer ERROR", { message: err.message, name: err.name, stack: err.stack });
      runInAction(() => {
        this.isConnected = false;
        this.connectionStatus = "disconnected";
      });
    });

    log("Peer event handlers registered, signaling TV offer to peer");
    // Signal the offer to establish connection
    this.peer.signal({ type: offer.type, sdp: offer.sdp });

    // Signal initial TV ICE candidates
    this.lastTvCandidateIndex = initialTvCandidates.length;
    for (const candidate of initialTvCandidates) {
      log("Signaling initial TV ICE candidate");
      this.peer.signal({
        type: "candidate",
        candidate: candidate.candidate as unknown as RTCIceCandidate,
      });
    }

    log("Starting ICE candidate polling");
    // Poll for additional TV ICE candidates
    this.iceCandidatePollingInterval = setInterval(() => {
      void this.pollForTvIceCandidates();
    }, 500);
  }

  private async pollForTvIceCandidates() {
    if (!this.sessionId || !this.peer || this.connectionStatus === "connected") {
      return;
    }

    const { candidates, nextIndex } = await this.trpc.signaling.getTvIceCandidates.query({
      sessionId: this.sessionId,
      afterIndex: this.lastTvCandidateIndex,
    });

    if (candidates.length > 0) {
      log("Got new TV ICE candidates", { count: candidates.length });
      for (const candidate of candidates) {
        log("Signaling TV ICE candidate to peer");
        this.peer.signal({
          type: "candidate",
          candidate: candidate.candidate as unknown as RTCIceCandidate,
        });
      }
      this.lastTvCandidateIndex = nextIndex;
    }
  }

  private async handleSignal(data: Peer.SignalData) {
    if (data.type === "answer" && data.sdp) {
      log("Got answer from peer, joining session", { sdpLength: data.sdp.length });

      if (!this.sessionId) {
        log("No sessionId, cannot join");
        return;
      }

      // Join the session with our answer
      const { phoneId } = await this.trpc.signaling.joinSession.mutate({
        sessionId: this.sessionId,
        answer: { type: "answer", sdp: data.sdp },
      });

      this.phoneId = phoneId;
      log("Joined session", { phoneId });

      // Send any pending ICE candidates
      for (const candidate of this.pendingIceCandidates) {
        await this.trpc.signaling.addPhoneIceCandidate.mutate({
          phoneId,
          candidate,
        });
      }
      this.pendingIceCandidates = [];
    } else if ("candidate" in data && data.candidate) {
      const candidate: IceCandidateSignal = {
        candidate: {
          candidate: data.candidate.candidate,
          sdpMLineIndex: data.candidate.sdpMLineIndex ?? null,
          sdpMid: data.candidate.sdpMid ?? null,
        },
      };

      if (this.phoneId) {
        log("Sending ICE candidate to signaling server", {
          candidate: data.candidate.candidate.slice(0, 50) + "...",
        });
        await this.trpc.signaling.addPhoneIceCandidate.mutate({
          phoneId: this.phoneId,
          candidate,
        });
      } else {
        // Queue until we have a phoneId
        log("Queueing ICE candidate (no phoneId yet)");
        this.pendingIceCandidates.push(candidate);
      }
    }
  }

  private handleTvMessage(data: Uint8Array) {
    try {
      const message = JSON.parse(data.toString()) as TvMessage;

      if (message.type === "gameState") {
        runInAction(() => {
          this.gameStatus = message.status;
          this.score = message.score;
        });
      }
    } catch {
      console.log("Failed to parse TV message");
    }
  }

  @action
  sendDirection(direction: Direction) {
    if (this.peer && this.isConnected) {
      log("Sending direction", direction);
      const message: PhoneMessage = { type: "direction", direction };
      this.peer.send(JSON.stringify(message));
    } else {
      log("Cannot send direction - not connected", { hasPeer: !!this.peer, isConnected: this.isConnected });
    }
  }

  @action
  sendReset() {
    if (this.peer && this.isConnected) {
      log("Sending reset");
      const message: PhoneMessage = { type: "reset" };
      this.peer.send(JSON.stringify(message));
    } else {
      log("Cannot send reset - not connected", { hasPeer: !!this.peer, isConnected: this.isConnected });
    }
  }

  private async reinitialize() {
    log("Reinitializing connection...");
    this.peer = null;
    this.sessionId = null;
    this.phoneId = null;
    this.lastTvCandidateIndex = 0;
    this.pendingIceCandidates = [];
    this.stopIceCandidatePolling();
    await this.connectToTv();
  }

  destroy() {
    this.stopPolling();
    this.stopIceCandidatePolling();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
