// apps/web/src/config/site.ts
/**
 * ME_CBO — Mosoriot Environmental Community-Based Organization
 * Single source of truth for identity, contact & navigation.
 */
export const siteConfig = {
  name: "Mosoriot Environmental CBO",
  shortName: "ME_CBO",
  fullName: "Mosoriot Environmental Community-Based Organization",
  motto: "Caring for Creation, Sustaining Our Future",
  description:
    "ME_CBO unites the Mosoriot community to plant trees, restore ecosystems, and build a zero-waste future.",
  contact: {
    address: "P.O. Box 3, Mosoriot, Kenya",
    phone: "0741 835 028",
    phoneTel: "+254741835028",
    email: "info@mecbo.org",
    location: "Mosoriot, Nandi County, Kenya",
  },
  /**
   * Legal standing. Fill in `registrationNumber` and `registeredYear` from your
   * registration certificate; they only appear on the site once they are set.
   */
  registration: {
    status: "Registered community-based organisation under the County Government of Nandi",
    authority: "County Government of Nandi",
    registrationNumber: "", // e.g. the number on your certificate
    registeredYear: "", // e.g. "2023"
  },
  colors: {
    forest: "#14532d",
    leaf: "#22c55e",
    earth: "#d97706",
  },
} as const;

export type NavItem = {
  label: string;
  href: string;
  icon: string; // lucide icon name
  requiresAuth?: boolean;
};

export const publicNav: NavItem[] = [
  { label: "Home", href: "/", icon: "Home" },
  { label: "About", href: "/about", icon: "Info" },
  { label: "Blog", href: "/blog", icon: "Newspaper" },
  { label: "Donate", href: "/donate", icon: "HeartHandshake" },
];

export const dashboardNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", requiresAuth: true },
  { label: "Events", href: "/events", icon: "CalendarDays", requiresAuth: true },
  { label: "Impact", href: "/impact", icon: "Leaf", requiresAuth: true },
  { label: "Members", href: "/members", icon: "Users", requiresAuth: true },
  { label: "Profile", href: "/profile", icon: "UserCircle", requiresAuth: true },
];
