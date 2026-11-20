import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import App from "./App";
import TeamRegistrationPage from "./components/TeamRegistrationPage";
import AuthPage from "./components/AuthPage";
import DeveloperPage from "./components/DeveloperPage";
import "./styles.css";
import "./monochrome.css";
import "./registration.css";
import "./auth.css";
const client = new QueryClient();
const path = window.location.pathname.replace(/\/+$/, "");
const Screen =
  path === "/register"
    ? TeamRegistrationPage
    : path === "/dev"
      ? DeveloperPage
      : path === "/login" || path === "/signup" || path === "/dev/login"
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
