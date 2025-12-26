import {
  type Direction,
  type GameState,
  type Position,
  GRID_SIZE,
} from "./types";

export function createInitialState(): GameState {
  const centerX = Math.floor(GRID_SIZE / 2);
  const centerY = Math.floor(GRID_SIZE / 2);

  return {
    snake: [
      { x: centerX, y: centerY },
      { x: centerX - 1, y: centerY },
      { x: centerX - 2, y: centerY },
    ],
    food: spawnFood([{ x: centerX, y: centerY }]),
    direction: "right",
    score: 0,
    status: "waiting",
  };
}

export function spawnFood(snake: Position[]): Position {
  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));

  let food: Position;
  do {
    food = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    };
  } while (occupied.has(`${food.x},${food.y}`));

  return food;
}

export function getOppositeDirection(dir: Direction): Direction {
  switch (dir) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

export function tick(state: GameState, newDirection?: Direction): GameState {
  if (state.status !== "playing") {
    return state;
  }

  // Prevent reversing direction (can't go back on yourself)
  let direction = state.direction;
  if (newDirection && newDirection !== getOppositeDirection(state.direction)) {
    direction = newDirection;
  }

  const head = state.snake[0];
  if (head == null) {
    return state;
  }

  // Calculate new head position
  let newHead: Position;
  switch (direction) {
    case "up":
      newHead = { x: head.x, y: head.y - 1 };
      break;
    case "down":
      newHead = { x: head.x, y: head.y + 1 };
      break;
    case "left":
      newHead = { x: head.x - 1, y: head.y };
      break;
    case "right":
      newHead = { x: head.x + 1, y: head.y };
      break;
  }

  // Check wall collision
  if (
    newHead.x < 0 ||
    newHead.x >= GRID_SIZE ||
    newHead.y < 0 ||
    newHead.y >= GRID_SIZE
  ) {
    return { ...state, status: "gameover" };
  }

  // Check self collision (exclude tail since it will move)
  const bodyWithoutTail = state.snake.slice(0, -1);
  if (bodyWithoutTail.some((p) => p.x === newHead.x && p.y === newHead.y)) {
    return { ...state, status: "gameover" };
  }

  // Check if eating food
  const ateFood = newHead.x === state.food.x && newHead.y === state.food.y;

  // Build new snake
  const newSnake = [newHead, ...state.snake];
  if (!ateFood) {
    newSnake.pop(); // Remove tail if not eating
  }

  return {
    ...state,
    snake: newSnake,
    direction,
    food: ateFood ? spawnFood(newSnake) : state.food,
    score: ateFood ? state.score + 1 : state.score,
  };
}
