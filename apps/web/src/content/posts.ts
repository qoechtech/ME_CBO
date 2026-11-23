// apps/web/src/content/posts.ts
/**
 * Blog posts. To publish a new story, add an object at the TOP of this list
 * and redeploy. `body` is an array of paragraphs.
 */
export type Post = {
  slug: string;
  title: string;
  date: string; // YYYY-MM-DD
  author: string;
  summary: string;
  body: string[];
};

export const posts: Post[] = [
  {
    slug: "welcome-to-the-me-cbo-member-portal",
    title: "Welcome to the ME_CBO member portal",
    date: "2026-11-23",
    author: "ME_CBO Team",
    summary:
      "Our new online home for events, impact tracking and membership is now open.",
    body: [
      "ME_CBO now has an online portal where members can apply to join, see upcoming community events and follow the impact of our work in Mosoriot.",
      "Officials use the same portal to manage members and events, and every sign-in is protected so that community records stay safe.",
      "More stories from our tree-planting and clean-up activities will be posted here. Check back soon, or apply for membership to take part.",
    ],
  },
];
