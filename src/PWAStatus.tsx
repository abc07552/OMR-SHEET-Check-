import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { registerSW } from "virtual:pwa-register";
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let update: ((reload?: boolean) => Promise<void>) | undefined;
export default function PWAStatus() {
  const [ready, setReady] = useState(false),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    update = registerSW({
      onNeedRefresh: () => setReady(true),
      onOfflineReady: () => {
        document.documentElement.dataset.offlineShell = "ready";
      },
      onRegisterError: (e) =>
        setError(
          e instanceof Error
            ? e.message
            : "The offline shell could not be cached. Check browser storage and your connection.",
        ),
    });
    const prompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    return () => window.removeEventListener("beforeinstallprompt", prompt);
  }, []);
  if (!ready && !install && !error) return null;
  return (
    <div className="pwa-notice" role="status">
      {error ? (
        <>
          <span>Offline shell unavailable: {error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss offline-shell warning"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </>
      ) : ready ? (
        <>
          <RefreshCw size={16} />
          <span>A new application version is ready.</span>
          <button
            className="text-button"
            onClick={() => {
              if (
                confirm(
                  "Apply the new version and reload? Finish scanning and save or export unsynchronized work first.",
                )
              )
                void update?.(true).catch((e) => setError(String(e)));
            }}
          >
            Update safely
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss application update"
            onClick={() => setReady(false)}
          >
            <X size={14} />
          </button>
        </>
      ) : (
        <>
          <Download size={16} />
          <span>Keep your examination workspace close.</span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await install?.prompt();
                await install?.userChoice;
                setInstall(null);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Install app
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss install suggestion"
            onClick={() => setInstall(null)}
          >
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
}
