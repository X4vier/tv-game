// WebRTC Signaling Types
export type SdpSignal = {
  type: "offer" | "answer";
  sdp: string;
};

export type IceCandidateSignal = {
  candidate: {
    candidate: string;
    sdpMLineIndex: number | null;
    sdpMid: string | null;
  };
};

export type Direction = "up" | "down" | "left" | "right";

export type GameStatus = "waiting" | "playing" | "gameover";

export type Position = {
  x: number;
  y: number;
};

export type GameState = {
  snake: Position[];
  food: Position;
  direction: Direction;
  score: number;
  status: GameStatus;
};

// Messages sent from Phone to TV
export type PhoneMessage =
  | { type: "direction"; direction: Direction }
  | { type: "reset" };

// Messages sent from TV to Phone
export type TvMessage = {
  type: "gameState";
  status: GameStatus;
  score: number;
};

export const GRID_SIZE = 20;
export const TICK_INTERVAL = 150;
