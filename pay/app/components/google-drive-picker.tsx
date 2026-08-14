import { useCallback, useState } from "react";
import { Button } from "~/components/ui/button";

type PickedItem = { id: string; name: string };

type GapiPickerDoc = { id: string; name: string };

type GapiPickerResponse = {
  action: string;
  docs?: GapiPickerDoc[];
};

type GapiPickerView = {
  setSelectFolderEnabled?: (enabled: boolean) => GapiPickerView;
};

type GapiPickerBuilder = {
  addView: (view: GapiPickerView | string) => GapiPickerBuilder;
  setOAuthToken: (token: string) => GapiPickerBuilder;
  setDeveloperKey: (key: string) => GapiPickerBuilder;
  setCallback: (callback: (response: GapiPickerResponse) => void) => GapiPickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

type GapiPickerNamespace = {
  Action: { PICKED: string };
  ViewId: { SPREADSHEETS: string; FOLDERS: string };
  DocsView: new (viewId: string) => GapiPickerView;
  PickerBuilder: new () => GapiPickerBuilder;
};

declare global {
  interface Window {
    gapi?: { load: (api: string, callback: () => void) => void };
    google?: { picker: GapiPickerNamespace };
  }
}

let gapiLoadPromise: Promise<void> | null = null;

function loadGapiScript(): Promise<void> {
  if (window.gapi) return Promise.resolve();
  if (!gapiLoadPromise) {
    gapiLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google API の読み込みに失敗しました"));
      document.head.appendChild(script);
    });
  }
  return gapiLoadPromise;
}

async function loadPickerLibrary(): Promise<GapiPickerNamespace> {
  await loadGapiScript();
  await new Promise<void>((resolve) => {
    window.gapi?.load("picker", () => resolve());
  });
  const picker = window.google?.picker;
  if (!picker) throw new Error("Google Picker を読み込めませんでした");
  return picker;
}

export function GoogleDrivePickerButton({
  mode,
  pickerApiKey,
  getAccessToken,
  onPicked,
  label,
  disabled,
}: {
  mode: "template" | "folder";
  pickerApiKey: string;
  getAccessToken: () => Promise<string>;
  onPicked: (item: PickedItem) => void | Promise<void>;
  label: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPicker = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const [accessToken, picker] = await Promise.all([getAccessToken(), loadPickerLibrary()]);
      const view =
        mode === "folder"
          ? (new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled?.(true) ??
            picker.ViewId.FOLDERS)
          : new picker.DocsView(picker.ViewId.SPREADSHEETS);
      const pickerInstance = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(pickerApiKey)
        .setCallback((response) => {
          if (response.action !== picker.Action.PICKED) return;
          const doc = response.docs?.[0];
          if (!doc) return;
          void onPicked({ id: doc.id, name: doc.name });
        })
        .build();
      pickerInstance.setVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google Picker の起動に失敗しました");
    } finally {
      setPending(false);
    }
  }, [mode, pickerApiKey, getAccessToken, onPicked]);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openPicker}
        disabled={disabled || pending}
      >
        {pending ? "起動中…" : label}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
