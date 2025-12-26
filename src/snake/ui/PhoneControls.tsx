"use client";

import { observer } from "mobx-react-lite";
import { getPhoneController } from "~/snake/phoneController";
import { type Direction } from "~/snake/types";

const ArrowButton = ({
  direction,
  onPress,
}: {
  direction: Direction;
  onPress: (dir: Direction) => void;
}) => {
  const arrows: Record<Direction, string> = {
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
  };

  return (
    <button
      className="flex h-full w-full touch-none select-none items-center justify-center bg-gray-800 text-7xl text-white active:bg-gray-600"
      onTouchStart={() => onPress(direction)}
      onMouseDown={() => onPress(direction)}
    >
      {arrows[direction]}
    </button>
  );
};

export const PhoneControls = observer(() => {
  const controller = getPhoneController();

  if (controller == null) {
    return null;
  }

  const { gameStatus, connectionStatus } = controller;

  // Show connecting state
  if (connectionStatus === "connecting" || connectionStatus === "disconnected") {
    return (
      <div className="flex h-dvh w-screen flex-col items-center justify-center bg-gray-900">
        <div className="text-2xl text-white">
          {connectionStatus === "connecting"
            ? "Connecting to TV..."
            : "Disconnected"}
        </div>
        <div className="mt-4 text-gray-400">
          Make sure the TV page is open at /tv
        </div>
      </div>
    );
  }

  // Show reset/start button when not playing
  if (gameStatus === "waiting" || gameStatus === "gameover") {
    return (
      <div className="flex h-dvh w-screen flex-col bg-gray-900">
        <button
          className="flex flex-1 touch-none select-none items-center justify-center bg-green-600 text-5xl font-bold text-white active:bg-green-700"
          onTouchStart={() => controller.sendReset()}
          onMouseDown={() => controller.sendReset()}
        >
          {gameStatus === "waiting" ? "START" : "PLAY AGAIN"}
        </button>
      </div>
    );
  }

  // Show arrow controls during gameplay
  return (
    <div className="grid h-dvh w-screen grid-cols-3 grid-rows-3 bg-gray-900">
      {/* Row 1 */}
      <div />
      <ArrowButton
        direction="up"
        onPress={(dir) => controller.sendDirection(dir)}
      />
      <div />

      {/* Row 2 */}
      <ArrowButton
        direction="left"
        onPress={(dir) => controller.sendDirection(dir)}
      />
      <div className="flex items-center justify-center bg-gray-900 text-gray-600">
        {/* Center - could show score or be empty */}
      </div>
      <ArrowButton
        direction="right"
        onPress={(dir) => controller.sendDirection(dir)}
      />

      {/* Row 3 */}
      <div />
      <ArrowButton
        direction="down"
        onPress={(dir) => controller.sendDirection(dir)}
      />
      <div />
    </div>
  );
});
