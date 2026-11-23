// apps/web/src/app/(public)/blog/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { posts } from "@/content/posts";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: "Blog",
  description: "News and stories from ME_CBO in Mosoriot, Nandi County.",
};

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function BlogPage() {
  return (
    <>
      <SiteHeader />
      <main>
    <section className="container-mobile mx-auto max-w-3xl py-12">
      <h1 className="text-3xl font-bold">Blog</h1>
      <p className="mt-2">News and stories from our work in Mosoriot.</p>

      {posts.length === 0 ? (
        <p className="mt-8">No stories yet. Please check back soon.</p>
      ) : (
        <ul className="mt-8 space-y-6">
          {posts.map((p) => (
            <li key={p.slug} className="rounded-xl border p-5">
              <time dateTime={p.date} className="text-sm opacity-70">{fmt(p.date)}</time>
              <h2 className="mt-1 text-xl font-semibold">
                <Link href={`/blog/${p.slug}`} className="hover:underline">{p.title}</Link>
              </h2>
              <p className="mt-2">{p.summary}</p>
              <Link href={`/blog/${p.slug}`} className="mt-3 inline-block text-sm font-medium underline">
                Read more
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
      </main>
    </>
  );
}
