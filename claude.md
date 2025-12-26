When asked to look at a file, always read the file in its entirety.

## Development Server

**NEVER start the dev server yourself.** The user is already running it. Do not execute `bun dev` or similar commands - assume the dev server is always running in the background.

## Code Style and Linting

After finishing making code changes, always run this single command:

```bash
bun check
```

This command runs linting and type checking to ensure code follows the project's standards.

## Export Patterns

**Use named exports, not default exports.** Named exports are more explicit, easier to refactor, and provide better IntelliSense support.

Examples:

- ✅ `export const MyComponent = () => { ... }`
- ✅ `export function myFunction() { ... }`
- ✅ `export class MyClass { ... }`
- ❌ `export default MyComponent`
- ❌ `export default function myFunction() { ... }`

The only exception is when required by the framework (e.g., Next.js App Router `page.tsx` and `layout.tsx` files must use default exports).

## Component Props

**Don't create interfaces for component props - use inline types.** This reduces boilerplate and keeps the types co-located with their usage.

Examples:

- ✅ `export const MyComponent = ({ name, age }: { name: string; age: number }) => { ... }`
- ❌ `interface MyComponentProps { name: string; age: number; }`

## Types vs Interfaces

**Prefer `type` over `interface` in general.** Use `interface` only when you need the `implements` keyword for class implementation.

Examples:

- ✅ `type User = { name: string; age: number; }`
- ✅ `type Animal = { type: "dog"; bark: () => void } | { type: "cat"; meow: () => void }`
- ✅ `interface Drawable { draw(): void; }` (when used with `class Shape implements Drawable`)
- ❌ `interface User { name: string; age: number; }` (use type instead)

## Coding Preferences

### Prefer `undefined` over `null`

Use `undefined` instead of `null` where possible, but check for definedness using `== null` or `!= null` (which checks for both `null` and `undefined`):

```tsx
// Good: Use undefined and check with == null
let value: string | undefined;
if (value == null) {
  // handles both null and undefined
}

// Bad: Boolean casting can be misleading
if (!value) {
  // also triggers for empty string, 0, false, etc.
}

// Bad: Using null when undefined would work
let value: string | null = null;
```

### Always Use Curly Braces

Always use curly braces for if statements, even for single-line statements. This improves readability and prevents errors when adding more statements:

```tsx
// Good: Always use curly braces
if (user == null) {
  return;
}

if (condition) {
  doSomething();
}

// Bad: Single-line if statements without braces
if (user == null) return;
if (condition) doSomething();
```

### Early Returns

Prefer early returns to reduce nesting and improve readability:

```tsx
// Good: Early return pattern
function processUser(user: User | undefined) {
  if (user == null) return;

  // Main logic here with no extra indentation
  console.log(user.name);
  processUserData(user);
}

// Bad: Nested if statements
function processUserBad(user: User | undefined) {
  if (user != null) {
    // Main logic indented
    console.log(user.name);
    processUserData(user);
  }
}
```

### Object Parameters for Functions with Many Arguments

When functions take many arguments (typically 3 or more), use a single object parameter with named properties instead of ordered positional arguments:

```tsx
// Good: Object parameter with named properties
function createUser({
  name,
  email,
  age,
  isActive,
}: {
  name: string;
  email: string;
  age: number;
  isActive: boolean;
}) {
  // Implementation
}

// Bad: Many positional arguments
function createUserBad(
  name: string,
  email: string,
  age: number,
  isActive: boolean,
) {
  // Implementation
}
```

Benefits of object parameters:

- Self-documenting code with named properties
- No need to remember argument order
- Easy to add optional parameters
- Better IntelliSense and autocomplete
- Reduces chance of parameter mix-ups

## File Naming Conventions

**NEVER use `index.ts` or `index.tsx` for file names.** Always use descriptive, explicit file names that clearly indicate the file's purpose or main export. This makes imports clearer and files easier to locate.

### Capitalization Rules

**Use PascalCase (uppercase first letter) only for `.tsx` files that export React components.** Use camelCase (lowercase first letter) for all other files and folders:

Examples:

- ✅ **React components (.tsx)**: `TodoList.tsx`, `UserProfile.tsx`, `Dashboard.tsx`
- ✅ **TypeScript files (.ts)**: `userController.ts`, `apiClient.ts`, `dateUtils.ts`
- ✅ **Folders**: `components/`, `utils/`, `userProfile/`, `settings/`
- ❌ **Wrong**: `UserController.ts`, `DateUtils.ts`, `Components/`, `Settings/`

**Rationale**:

- Component files (`.tsx`) use PascalCase to clearly indicate they export React components
- All other files use camelCase for consistency with JavaScript/TypeScript naming conventions
- Folders use camelCase to distinguish them from component files

The only exception to this rule is when it's necessary to name a file like this to get the desired behavior from NextJS routing.

## Component Architecture Pattern

For non-trivial features, use this SPA-style pattern with MobX controllers:

### 1. App Router Page (Server Component)

```tsx
// src/app/todos/page.tsx
import { TodoList } from "~/todos/ui/TodoList";

export default function TodosPage() {
  return <TodoList />;
}
```

### 2. UI Component (Client Component with MobX)

```tsx
// src/todos/ui/TodoList.tsx
"use client";

import { observer } from "mobx-react-lite";
import { getTodoController } from "~/todos/todoController";

export const TodoList = observer(() => {
  const controller = getTodoController();

  if (controller == null) {
    return null;
  }

  return (
    <div>
      <input
        value={controller.newTodoText}
        onChange={(e) => controller.setNewTodoText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            void controller.addTodo();
          }
        }}
      />
      {controller.todos.map((todo) => (
        <div key={todo.id}>
          <span>{todo.text}</span>
          <button onClick={() => void controller.deleteTodo(todo.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
});
```

### 3. MobX Controller (State Management)

```tsx
// src/todos/todoController.ts
import { action, makeObservable, observable, runInAction } from "mobx";

let todoController: TodoController | undefined;

export function getTodoController() {
  if (typeof window === "undefined") {
    return null;
  }
  todoController ??= new TodoController();
  return todoController;
}

class TodoController {
  @observable todos: Todo[] = [];
  @observable newTodoText = "";

  constructor() {
    makeObservable(this);
    void this.loadTodos();
  }

  @action
  setNewTodoText(text: string) {
    this.newTodoText = text;
  }

  @action
  async addTodo() {
    // Call tRPC mutation
    runInAction(() => {
      this.newTodoText = "";
    });
    await this.loadTodos();
  }

  @action
  async loadTodos() {
    const todos = await trpc.todo.getAll.query();
    runInAction(() => {
      this.todos = todos;
    });
  }
}
```

### 4. tRPC Router (Backend)

```tsx
// src/server/api/routers/todo.ts
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const todoRouter = createTRPCRouter({
  getAll: publicProcedure.query(({ ctx }) => {
    return ctx.db.todo.findMany({ orderBy: { createdAt: "desc" } });
  }),

  create: publicProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return ctx.db.todo.create({ data: { text: input.text } });
    }),
});
```

This pattern separates concerns: routing (page.tsx), presentation (UI component), state management (MobX controller), and backend logic (tRPC router).

### MobX Observable Initialization

**IMPORTANT: Always explicitly initialize MobX observables, even when they are `undefined`.** In production builds, MobX's proxy-based reactivity system cannot properly track uninitialized observables, leading to state updates not triggering re-renders.

```tsx
// Good: Explicitly initialized observables
class Controller {
  @observable selectedId: string | undefined = undefined;
  @observable isActive = false;

  constructor() {
    makeObservable(this);
  }
}

// Bad: Uninitialized observables (works in dev, breaks in production)
class ControllerBad {
  @observable selectedId: string | undefined;  // Missing initializer!
}
```

## Exhaustive Switch Statements

Use exhaustive switch statements to ensure type safety when handling union types. This helps catch missing cases at compile time.

```tsx
// Good: Exhaustive switch
function handleAnimal(animal: Animal) {
  switch (animal.type) {
    case "dog":
      return animal.bark();
    case "cat":
      return animal.meow();
    default: {
      const _exhaustive: never = animal;
      throw new Error(`Unhandled animal type: ${_exhaustive}`);
    }
  }
}

// Bad: Non-exhaustive if/else chain
function handleAnimalBad(animal: Animal) {
  if (animal.type === "dog") {
    return animal.bark();
  } else if (animal.type === "cat") {
    return animal.meow();
  }
  // Missing case - no compile-time error!
}
```

## Discriminated Union Types

Where relevant, always use discriminated unions with properly constrained types instead of optional properties. This ensures type safety and makes the code more maintainable.

```tsx
// Good: Discriminated union with properly constrained types
type Animal =
  | { type: "dog"; bark: () => void }
  | { type: "cat"; meow: () => void };

// Bad: Single type with optional properties
type AnimalBad = {
  type: "dog" | "cat";
  bark?: () => void;
  meow?: () => void;
};
```

Benefits of discriminated unions:

- TypeScript can narrow types based on the discriminator field
- Prevents invalid combinations (e.g., a cat with a bark method)
- Makes exhaustive checking easier with switch statements
- Clearer intent and better IntelliSense support

## Code Execution and Debugging

You can run and test code by creating temporary files in the `/tmp` folder and executing them with Bun. This is useful for debugging, testing utilities, or exploring the codebase.

### Example Usage

```typescript
// tmp/debug.ts
import { formatDate } from "~/utils/date";

const result = formatDate(new Date());

console.log(result);
```

Execute with:

```bash
bun tmp/debug.ts
```

### Notes

- You can import from the `src` folder using the `~` alias
- This is particularly useful for testing utilities, debugging functions, or exploring API behavior
- Temporary files should be placed in `/tmp` to keep the project clean

## Environment Variables

Environment variables are managed through:

- `src/env.js` - Validates and exposes environment variables using Zod
- `.env` - Local environment variables (not committed)
- `.env.example` - Template showing required variables

When adding new environment variables:

1. Add to `.env.example` with placeholder values
2. Add validation schema to `src/env.js` server section
3. Add to runtimeEnv object in `src/env.js`

## Development Pages

Development/debug pages should be created under `src/app/dev/`:

- Create new dev pages at `src/app/dev/[page-name]/page.tsx`
- Use a shared navigation component for consistency across dev pages
- Dev pages are useful for testing components, debugging features, or exploring API behavior

Example dev page structure:

```tsx
// src/app/dev/example/page.tsx
export default function ExampleDevPage() {
  return (
    <div className="p-8">
      <h1>Example Dev Page</h1>
      {/* Dev content */}
    </div>
  );
}
```

## Testing

Unit tests use Bun as the test runner:

- Test files go in `/tests` directories as close as possible to the code being tested
- Use `.test.ts` extension for test files
- Run tests with `bun test`
- Focus on testing pure TypeScript functions, not UI components
- **Only write tests when explicitly asked**

## Console Logging

When adding `console.log` statements for debugging:

1. **Always use template strings** - never log objects
2. **Format numbers to 2 decimal places** using `.toFixed(2)`

```typescript
// Good: Single formatted string
console.log(`Position: x=${x.toFixed(2)}, y=${y.toFixed(2)}`);

// Bad: Logging objects
console.log("Position:", { x, y });

// Bad: Unformatted numbers
console.log(`Position: x=${x}, y=${y}`);
```
