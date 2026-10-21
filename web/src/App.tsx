import { useCallback, useEffect, useState } from "react";
import { api, setUnauthorizedHandler, type Me } from "./api";
import { AssistantView } from "./AssistantView";
import { AuthScreen } from "./AuthScreen";
import { CalendarView } from "./CalendarView";
import { SettingsView } from "./SettingsView";
import { InvoicesView } from "./InvoicesView";
import { ProfileView } from "./ProfileView";
import { AadeView } from "./AadeView";

type Tab = "assistant" | "calendar" | "invoices" | "settings" | "profile" | "aade";

function tabFromHash(): { tab: Tab; notice: string | null } {
  const hash = window.location.hash;
  const routes: Tab[] = ["calendar", "invoices", "settings", "profile", "aade"];
  const tab: Tab = routes.find((r) => hash.startsWith(`#/${r}`)) ?? "assistant";
  const google = new URLSearchParams(hash.split("?")[1] ?? "").get("google");
  const notice =
    google === "connected" ? "Το Google Calendar συνδέθηκε." : google === "error" ? "Η σύνδεση με Google απέτυχε. Δοκίμασε ξανά." : null;
  return { tab, notice };
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [{ tab, notice }, setRoute] = useState(tabFromHash);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    void loadMe();
    const onHash = () => setRoute(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [loadMe]);

  if (me === undefined) return <main className="app narrow"><p className="note">Φόρτωση…</p></main>;
  if (me === null) return <AuthScreen onSignedIn={loadMe} />;

  const go = (t: Tab) => {
    window.location.hash = t === "assistant" ? "#/" : `#/${t}`;
  };

  return (
    <main className="app with-nav">
      <header className="top">
        <h1>Βοηθός</h1>
        <span className="env test">ΔΟΚΙΜΑΣΤΙΚΟ</span>
      </header>

      <div hidden={tab !== "assistant"}>
        <AssistantView />
      </div>
      {tab === "calendar" && <CalendarView googleConnected={me.google.connected} />}
      {tab === "invoices" && <InvoicesView />}
      {tab === "settings" && (
        <SettingsView me={me} notice={notice} onChanged={loadMe} onLoggedOut={() => setMe(null)} />
      )}
      {tab === "profile" && <ProfileView />}
      {tab === "aade" && <AadeView />}

      <nav className="tabbar" aria-label="Κύρια πλοήγηση">
        <button className={tab === "assistant" ? "active" : ""} onClick={() => go("assistant")}>
          🎙️<span>Βοηθός</span>
        </button>
        <button className={tab === "calendar" ? "active" : ""} onClick={() => go("calendar")}>
          📅<span>Ημερολόγιο</span>
        </button>
        <button className={tab === "invoices" ? "active" : ""} onClick={() => go("invoices")}>
          🧾<span>Παραστατικά</span>
        </button>
        <button className={tab === "settings" || tab === "profile" || tab === "aade" ? "active" : ""} onClick={() => go("settings")}>
          ⚙️<span>Ρυθμίσεις</span>
        </button>
      </nav>
    </main>
  );
}
