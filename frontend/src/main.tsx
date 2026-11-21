import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import App from "./App";
import TeamRegistrationPage from "./components/TeamRegistrationPage";
import AuthPage from "./components/AuthPage";
import DeveloperPage from "./components/DeveloperPage";
import EventsPage from "./components/EventsPage";
import ProfilePage, { ProfileRedirect } from "./components/ProfilePage";
import FactionPage, {
  FactionRedirect,
  FactionsDirectory,
} from "./components/FactionPage";
import "./styles.css";
import "./monochrome.css";
import "./registration.css";
import "./auth.css";
import "./events.css";
const client = new QueryClient();
const path = window.location.pathname.replace(/\/+$/, "");
const playerName = path.match(/^\/players\/([a-zA-Z0-9_-]+)$/)?.[1];
const factionMatch = path.match(/^\/factions\/([a-zA-Z0-9_-]+)(\/manage)?$/);
const teamName = path.match(/^\/teams\/([a-zA-Z0-9_-]+)$/)?.[1];
const eventId = path.match(/^\/events\/([a-fA-F0-9-]+)$/)?.[1];
const Screen =
  path === "/events" || eventId
    ? () => <EventsPage eventId={eventId} />
    : factionMatch
      ? () => (
          <FactionPage
            username={factionMatch[1]}
            managing={Boolean(factionMatch[2])}
          />
        )
      : path === "/factions"
        ? FactionsDirectory
        : path === "/faction"
          ? FactionRedirect
          : teamName
            ? () => <FactionRedirect username={teamName} />
            : playerName
              ? () => <ProfilePage username={playerName} />
              : path === "/profile"
                ? ProfileRedirect
                : path === "/register"
                  ? TeamRegistrationPage
                  : path === "/dev"
                    ? DeveloperPage
                    : path === "/login" ||
                        path === "/signup" ||
                        path === "/dev/login"
                      ? () => (
                          <AuthPage
                            signup={path === "/signup"}
                            developer={path === "/dev/login"}
                          />
                        )
                      : App;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <Screen />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
