import { useEffect, useState } from "react";
import { BottomNav, MainHeader, type NavId } from "./components/ui";
import CustomerDetail from "./screens/CustomerDetail";
import Customers from "./screens/Customers";
import Home, { type HomeTab } from "./screens/Home";
import Scan, { type ScanMode } from "./screens/Scan";
import Poocho from "./screens/Poocho";
import ProductDetail from "./screens/Stock";
import Welcome from "./screens/Welcome";

type MainRoute = { name: "home"; tab?: HomeTab } | { name: "customers"; focusSearch?: boolean };
type Route =
  | MainRoute
  | { name: "scan"; mode: ScanMode }
  | { name: "customer"; id: number; back: MainRoute }
  | { name: "product"; id: number }
  | { name: "ask" };

export default function App() {
  const [enteredDemo, setEnteredDemo] = useState(false);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [toast, setToast] = useState("");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (!enteredDemo) return <Welcome onEnterDemo={() => setEnteredDemo(true)} />;

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 2500);
  }

  function onNav(id: NavId) {
    if (id === "home") setRoute({ name: "home" });
    if (id === "customers") setRoute({ name: "customers" });
    if (id === "scan") setRoute({ name: "scan", mode: "khata" });
    if (id === "ask") setRoute({ name: "ask" });
  }

  const toastEl = toast && (
    <div className="fixed inset-x-4 top-16 z-40 mx-auto max-w-md bg-logo px-4 py-3 text-[15px] font-medium text-bar">{toast}</div>
  );

  if (route.name === "scan") {
    return (
      <>
        <Scan
          key={route.mode}
          initialMode={route.mode}
          onBack={() => setRoute({ name: "home" })}
          onSaved={(target, message) => {
            setRoute({ name: "home", tab: target === "stock" ? "stock" : "overview" });
            showToast(message);
          }}
        />
        {toastEl}
      </>
    );
  }

  if (route.name === "customer") {
    const back = route.back;
    return <CustomerDetail id={route.id} onBack={() => setRoute(back)} />;
  }

  if (route.name === "ask") {
    return <Poocho onBack={() => setRoute({ name: "home" })} />;
  }

  if (route.name === "product") {
    return <ProductDetail id={route.id} onBack={() => setRoute({ name: "home", tab: "stock" })} />;
  }

  const openCustomer = (id: number) => setRoute({ name: "customer", id, back: route });

  return (
    <>
      <MainHeader
        onSearch={() => setRoute({ name: "customers", focusSearch: true })}
        onLanguage={() => showToast("Hindi UI jald aa raha hai (Phase 6)")}
      />
      <main className="pb-24">
        {route.name === "home" && (
          <Home
            initialTab={route.tab}
            onOpenCustomer={openCustomer}
            onOpenProduct={(id) => setRoute({ name: "product", id })}
            onScan={(mode) => setRoute({ name: "scan", mode })}
            onViewAll={() => setRoute({ name: "customers" })}
          />
        )}
        {route.name === "customers" && <Customers onOpen={openCustomer} focusSearch={route.focusSearch} />}
      </main>
      <BottomNav active={route.name} onChange={onNav} />
      {toastEl}
    </>
  );
}
