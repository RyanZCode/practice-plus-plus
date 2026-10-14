const paths = {
  practice: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4",
  problems: "M8 5h12M8 12h12M8 19h12M3 5h1M3 12h1M3 19h1",
  coach: "M4 4h12v10H8l-4 3V4m5 14h7l4 3V10h-1",
  analytics: "M4 20V10m5 10V6m5 14v-8m5 8V3",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2",
  learning: "M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2",
  "external-ai": "M13 4h7v7m0-7L10 14M9 4H4v16h16v-5",
  settings: "M4 6h16M4 12h16M4 18h16m-9-15v6m6 0v6m-8 0v6",
  more: "M4 6h16M4 12h16M4 18h16",
} as const;

export function NavigationIcon({ name }: { readonly name: keyof typeof paths }) {
  return (
    <svg
      className="navigation-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
      {name === "practice" ? <circle cx="12" cy="12" r="4" /> : null}
      {name === "learning" ? <circle cx="12" cy="6" r="3" /> : null}
    </svg>
  );
}
