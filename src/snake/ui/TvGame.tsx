"use client";

import { observer } from "mobx-react-lite";
import { getTvController } from "~/snake/tvController";
import { GRID_SIZE } from "~/snake/types";

export const TvGame = observer(() => {
  const controller = getTvController();

  if (controller == null) {
    return null;
  }

  const { gameState, phoneConnected, connectionStatus } = controller;
  const cellSize = Math.min(
    typeof window !== "undefined" ? window.innerHeight / (GRID_SIZE + 4) : 30,
    30
  );

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-gray-900">
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-8 text-white">
        <div className="text-2xl font-bold">Score: {gameState.score}</div>
        <div className="flex items-center gap-2">
          <div
            className={`h-3 w-3 rounded-full ${
              phoneConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm">
            {connectionStatus === "waiting"
              ? "Waiting for phone..."
              : connectionStatus === "connected"
                ? "Phone connected"
                : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Game grid */}
      <div
        className="relative border-2 border-gray-600 bg-gray-800"
        style={{
          width: GRID_SIZE * cellSize,
          height: GRID_SIZE * cellSize,
        }}
      >
        {/* Food */}
        <div
          className="absolute rounded-full bg-red-500"
          style={{
            width: cellSize - 2,
            height: cellSize - 2,
            left: gameState.food.x * cellSize + 1,
            top: gameState.food.y * cellSize + 1,
          }}
        />

        {/* Snake */}
        {gameState.snake.map((segment, index) => (
          <div
            key={index}
            className={`absolute ${
              index === 0 ? "bg-green-400" : "bg-green-600"
            }`}
            style={{
              width: cellSize - 2,
              height: cellSize - 2,
              left: segment.x * cellSize + 1,
              top: segment.y * cellSize + 1,
              borderRadius: index === 0 ? 4 : 2,
            }}
          />
        ))}

        {/* Overlay for waiting/gameover states */}
        {gameState.status !== "playing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-center text-white">
              {gameState.status === "waiting" ? (
                <>
                  <div className="text-4xl font-bold">SNAKE</div>
                  <div className="mt-4 text-xl">
                    {phoneConnected
                      ? "Press START on your phone"
                      : "Waiting for phone to connect..."}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-4xl font-bold">GAME OVER</div>
                  <div className="mt-4 text-2xl">Score: {gameState.score}</div>
                  <div className="mt-2 text-lg">
                    Press RESET on your phone to play again
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-4 text-gray-400">
        Open <span className="font-mono text-white">/phone</span> on your mobile
        device to play
      </div>
    </div>
  );
});
