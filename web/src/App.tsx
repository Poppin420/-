import { useCallback, useEffect, useState } from "react";
import { api, setUnauthorizedHandler, type Me } from "./api";
import { ServiceEntryView } from "./ServiceEntryView";
import { VehicleHistoryView } from "./VehicleHistoryView";
import { AuthScreen } from "./AuthScreen";
import { SettingsView } from "./SettingsView";
import { InvoicesView } from "./InvoicesView";
import { ProfileView } from "./ProfileView";
import { AadeView } from "./AadeView";
import { ClientsView } from "./ClientsView";
import { ServiceChecklistView } from "./ServiceChecklistView";
import { GarageImportView } from "./GarageImportView";

type Tab = "service" | "history" | "invoices" | "settings" | "profile" | "aade" | "clients" | "checklist" | "import";

function tabFromHash(): { tab: Tab; notice: string | null } {
  const hash = window.location.hash;
  const routes: Tab[] = ["history", "invoices", "settings", "profile", "aade", "clients", "checklist", "import"];
  const tab: Tab = routes.find((r) => hash.startsWith(`#/${r}`)) ?? "service";
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
    window.location.hash = t === "service" ? "#/" : `#/${t}`;
  };

  return (
    <main className="app with-nav">
      <header className="top">
        <h1>Συνεργείο</h1>
        <span className="env test">ΔΟΚΙΜΑΣΤΙΚΟ</span>
      </header>

      {tab === "service" && <ServiceEntryView />}
      {tab === "history" && <VehicleHistoryView />}
      {tab === "invoices" && <InvoicesView />}
      {tab === "settings" && (
        <SettingsView me={me} notice={notice} onChanged={loadMe} onLoggedOut={() => setMe(null)} />
      )}
      {tab === "profile" && <ProfileView />}
      {tab === "aade" && <AadeView />}
      {tab === "clients" && <ClientsView />}
      {tab === "checklist" && <ServiceChecklistView />}
      {tab === "import" && <GarageImportView />}

      <nav className="tabbar" aria-label="Κύρια πλοήγηση">
        <button className={tab === "service" ? "active" : ""} onClick={() => go("service")}>
          🔧<span>Εργασία</span>
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => go("history")}>
          🚗<span>Ιστορικό</span>
        </button>
        <button className={tab === "invoices" ? "active" : ""} onClick={() => go("invoices")}>
          🧾<span>Παραστατικά</span>
        </button>
        <button className={["settings", "profile", "aade", "clients", "checklist", "import"].includes(tab) ? "active" : ""} onClick={() => go("settings")}>
          ⚙️<span>Ρυθμίσεις</span>
        </button>
      </nav>
    </main>
  );
}
