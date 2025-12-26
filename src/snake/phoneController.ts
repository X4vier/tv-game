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
    void this.connectToTv();
  }

  @action
  private async connectToTv() {
    this.connectionStatus = "connecting";

    // Poll for TV's offer
    this.pollingInterval = setInterval(() => {
      void this.pollForTvOffer();
    }, 1000);
  }

  private async pollForTvOffer() {
    const { offer } = await this.trpc.signaling.getTvOffer.query();

    if (offer && !this.peer) {
      this.stopPolling();
      this.createPeerAndConnect(offer);
    }
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private createPeerAndConnect(offer: SdpSignal) {
    this.peer = new Peer({
      initiator: false,
      trickle: true,
    });

    this.peer.on("signal", (data) => {
      void this.handleSignal(data);
    });

    this.peer.on("connect", () => {
      runInAction(() => {
        this.isConnected = true;
        this.connectionStatus = "connected";
      });
    });

    this.peer.on("data", (data: Uint8Array) => {
      this.handleTvMessage(data);
    });

    this.peer.on("close", () => {
      runInAction(() => {
        this.isConnected = false;
        this.connectionStatus = "disconnected";
        this.gameStatus = "waiting";
      });
      // Reinitialize for reconnection
      void this.reinitialize();
    });

    this.peer.on("error", (err) => {
      console.log(`WebRTC error: ${err.message}`);
      runInAction(() => {
        this.isConnected = false;
        this.connectionStatus = "disconnected";
      });
    });

    // Signal the offer to establish connection
    this.peer.signal({ type: offer.type, sdp: offer.sdp });

    // Also fetch any ICE candidates from TV
    void this.pollForIceCandidates();
  }

  private pollForIceCandidates() {
    const pollInterval = setInterval(() => {
      if (!this.peer || this.connectionStatus === "connected") {
        clearInterval(pollInterval);
        return;
      }

      void this.fetchAndProcessIceCandidates();
    }, 500);
  }

  private async fetchAndProcessIceCandidates() {
    const { candidates } = await this.trpc.signaling.getTvIceCandidates.query();
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

  private async handleSignal(data: Peer.SignalData) {
    if (data.type === "answer" && data.sdp) {
      const answer: SdpSignal = { type: "answer", sdp: data.sdp };
      await this.trpc.signaling.sendPhoneAnswer.mutate({ answer });
    } else if ("candidate" in data && data.candidate) {
      const candidate: IceCandidateSignal = {
        candidate: {
          candidate: data.candidate.candidate,
          sdpMLineIndex: data.candidate.sdpMLineIndex ?? null,
          sdpMid: data.candidate.sdpMid ?? null,
        },
      };
      await this.trpc.signaling.addPhoneIceCandidate.mutate({ candidate });
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
      const message: PhoneMessage = { type: "direction", direction };
      this.peer.send(JSON.stringify(message));
    }
  }

  @action
  sendReset() {
    if (this.peer && this.isConnected) {
      const message: PhoneMessage = { type: "reset" };
      this.peer.send(JSON.stringify(message));
    }
  }

  private async reinitialize() {
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
