export function MainNavigation() {
  const path = window.location.pathname;
  const active = path.startsWith("/events")
    ? "events"
    : path.startsWith("/faction")
      ? "factions"
      : "rankings";
  return (
    <nav className="primary-navigation" aria-label="Main navigation">
      {[
        ["rankings", "/", "Rankings"],
        ["factions", "/factions", "Factions"],
        ["events", "/events", "Events"],
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
