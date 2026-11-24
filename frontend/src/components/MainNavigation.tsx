export function MainNavigation() {
  const path = window.location.pathname;
  const active = path.startsWith("/events")
    ? "events"
    : path.startsWith("/news")
      ? "news"
    : path.startsWith("/faction")
      ? "factions"
      : "rankings";
  return (
    <nav className="primary-navigation" aria-label="Main navigation">
      {[
        ["rankings", "/", "Rankings"],
        ["factions", "/factions", "Factions"],
        ["events", "/events", "Events"],
        ["news", "/news", "News"],
      ].map(([key, href, label]) => (
        <a
          key={key}
          href={href}
          className={active === key ? "active" : undefined}
          aria-current={active === key ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
