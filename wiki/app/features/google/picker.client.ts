export interface GooglePickerConfig {
  accessToken: string;
  apiKey: string;
  appId: string;
}

export interface GooglePickerDocument {
  id: string;
  name: string;
  mimeType: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDocument[];
}

interface GooglePickerDocsView {
  setMimeTypes: (mimeTypes: string) => GooglePickerDocsView;
  setSelectFolderEnabled: (enabled: boolean) => GooglePickerDocsView;
}

interface GooglePickerBuilder {
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  addView: (view: GooglePickerDocsView) => GooglePickerBuilder;
  enableFeature: (feature: string) => GooglePickerBuilder;
  setCallback: (callback: (data: GooglePickerResponse) => void) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

declare global {
  interface Window {
    gapi?: { load: (name: string, callback: () => void) => void };
    google?: {
      picker: {
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
        DocsView: new (viewId?: string) => GooglePickerDocsView;
        ViewId: { DOCS: string };
        PickerBuilder: new () => GooglePickerBuilder;
      };
    };
  }
}

let pickerLoadPromise: Promise<void> | null = null;

export function loadGooglePicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (pickerLoadPromise) return pickerLoadPromise;

  pickerLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-picker="true"]');
    const onLoaded = () => {
      if (!window.gapi) {
        reject(new Error("Google API client did not load"));
        return;
      }
      window.gapi.load("picker", resolve);
    };

    if (existing) {
      existing.addEventListener("load", onLoaded, { once: true });
      existing.addEventListener("error", () => reject(new Error("Picker script failed to load")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.dataset.googlePicker = "true";
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = onLoaded;
    script.onerror = () => reject(new Error("Picker script failed to load"));
    document.head.appendChild(script);
  });
  return pickerLoadPromise;
}
