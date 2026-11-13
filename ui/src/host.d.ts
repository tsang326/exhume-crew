/**
 * Local types for the `@kirocrew/app-sdk` hooks this app uses. The package is supplied by the
 * Crew host at runtime and is not published, so only the used surface is declared (design V14).
 */
declare module "@kirocrew/app-sdk" {
  /** JSON value as returned by the parsed API helpers. */
  export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

  export interface AppApi {
    /** Returns the raw `Response` (permission-scoped like the JSON helpers, design A6). */
    raw(path: string, init?: RequestInit): Promise<Response>;
    request<T = JsonValue>(path: string, init?: RequestInit): Promise<T>;
    get<T = JsonValue>(path: string): Promise<T>;
    post<T = JsonValue>(path: string, body?: unknown): Promise<T>;
    put<T = JsonValue>(path: string, body?: unknown): Promise<T>;
    patch<T = JsonValue>(path: string, body?: unknown): Promise<T>;
    del<T = JsonValue>(path: string): Promise<T>;
  }

  export interface ThemeInfo {
    mode: "light" | "dark" | string;
    accent: string;
    colorTheme: string;
  }

  export interface OpenChatOptions {
    agent: string;
    message: string;
    slotKey?: string;
    autoSend?: boolean;
    memoryMode?: string;
    sessionFolder?: string;
  }

  export interface ChatLauncher {
    openChat(options: OpenChatOptions): void | Promise<void>;
  }

  export function useAppApi(): AppApi;
  export function useTheme(): ThemeInfo;
  export function useNavigate(): (path: string) => void;
  export function useChatLauncher(): ChatLauncher;
}
