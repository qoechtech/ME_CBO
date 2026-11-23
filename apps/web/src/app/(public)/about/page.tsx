// apps/web/src/app/(public)/about/page.tsx
import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <section className="container-mobile mx-auto max-w-3xl py-12">
      <h1 className="text-3xl font-bold">About {siteConfig.shortName}</h1>
      <p className="mt-2 italic">{siteConfig.motto}</p>
      <p className="mt-6">{siteConfig.description}</p>
      <p className="mt-6 text-sm">
        {siteConfig.contact.address} · {siteConfig.contact.phone} ·{" "}
        <a className="underline" href={`mailto:${siteConfig.contact.email}`}>
          {siteConfig.contact.email}
        </a>
      </p>
    </section>
  );
}
