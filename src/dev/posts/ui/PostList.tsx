"use client";

import { observer } from "mobx-react-lite";
import { getPostController } from "~/dev/posts/postController";

export const PostList = observer(() => {
  const controller = getPostController();

  if (controller == null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Posts</h1>

      <div className="flex gap-2">
        <input
          type="text"
          value={controller.newPostName}
          onChange={(e) => controller.setNewPostName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void controller.createPost();
            }
          }}
          placeholder="New post name..."
          className="flex-1 rounded border px-3 py-2"
        />
        <button
          onClick={() => void controller.createPost()}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Add
        </button>
      </div>

      {controller.isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : controller.posts.length === 0 ? (
        <p className="text-gray-500">No posts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {controller.posts.map((post) => (
            <li
              key={post.id}
              className="flex items-center justify-between rounded border p-3"
            >
              <span>{post.name}</span>
              <button
                onClick={() => void controller.deletePost(post.id)}
                className="text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
