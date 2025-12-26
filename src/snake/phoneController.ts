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
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastProcessedCandidateIndex = 0;

  constructor() {
    makeObservable(this);
    log("PhoneController constructor called");
    void this.connectToTv();
  }

  @action
  private async connectToTv() {
    log("connectToTv starting");
    this.connectionStatus = "connecting";

    // Poll for TV's offer
    log("Starting polling for TV offer (every 1s)");
    this.pollingInterval = setInterval(() => {
      void this.pollForTvOffer();
    }, 1000);
  }

  private async pollForTvOffer() {
    log("Polling for TV offer...");
    const { offer } = await this.trpc.signaling.getTvOffer.query();
    log("Got offer response", { hasOffer: !!offer, hasPeer: !!this.peer });

    if (offer && !this.peer) {
      log("Found TV offer, creating peer connection", { sdpLength: offer.sdp.length });
      this.stopPolling();
      this.createPeerAndConnect(offer);
    }
  }

  private stopPolling() {
    log("Stopping polling");
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private createPeerAndConnect(offer: SdpSignal) {
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
    log("Offer signaled, starting to poll for TV ICE candidates");

    // Also fetch any ICE candidates from TV
    void this.pollForIceCandidates();
  }

  private pollForIceCandidates() {
    log("Starting ICE candidate polling (every 500ms)");
    const pollInterval = setInterval(() => {
      if (!this.peer || this.connectionStatus === "connected") {
        log("Stopping ICE candidate polling", { hasPeer: !!this.peer, connectionStatus: this.connectionStatus });
        clearInterval(pollInterval);
        return;
      }

      void this.fetchAndProcessIceCandidates();
    }, 500);
  }

  private async fetchAndProcessIceCandidates() {
    const { candidates } = await this.trpc.signaling.getTvIceCandidates.query();
    const newCount = candidates.length - this.lastProcessedCandidateIndex;
    if (newCount > 0) {
      log("Got TV ICE candidates", { total: candidates.length, newCount });
    }
    if (candidates.length > this.lastProcessedCandidateIndex) {
      for (let i = this.lastProcessedCandidateIndex; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (candidate && this.peer) {
          log("Processing TV ICE candidate", { index: i, candidate: candidate.candidate.candidate.slice(0, 50) + "..." });
          this.peer.signal({
            type: "candidate",
            candidate: candidate.candidate as unknown as RTCIceCandidate,
          });
        }
      }
      this.lastProcessedCandidateIndex = candidates.length;
    }
  }

  private async handleSignal(data: Peer.SignalData) {
    if (data.type === "answer" && data.sdp) {
      log("Sending ANSWER to signaling server", { sdpLength: data.sdp.length });
      const answer: SdpSignal = { type: "answer", sdp: data.sdp };
      await this.trpc.signaling.sendPhoneAnswer.mutate({ answer });
      log("Answer sent successfully");
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
      await this.trpc.signaling.addPhoneIceCandidate.mutate({ candidate });
      log("ICE candidate sent successfully");
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
    this.lastProcessedCandidateIndex = 0;
    await this.connectToTv();
  }

  destroy() {
    this.stopPolling();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
