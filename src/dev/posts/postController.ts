import { action, makeObservable, observable, runInAction } from "mobx";
import { getTrpcClient } from "~/trpc/client";

type Post = {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

let postController: PostController | undefined;

export function getPostController() {
  if (typeof window === "undefined") {
    return null;
  }
  postController ??= new PostController();
  return postController;
}

class PostController {
  @observable posts: Post[] = [];
  @observable newPostName = "";
  @observable isLoading = false;

  private trpc = getTrpcClient();

  constructor() {
    makeObservable(this);
    void this.loadPosts();
  }

  @action
  setNewPostName(name: string) {
    this.newPostName = name;
  }

  @action
  async loadPosts() {
    this.isLoading = true;
    try {
      const posts = await this.trpc.post.getAll.query();
      runInAction(() => {
        this.posts = posts;
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  @action
  async createPost() {
    if (this.newPostName.trim() === "") {
      return;
    }
    await this.trpc.post.create.mutate({ name: this.newPostName });
    runInAction(() => {
      this.newPostName = "";
    });
    await this.loadPosts();
  }

  @action
  async deletePost(id: number) {
    await this.trpc.post.delete.mutate({ id });
    await this.loadPosts();
  }
}
