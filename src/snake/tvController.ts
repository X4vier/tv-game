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

class TvController {
  @observable gameState: GameState = createInitialState();
  @observable phoneConnected = false;
  @observable connectionStatus: "disconnected" | "waiting" | "connected" =
    "disconnected";

  private trpc = getTrpcClient();
  private peer: Peer.Instance | null = null;
  private gameInterval: ReturnType<typeof setInterval> | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingDirection: Direction | null = null;
  private lastProcessedCandidateIndex = 0;
  private hasProcessedAnswer = false;

  constructor() {
    makeObservable(this);
    log("TvController constructor called");
    void this.initializeWebRTC();
  }

  @action
  private async initializeWebRTC() {
    log("initializeWebRTC starting");
    this.connectionStatus = "waiting";

    // Create peer as initiator
    log("Creating peer as initiator with STUN servers");
    this.peer = new Peer({
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

    this.peer.on("signal", (data) => {
      log("Peer emitted signal event", { type: data.type, hasCandidate: "candidate" in data });
      void this.handleSignal(data);
    });

    this.peer.on("connect", () => {
      log("Peer CONNECTED! Data channel is open");
      runInAction(() => {
        this.phoneConnected = true;
        this.connectionStatus = "connected";
      });
      this.stopPolling();
      this.sendGameState();
    });

    this.peer.on("data", (data: Uint8Array) => {
      log("Received data from phone", data.toString());
      this.handlePhoneMessage(data);
    });

    this.peer.on("close", () => {
      log("Peer connection CLOSED");
      runInAction(() => {
        this.phoneConnected = false;
        this.connectionStatus = "disconnected";
      });
      this.stopGame();
      // Reinitialize for next connection
      void this.reinitialize();
    });

    this.peer.on("error", (err) => {
      log("Peer ERROR", { message: err.message, name: err.name, stack: err.stack });
      runInAction(() => {
        this.phoneConnected = false;
        this.connectionStatus = "disconnected";
      });
    });

    log("Peer event handlers registered");
  }

  private async handleSignal(data: Peer.SignalData) {
    if (data.type === "offer" && data.sdp) {
      log("Sending OFFER to signaling server", { sdpLength: data.sdp.length });
      const offer: SdpSignal = { type: "offer", sdp: data.sdp };
      await this.trpc.signaling.registerTvOffer.mutate({ offer });
      log("Offer registered, starting to poll for answer");
      this.startPollingForAnswer();
    } else if ("candidate" in data && data.candidate) {
      log("Sending ICE candidate to signaling server", {
        candidate: data.candidate.candidate.slice(0, 50) + "...",
        sdpMid: data.candidate.sdpMid
      });
      const candidate: IceCandidateSignal = {
        candidate: {
          candidate: data.candidate.candidate,
          sdpMLineIndex: data.candidate.sdpMLineIndex ?? null,
          sdpMid: data.candidate.sdpMid ?? null,
        },
      };
      await this.trpc.signaling.addTvIceCandidate.mutate({ candidate });
      log("ICE candidate sent successfully");
    }
  }

  private startPollingForAnswer() {
    log("Starting polling for phone answer (every 1s)");
    this.pollingInterval = setInterval(() => {
      void this.pollForAnswer();
    }, 1000);
  }

  private stopPolling() {
    log("Stopping polling");
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async pollForAnswer() {
    log("Polling...", { hasProcessedAnswer: this.hasProcessedAnswer, lastCandidateIdx: this.lastProcessedCandidateIndex });

    // Only process the answer once
    if (!this.hasProcessedAnswer) {
      const { answer } = await this.trpc.signaling.getPhoneAnswer.query();
      log("Got answer response", { hasAnswer: !!answer });
      if (answer && this.peer) {
        log("Processing phone ANSWER", { sdpLength: answer.sdp.length });
        this.hasProcessedAnswer = true;
        this.peer.signal({ type: answer.type, sdp: answer.sdp });
        log("Answer signaled to peer");
      }
    }

    // Also check for ICE candidates
    const { candidates } = await this.trpc.signaling.getPhoneIceCandidates.query();
    log("Got ICE candidates", { total: candidates.length, newCount: candidates.length - this.lastProcessedCandidateIndex });
    if (candidates.length > this.lastProcessedCandidateIndex) {
      for (let i = this.lastProcessedCandidateIndex; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (candidate && this.peer) {
          log("Processing phone ICE candidate", { index: i, candidate: candidate.candidate.candidate.slice(0, 50) + "..." });
          this.peer.signal({
            type: "candidate",
            candidate: candidate.candidate as unknown as RTCIceCandidate,
          });
        }
      }
      this.lastProcessedCandidateIndex = candidates.length;
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
    if (this.peer && this.phoneConnected) {
      const message: TvMessage = {
        type: "gameState",
        status: this.gameState.status,
        score: this.gameState.score,
      };
      this.peer.send(JSON.stringify(message));
    }
  }

  private async reinitialize() {
    log("Reinitializing connection...");
    await this.trpc.signaling.clear.mutate();
    this.lastProcessedCandidateIndex = 0;
    this.hasProcessedAnswer = false;
    this.peer = null;
    this.gameState = createInitialState();
    log("State reset, reinitializing WebRTC");
    await this.initializeWebRTC();
  }

  destroy() {
    this.stopGame();
    this.stopPolling();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
