// apps/web/src/app/(public)/about/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: "About us",
  description: `${siteConfig.fullName} — a registered community-based organisation in ${siteConfig.contact.location}.`,
};

const focus = [
  {
    title: "Tree planting",
    text: "Growing indigenous and fruit trees with schools, farms and households to restore green cover.",
  },
  {
    title: "Ecosystem restoration",
    text: "Protecting riverbanks, wetlands and degraded land so water and soil recover.",
  },
  {
    title: "Zero-waste living",
    text: "Clean-ups, recycling and reuse, including swap-shop exchanges that keep useful items out of the dump.",
  },
  {
    title: "Learning and youth",
    text: "Environmental education that helps young people and families care for their surroundings.",
  },
];

export default function AboutPage() {
  const { registration, contact } = siteConfig;

  return (
    <>
      <SiteHeader />
      <main>
    <article className="container-mobile mx-auto max-w-3xl space-y-10 py-12">
      <header>
        <h1 className="text-3xl font-bold">About {siteConfig.shortName}</h1>
        <p className="mt-2 italic">{siteConfig.motto}</p>
      </header>

      <section aria-labelledby="who">
        <h2 id="who" className="text-xl font-semibold">Who we are</h2>
        <p className="mt-3">
          {siteConfig.fullName} is a community-based organisation serving
          Mosoriot and the surrounding areas of Nandi County. {siteConfig.description}
        </p>
      </section>

      <section
        aria-labelledby="registration"
        className="rounded-xl border-l-4 border-[#14532d] bg-green-50 p-5 dark:bg-green-950/30"
      >
        <h2 id="registration" className="text-xl font-semibold">Registered and accountable</h2>
        <p className="mt-3">
          {siteConfig.shortName} is a legally recognised group. {registration.status}.
        </p>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="font-medium">Registering authority:</dt>
            <dd>{registration.authority}</dd>
          </div>
          {registration.registrationNumber && (
            <div className="flex gap-2">
              <dt className="font-medium">Registration no.:</dt>
              <dd>{registration.registrationNumber}</dd>
            </div>
          )}
          {registration.registeredYear && (
            <div className="flex gap-2">
              <dt className="font-medium">Registered:</dt>
              <dd>{registration.registeredYear}</dd>
            </div>
          )}
        </dl>
      </section>

      <section aria-labelledby="mission">
        <h2 id="mission" className="text-xl font-semibold">Our mission</h2>
        <p className="mt-3">
          To unite the Mosoriot community to care for creation: planting trees,
          restoring ecosystems and building a zero-waste future for the next generation.
        </p>
      </section>

      <section aria-labelledby="focus">
        <h2 id="focus" className="text-xl font-semibold">What we do</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {focus.map((f) => (
            <li key={f.title} className="rounded-xl border p-4">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="join">
        <h2 id="join" className="text-xl font-semibold">Get involved</h2>
        <p className="mt-3">
          Anyone who wants to help can apply for membership, join an event or
          support our work.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/register" className="rounded-lg bg-[#14532d] px-4 py-2.5 font-semibold text-white">
            Become a member
          </Link>
          <Link href="/blog" className="rounded-lg border px-4 py-2.5 font-semibold">
            Read our stories
          </Link>
        </div>
      </section>

      <section aria-labelledby="contact">
        <h2 id="contact" className="text-xl font-semibold">Contact us</h2>
        <address className="mt-3 not-italic">
          <p>{contact.address}</p>
          <p>{contact.location}</p>
          <p>
            <a className="underline" href={`tel:${contact.phoneTel}`}>{contact.phone}</a>
            {" · "}
            <a className="underline" href={`mailto:${contact.email}`}>{contact.email}</a>
          </p>
        </address>
      </section>
    </article>
      </main>
    </>
  );
}
