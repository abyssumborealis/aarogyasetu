import { useEffect, useState } from "react";
import { api } from "./services/api";
import { usePolling } from "./hooks/usePolling";
import { usePointerEffects } from "./hooks/useMouseposition";
import { actions, useStore } from "./store/useStore";

import Dashboard from "./pages/dashboard";
import StaffQueue from "./pages/StaffQueue";
import Tokens from "./pages/Tokens";
import Login from "./pages/Login";

import CursorTrail from "./components/cursorTrail";
import CustomCursor from "./components/customcursor";
import Toasts from "./components/Toasts";
import { QueueGlyph, Sparkle } from "./components/Icons";

const ROUTES = [
  { path: "/", label: "Dashboard", Page: Dashboard },
  { path: "/queue", label: "Staff queue", Page: StaffQueue },
  { path: "/tokens", label: "Tokens", Page: Tokens },
];

/** Tiny hash router: #/queue -> "/queue". No dependency needed for three screens. */
function useHashRoute() {
  const read = () => window.location.hash.replace(/^#/, "").split("?")[0] || "/";
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setPath(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

export default function App() {
  const token = useStore((s) => s.token);
  return (
    <>
      {token ? <Shell /> : <Login />}
      <CursorTrail />
      <CustomCursor />
      <Toasts />
    </>
  );
}

function Shell() {
  const path = useHashRoute();
  const staff = useStore((s) => s.staff);
  const effects = useStore((s) => s.effects);
  const { capable } = usePointerEffects();
  const health = usePolling(api.health, { interval: 15000 });

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const { Page } = route;
  const online = !!health.data && !health.error;
  const who = staff?.full_name || staff?.email || "Signed in";

  return (
    <>
      <header className="app-header">
        <div className="header-container">
          <a className="brand-wrap" href="#/">
            <span className="brand-symbol">
              <QueueGlyph />
            </span>
            <span className="brand-text-col">
              <span className="brand-title">Queue</span>
              <span className="brand-subtitle">Staff console</span>
            </span>
          </a>

          <nav aria-label="Main">
            <ul className="nav-links">
              {ROUTES.map((r) => (
                <li key={r.path}>
                  <a
                    className={`nav-link${r.path === route.path ? " active" : ""}`}
                    href={`#${r.path}`}
                    aria-current={r.path === route.path ? "page" : undefined}
                  >
                    {r.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="header-actions">
            <span className={`system-status-indicator${online ? "" : " is-offline"}`} title={health.error?.message}>
              <span className="dot" />
              {health.loading && !health.data ? "Connecting" : online ? "Connected" : "Offline"}
            </span>

            {capable && (
              <button
                className={`btn btn-secondary btn-xs effects-toggle${effects ? " is-on" : ""}`}
                aria-pressed={effects}
                onClick={() => actions.setEffects(!effects)}
                title="Cursor line follower, ring and hover effects"
              >
                <Sparkle width={14} height={14} />
                Cursor effects {effects ? "on" : "off"}
              </button>
            )}

            <span className="who" title={staff?.email}>
              {who}
            </span>
            <button className="btn btn-secondary btn-xs" onClick={() => actions.logout()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main>
        <Page />
      </main>
    </>
  );
}
