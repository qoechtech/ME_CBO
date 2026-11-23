// apps/web/src/app/(public)/blog/[slug]/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { posts } from "@/content/posts";

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const post = posts.find((p) => p.slug === params.slug);
  return post ? { title: post.title, description: post.summary } : { title: "Not found" };
}

export default function PostPage({ params }: Props) {
  const post = posts.find((p) => p.slug === params.slug);
  if (!post) notFound();

  return (
    <article className="container-mobile mx-auto max-w-3xl py-12">
      <Link href="/blog" className="text-sm underline">← All stories</Link>
      <h1 className="mt-4 text-3xl font-bold">{post.title}</h1>
      <p className="mt-2 text-sm opacity-70">
        <time dateTime={post.date}>
          {new Date(post.date).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}
        </time>
        {" · "}
        {post.author}
      </p>
      <div className="mt-6 space-y-4">
        {post.body.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    </article>
  );
}
