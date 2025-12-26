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

  constructor() {
    makeObservable(this);
    void this.initializeWebRTC();
  }

  @action
  private async initializeWebRTC() {
    this.connectionStatus = "waiting";

    // Create peer as initiator
    this.peer = new Peer({
      initiator: true,
      trickle: true,
    });

    this.peer.on("signal", (data) => {
      void this.handleSignal(data);
    });

    this.peer.on("connect", () => {
      runInAction(() => {
        this.phoneConnected = true;
        this.connectionStatus = "connected";
      });
      this.stopPolling();
      this.sendGameState();
    });

    this.peer.on("data", (data: Uint8Array) => {
      this.handlePhoneMessage(data);
    });

    this.peer.on("close", () => {
      runInAction(() => {
        this.phoneConnected = false;
        this.connectionStatus = "disconnected";
      });
      this.stopGame();
      // Reinitialize for next connection
      void this.reinitialize();
    });

    this.peer.on("error", (err) => {
      console.log(`WebRTC error: ${err.message}`);
      runInAction(() => {
        this.phoneConnected = false;
        this.connectionStatus = "disconnected";
      });
    });
  }

  private async handleSignal(data: Peer.SignalData) {
    if (data.type === "offer" && data.sdp) {
      const offer: SdpSignal = { type: "offer", sdp: data.sdp };
      await this.trpc.signaling.registerTvOffer.mutate({ offer });
      this.startPollingForAnswer();
    } else if ("candidate" in data && data.candidate) {
      const candidate: IceCandidateSignal = {
        candidate: {
          candidate: data.candidate.candidate,
          sdpMLineIndex: data.candidate.sdpMLineIndex ?? null,
          sdpMid: data.candidate.sdpMid ?? null,
        },
      };
      await this.trpc.signaling.addTvIceCandidate.mutate({ candidate });
    }
  }

  private startPollingForAnswer() {
    this.pollingInterval = setInterval(() => {
      void this.pollForAnswer();
    }, 1000);
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async pollForAnswer() {
    const { answer } = await this.trpc.signaling.getPhoneAnswer.query();
    if (answer && this.peer) {
      this.peer.signal({ type: answer.type, sdp: answer.sdp });
    }

    // Also check for ICE candidates
    const { candidates } = await this.trpc.signaling.getPhoneIceCandidates.query();
    if (candidates.length > this.lastProcessedCandidateIndex) {
      for (let i = this.lastProcessedCandidateIndex; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (candidate && this.peer) {
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
    await this.trpc.signaling.clear.mutate();
    this.lastProcessedCandidateIndex = 0;
    this.peer = null;
    this.gameState = createInitialState();
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
