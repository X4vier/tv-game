import { action, makeObservable, observable, runInAction } from "mobx";
import Peer from "simple-peer";
import { getTrpcClient } from "~/trpc/client";
import { createInitialState, tick } from "./gameLogic";
import {
  type Direction,
  type GameState,
  type IceCandidateSignal,
  type PhoneMessage,
  type SdpSignal,
  type TvMessage,
  TICK_INTERVAL,
} from "./types";

// Debug logging helper
const log = (msg: string, data?: unknown) => {
  const timestamp = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[TV ${timestamp}] ${msg}`, data);
  } else {
    console.log(`[TV ${timestamp}] ${msg}`);
  }
};

let tvController: TvController | undefined;

export function getTvController() {
  if (typeof window === "undefined") {
    return null;
  }
  tvController ??= new TvController();
  return tvController;
}

// Track a connected phone
type PhoneConnection = {
  phoneId: string;
  peer: Peer.Instance;
  connected: boolean;
  lastCandidateIndex: number;
};

class TvController {
  @observable gameState: GameState = createInitialState();
  @observable phoneConnected = false;
  @observable connectionStatus: "disconnected" | "waiting" | "connected" =
    "disconnected";
  @observable connectedPhoneCount = 0;

  private trpc = getTrpcClient();
  private sessionId: string | null = null;
  private phones = new Map<string, PhoneConnection>();
  private gameInterval: ReturnType<typeof setInterval> | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingDirection: Direction | null = null;

  constructor() {
    makeObservable(this);
    log("TvController constructor called");
    void this.initializeSession();
  }

  @action
  private async initializeSession() {
    log("initializeSession starting");
    this.connectionStatus = "waiting";

    // Create peer as initiator
    log("Creating initiator peer with STUN servers");
    const peer = new Peer({
      initiator: true,
      trickle: true,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      },
    });

    // Wait for the offer signal
    peer.on("signal", (data) => {
      void this.handlePeerSignal(data);
    });

    // Store the peer temporarily for signaling
    // We'll create per-phone peers when phones connect
    this._initiatorPeer = peer;
    log("Peer event handlers registered");
  }

  private _initiatorPeer: Peer.Instance | null = null;
  private _processedPhones = new Set<string>();
  private _pendingIceCandidates: Array<{ candidate: string; sdpMLineIndex: number | null; sdpMid: string | null }> = [];

  private async handlePeerSignal(data: Peer.SignalData) {
    if (data.type === "offer" && data.sdp) {
      log("Got offer from peer, creating session", { sdpLength: data.sdp.length });

      // Create session with offer
      const { sessionId } = await this.trpc.signaling.createSession.mutate({
        offer: { type: "offer", sdp: data.sdp },
      });

      this.sessionId = sessionId;
      log("Session created", { sessionId });

      // Send any pending ICE candidates
      for (const candidate of this._pendingIceCandidates) {
        await this.trpc.signaling.addTvIceCandidate.mutate({
          sessionId,
          candidate: { candidate },
        });
      }
      this._pendingIceCandidates = [];

      // Start polling for phone connections
      this.startPollingForPhones();
    } else if ("candidate" in data && data.candidate) {
      const candidateData = {
        candidate: data.candidate.candidate,
        sdpMLineIndex: data.candidate.sdpMLineIndex ?? null,
        sdpMid: data.candidate.sdpMid ?? null,
      };

      if (this.sessionId) {
        log("Sending TV ICE candidate", {
          candidate: data.candidate.candidate.slice(0, 50) + "...",
        });
        await this.trpc.signaling.addTvIceCandidate.mutate({
          sessionId: this.sessionId,
          candidate: { candidate: candidateData },
        });
      } else {
        // Queue until we have a session
        log("Queueing TV ICE candidate (no session yet)");
        this._pendingIceCandidates.push(candidateData);
      }
    }
  }

  private startPollingForPhones() {
    log("Starting polling for phone connections (every 1s)");
    this.pollingInterval = setInterval(() => {
      void this.pollForPhones();
    }, 1000);
  }

  private stopPolling() {
    log("Stopping polling");
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async pollForPhones() {
    if (!this.sessionId) return;

    const { connections } = await this.trpc.signaling.getPhoneConnections.query({
      sessionId: this.sessionId,
    });

    log("Polled for phones", {
      connectionCount: connections.length,
      processedCount: this._processedPhones.size
    });

    for (const conn of connections) {
      // Process new phones
      if (!this._processedPhones.has(conn.phoneId) && conn.answer) {
        log("New phone connection found", { phoneId: conn.phoneId });
        this._processedPhones.add(conn.phoneId);
        this.handleNewPhoneConnection(conn.phoneId, conn.answer, conn.iceCandidates);
      } else if (this._processedPhones.has(conn.phoneId)) {
        // Check for new ICE candidates from existing phones
        const phone = this.phones.get(conn.phoneId);
        if (phone && conn.iceCandidates.length > phone.lastCandidateIndex) {
          for (let i = phone.lastCandidateIndex; i < conn.iceCandidates.length; i++) {
            const candidate = conn.iceCandidates[i];
            if (candidate) {
              log("Processing phone ICE candidate", { phoneId: conn.phoneId, index: i });
              phone.peer.signal({
                type: "candidate",
                candidate: candidate.candidate as unknown as RTCIceCandidate,
              });
            }
          }
          phone.lastCandidateIndex = conn.iceCandidates.length;
        }
      }
    }
  }

  private handleNewPhoneConnection(
    phoneId: string,
    answer: SdpSignal,
    iceCandidates: IceCandidateSignal[]
  ) {
    log("Setting up connection for phone", { phoneId, candidateCount: iceCandidates.length });

    // Use the initiator peer for the first connection
    // For multi-phone, we'd create new peers, but for now use the existing one
    const peer = this._initiatorPeer;
    if (!peer) {
      log("No initiator peer available");
      return;
    }

    // Store phone connection
    const phoneConn: PhoneConnection = {
      phoneId,
      peer,
      connected: false,
      lastCandidateIndex: iceCandidates.length,
    };
    this.phones.set(phoneId, phoneConn);

    // Set up peer event handlers
    peer.on("connect", () => {
      log("Peer CONNECTED!", { phoneId });
      phoneConn.connected = true;
      runInAction(() => {
        this.phoneConnected = true;
        this.connectionStatus = "connected";
        this.connectedPhoneCount = Array.from(this.phones.values()).filter(p => p.connected).length;
      });
      this.sendGameState();
    });

    peer.on("data", (data: Uint8Array) => {
      log("Received data from phone", { phoneId, data: data.toString() });
      this.handlePhoneMessage(data);
    });

    peer.on("close", () => {
      log("Peer connection CLOSED", { phoneId });
      this.phones.delete(phoneId);
      runInAction(() => {
        this.connectedPhoneCount = Array.from(this.phones.values()).filter(p => p.connected).length;
        this.phoneConnected = this.connectedPhoneCount > 0;
        if (!this.phoneConnected) {
          this.connectionStatus = "disconnected";
          this.stopGame();
          void this.reinitialize();
        }
      });
    });

    peer.on("error", (err) => {
      log("Peer ERROR", { phoneId, message: err.message, name: err.name });
      this.phones.delete(phoneId);
      runInAction(() => {
        this.connectedPhoneCount = Array.from(this.phones.values()).filter(p => p.connected).length;
        this.phoneConnected = this.connectedPhoneCount > 0;
        if (!this.phoneConnected) {
          this.connectionStatus = "disconnected";
        }
      });
    });

    // Signal the answer
    log("Signaling answer to peer", { phoneId, sdpLength: answer.sdp.length });
    peer.signal({ type: answer.type, sdp: answer.sdp });

    // Signal any ICE candidates
    for (const candidate of iceCandidates) {
      log("Signaling ICE candidate to peer", { phoneId });
      peer.signal({
        type: "candidate",
        candidate: candidate.candidate as unknown as RTCIceCandidate,
      });
    }
  }

  private handlePhoneMessage(data: Uint8Array) {
    try {
      const message = JSON.parse(data.toString()) as PhoneMessage;

      if (message.type === "direction") {
        this.pendingDirection = message.direction;
      } else if (message.type === "reset") {
        this.resetGame();
      }
    } catch {
      console.log("Failed to parse phone message");
    }
  }

  @action
  resetGame() {
    this.gameState = createInitialState();
    this.gameState.status = "playing";
    this.pendingDirection = null;
    this.startGame();
    this.sendGameState();
  }

  private startGame() {
    this.stopGame();
    this.gameInterval = setInterval(() => {
      this.gameTick();
    }, TICK_INTERVAL);
  }

  private stopGame() {
    if (this.gameInterval) {
      clearInterval(this.gameInterval);
      this.gameInterval = null;
    }
  }

  @action
  private gameTick() {
    const direction = this.pendingDirection ?? undefined;
    this.pendingDirection = null;

    const newState = tick(this.gameState, direction);
    this.gameState = newState;

    if (newState.status === "gameover") {
      this.stopGame();
    }

    this.sendGameState();
  }

  private sendGameState() {
    const message: TvMessage = {
      type: "gameState",
      status: this.gameState.status,
      score: this.gameState.score,
    };

    // Send to all connected phones
    for (const phone of this.phones.values()) {
      if (phone.connected) {
        phone.peer.send(JSON.stringify(message));
      }
    }
  }

  private async reinitialize() {
    log("Reinitializing session...");

    // Clear old session
    if (this.sessionId) {
      await this.trpc.signaling.clearSession.mutate({ sessionId: this.sessionId });
    }

    // Reset state
    this.sessionId = null;
    this.phones.clear();
    this._processedPhones.clear();
    this._pendingIceCandidates = [];
    this._initiatorPeer = null;
    this.gameState = createInitialState();

    log("State reset, reinitializing");
    await this.initializeSession();
  }

  destroy() {
    this.stopGame();
    this.stopPolling();
    for (const phone of this.phones.values()) {
      phone.peer.destroy();
    }
    this.phones.clear();
  }
}
