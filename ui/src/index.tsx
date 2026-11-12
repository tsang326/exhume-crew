/**
 * Exhume Crew single page. View state comes from `?id=` and is written back with
 * `history.replaceState`; switching views is a synchronous state change (Requirements 13.1, 13.7,
 * 14.13). This module makes no network requests of its own: the API wrapper does.
 */
import { useCallback, useState, type ReactElement } from "react";
import { useAppApi, useChatLauncher, useTheme } from "@kirocrew/app-sdk";
import { DecorLayer } from "./DecorLayer";
import { DiskView } from "./DiskView";
import { LibraryView } from "./LibraryView";
import { createApi } from "./lib/api";
import { ARCHIVIST_AGENT, UNDERTAKER_AGENT, buildUndertakerMessage } from "./lib/messages";
import { StyleElement } from "./styles";
import { parseViewFromSearch, writeViewToUrl, type ViewState } from "./view-state";

export default function ExhumeCrewApp(): ReactElement {
  const app = useAppApi();
  const theme = useTheme();
  const chat = useChatLauncher();
  const [api] = useState(() => createApi(app));
  const [view, setView] = useState<ViewState>(() => parseViewFromSearch(window.location.search));

  const go = useCallback((next: ViewState): void => {
    setView(next);
    writeViewToUrl(next);
  }, []);

  // Mode and accent come from useTheme(); the accent is exposed as data only. Colours use the
  // host's own CSS variables, so the bundle defines no theme value (Requirement 15.3).
  return (
    <div
      className="ec-root"
      data-mode={theme.mode === "dark" ? "dark" : "light"}
      data-accent={theme.accent}
    >
      <StyleElement />
      <DecorLayer />
      {view.kind === "disk" ? (
        <DiskView
          api={api}
          diskId={view.id}
          onBack={() => go({ kind: "library" })}
          onAskUndertaker={(id) => {
            void chat.openChat({ agent: UNDERTAKER_AGENT, message: buildUndertakerMessage(id) });
          }}
        />
      ) : (
        <LibraryView
          api={api}
          onOpenDisk={(id) => go({ kind: "disk", id })}
          onSummarise={(message) => {
            void chat.openChat({ agent: ARCHIVIST_AGENT, message });
          }}
        />
      )}
    </div>
  );
}
