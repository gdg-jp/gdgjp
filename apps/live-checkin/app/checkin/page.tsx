"use client";

import jsQR from "jsqr";
import { Camera, ExternalLink, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import SettingsModal from "./_components/SettingsModal";
import { loadSettings, saveSettings } from "./_lib/settingsStorage";
import validateCheckInURL from "./_lib/validateCheckInURL";

// auth.ts の ALLOWED_CHAPTER_SLUG と同じ値（auth.ts はサーバー専用のため複製）
const ALLOWED_CHAPTER_SLUG = "gdg-kwansai";

export default function CheckInPage() {
  // セッション情報とAPIトークンの取得
  const { data: session, status } = useSession();
  const apiToken = session?.accessToken || "";
  const router = useRouter();

  // アクセストークンが無い（未ログイン）場合はトップページへリダイレクト
  useEffect(() => {
    if (status === "loading") return;
    if (!apiToken) router.replace("/");
  }, [status, apiToken, router]);

  // 認証状態が確定するまで（リダイレクト中を含む）はスピナーを表示
  // カメラ初期化が ref に依存するため、本体は別コンポーネントに分離してマウントを遅らせる
  if (status === "loading" || !apiToken) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-zinc-100 text-zinc-600">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600" />
        <p>Loading...</p>
      </div>
    );
  }

  return <CheckInScanner apiToken={apiToken} />;
}

function CheckInScanner({ apiToken }: { apiToken: string }) {
  // 設定情報
  const [groupId, setGroupId] = useState<string>("gdgkwansai"); // 一旦 gdgkwansai で固定
  const [eventId, setEventId] = useState<string>("");
  const [showSettings, setShowSettings] = useState<boolean>(false);
  // localStorage の復元が終わるまでモーダルを出さない（ちらつき防止）
  const [settingsLoaded, setSettingsLoaded] = useState<boolean>(false);
  // 未設定の間は設定モーダルを強制表示（閉じられない）
  const isConfigured = groupId !== "" && eventId !== "";

  // 保存済みの設定を復元（1日以内のもののみ）
  // SSR との hydration 不一致を避けるため、マウント後に外部ストレージから読み込む
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = loadSettings();
    if (saved) {
      setGroupId(saved.groupId);
      setEventId(saved.eventId);
    }
    setSettingsLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 直近イベント一覧（chapterId が取得できたタイミングで取得）
  const { data: session } = useSession();
  const chapterId = session?.user?.chapters?.find(
    (c) => c.chapterSlug === ALLOWED_CHAPTER_SLUG,
  )?.chapterId;
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventsStatus, setEventsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [eventsReloadKey, setEventsReloadKey] = useState<number>(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  // biome-ignore lint/correctness/useExhaustiveDependencies: eventsReloadKey is a manual reload trigger
  useEffect(() => {
    if (chapterId === undefined) return;
    let cancelled = false;
    setEventsStatus("loading");
    fetch("/api/events")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ events: EventSummary[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setEvents(data.events);
        setEventsStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Events API Error:", err);
        setEventsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [chapterId, eventsReloadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // カメラ & スキャン状態
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("environment");
  const [scanStatus, setScanStatus] = useState<
    "idle" | "processing" | "success" | "duplicate" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");

  // 集計・重複判定（ローカル保持）
  const [checkedInCount, setCheckedInCount] = useState<number>(0);
  const [totalExpected, setTotalExpected] = useState<number>(0);
  const scannedURLsRef = useRef<Set<string>>(new Set());

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Web Audio APIによる効果音再生関数（高音・中音・低音）
  const playSound = (type: "success" | "duplicate" | "error") => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      audioCtxRef.current ??= new AudioCtx();
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === "success") {
        // 高音「ポン」
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      } else if (type === "duplicate") {
        // 中音「ピー」
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      } else {
        // 低音「ブー」
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      }

      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.3);
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.warn("Audio playback restricted:", e);
    }
  };

  // Wake Lock (スリープ防止)
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch (err) {
        console.warn("Wake Lock request failed:", err);
      }
    };
    requestWakeLock();
    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  // APIへのチェックインリクエスト処理
  // biome-ignore lint/correctness/useExhaustiveDependencies: playSound only touches refs and is intentionally excluded
  const processCheckIn = useCallback(
    async (qrText: string) => {
      // QRテキストから participantId や URL パラメータを抽出 (例: URL末尾やQueryパラメータ)

      if (!apiToken) {
        console.error("アクセストークンがまだ準備できていません。");
        setScanStatus("error");
        setStatusMessage("ログインされていません");
        playSound("error");
        return;
      }

      // 重複チェック
      if (scannedURLsRef.current.has(qrText)) {
        setScanStatus("duplicate");
        setStatusMessage("処理済みです（重複）");
        playSound("duplicate");
        return;
      }

      const { isValid } = validateCheckInURL(qrText, eventId);
      if (!isValid) {
        // 正規表現にマッチしない（対象外のQRコード）場合はここで弾いて処理を中断
        setScanStatus("error");
        setStatusMessage("対象外のQRコードです");
        playSound("error");
        return;
      }

      // APIリクエスト送信 (connpass.gdgs.jp)
      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: qrText,
          }),
        });

        if (!res.ok) {
          throw new Error(`API error: ${await res.text()}`);
        }

        const data: CheckInResponse = await res.json();

        if (data.checkedIn) {
          // 成功処理
          scannedURLsRef.current.add(qrText);
          setCheckedInCount((prev) => prev + 1);
          setScanStatus("success");
          setStatusMessage("受付完了！");
          playSound("success");
        } else {
          console.error("Check-in API Error:", data);
          setScanStatus("error");
          setStatusMessage("通信エラー：APIリクエスト失敗");
          playSound("error");
          return;
        }
      } catch (err) {
        console.error("Check-in API Error:", err);
        setScanStatus("error");
        setStatusMessage("通信エラー：APIリクエスト失敗");
        playSound("error");
        return;
      }
    },
    [apiToken, eventId],
  );

  // 最新のコールバックを ref で保持（カメラ effect を再実行させないため）
  const isProcessingRef = useRef(false);
  const onDetectRef = useRef<(data: string) => void>(() => {});
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // QR読み取り検出ハンドラ
  const handleCodeDetected = useCallback(
    (data: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      // 検知直後に処理中へ遷移（スキャンは isProcessingRef で停止）
      setScanStatus("processing");
      setStatusMessage("処理中...");

      processCheckIn(data).finally(() => {
        // 1.5秒間のチャタリング防止ガード後、次の読み取り待機へ復帰
        resetTimerRef.current = setTimeout(() => {
          setScanStatus("idle");
          setStatusMessage("");
          isProcessingRef.current = false;
        }, 1500);
      });
    },
    [processCheckIn],
  );

  useEffect(() => {
    onDetectRef.current = handleCodeDetected;
  }, [handleCodeDetected]);

  // アンマウント時にタイマーと AudioContext を解放
  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      audioCtxRef.current?.close().catch(() => {});
    },
    [],
  );

  // カメラ初期化 & QRスキャンループ（cameraFacing 変更時のみ再実行）
  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let lastScan = 0;

    const SCAN_INTERVAL_MS = 100; // 約10fpsに間引き
    const MAX_WIDTH = 640; // 解析用Canvasの最大幅

    const videoEl = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });

    const scanFrame = (now: number) => {
      if (cancelled) return;
      rafId = requestAnimationFrame(scanFrame);

      if (now - lastScan < SCAN_INTERVAL_MS) return;
      lastScan = now;
      if (isProcessingRef.current) return;

      const video = videoRef.current;
      if (!video || !canvas || !ctx) return;
      if (video.readyState < video.HAVE_ENOUGH_DATA || !video.videoWidth) {
        return;
      }

      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      // 代入すると canvas がリセットされるため、変化時のみ更新
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, w, h, {
        inversionAttempts: "dontInvert",
      });
      if (code?.data) onDetectRef.current(code.data);
    };

    const startCamera = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: cameraFacing,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
        if (cancelled) {
          // 取得中にアンマウントされた場合はすぐ解放
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          await video.play().catch((err) => {
            // play()のプロミス拒否（AbortError）を安全にキャッチ
            if (err.name !== "AbortError") {
              throw err;
            }
          });
        }
        if (!cancelled) rafId = requestAnimationFrame(scanFrame);
      } catch (err) {
        console.error("Camera initialization failed:", err);
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (videoEl) videoEl.srcObject = null;
    };
  }, [cameraFacing]);

  // カメラ切り替え
  const toggleCamera = () => {
    setCameraFacing((prev) => (prev === "environment" ? "user" : "environment"));
  };

  // 進捗率計算
  const progressPercentage =
    totalExpected > 0 ? Math.min(100, Math.round((checkedInCount / totalExpected) * 100)) : 0;

  // ステータス背景色設定
  const getStatusOverlayStyle = () => {
    switch (scanStatus) {
      case "processing":
        return "bg-black/60 text-white";
      case "success":
        return "bg-green-600/85 text-white";
      case "duplicate":
        return "bg-yellow-500/85 text-zinc-900";
      case "error":
        return "bg-red-600/85 text-white";
      default:
        return "bg-transparent border-2 border-dashed border-white/50";
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-800 p-4 max-w-2xl w-full mx-auto flex flex-col justify-between font-sans">
      {/* ヘッダー */}
      <header className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 tracking-tight">
            connpass 連続受付システム
          </h1>
          <p className="text-xs text-zinc-500">GDG Japan Connpass API Mode</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="受付設定"
            className="flex items-center gap-1.5 bg-white hover:bg-zinc-50 text-xs font-medium text-zinc-700 px-3 py-1.5 rounded border border-zinc-300 shadow-sm transition"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
            <span>受付設定</span>
          </button>
        </div>
      </header>

      {/* カメラビューポート / メインエリア */}
      <main className="relative flex-1 rounded-md overflow-hidden bg-black border border-zinc-300 min-h-105 flex items-center justify-center mb-4 shadow-sm">
        {/* ビデオストリーム & 処理用Canvas */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* 状態オーバーレイ / フィードバック表示 */}
        <div
          className={`absolute inset-0 transition-all duration-200 flex flex-col items-center justify-center p-6 text-center ${getStatusOverlayStyle()}`}
        >
          {scanStatus === "idle" ? (
            <div className="border-2 border-dashed border-white/60 rounded-xl w-64 h-64 flex flex-col items-center justify-center bg-black/20 backdrop-blur-[1px]">
              <Camera className="w-10 h-10 text-white/80 mb-2 animate-pulse" />
              <p className="text-white text-xs font-medium">
                QRコードをフレーム内にかざしてください
              </p>
            </div>
          ) : scanStatus === "processing" ? (
            // biome-ignore lint/a11y/useSemanticElements: <output> is not suitable for this block layout
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
              <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/30 border-t-white" />
              <p className="text-lg font-bold tracking-wide">{statusMessage}</p>
            </div>
          ) : (
            <div className="space-y-2 animate-bounce">
              <p className="text-3xl font-extrabold tracking-wide">{statusMessage}</p>
            </div>
          )}
        </div>

        {/* カメラ切替ボタン */}
        <button
          type="button"
          onClick={toggleCamera}
          aria-label="カメラを切り替え"
          className="absolute bottom-4 right-4 bg-white/90 hover:bg-white text-zinc-900 p-3 rounded-full shadow-md transition active:scale-95 border border-zinc-200 z-10"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </main>

      {/* ステータス・操作カード */}
      <footer className="bg-white border border-zinc-300 rounded-md p-4 flex flex-col gap-3 shadow-sm">
        <div className="flex justify-between items-center text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400 font-bold text-2xl">---</span>
            <span className="text-zinc-700 font-medium">出席確認済み</span>
            <span className="text-[10px] font-medium text-zinc-500 bg-zinc-100 border border-zinc-200 rounded-full px-2 py-0.5">
              未対応
            </span>
          </div>
          <div className="text-zinc-500 text-xs">
            <input
              type="number"
              value={totalExpected || ""}
              onChange={(e) => setTotalExpected(Number(e.target.value))}
              placeholder="0"
              className="w-12 border border-zinc-300 rounded px-1 py-0.5 text-right font-semibold text-zinc-700 mr-1"
            />
            人参加予定
          </div>
        </div>

        {/* 進捗バー */}
        <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden border border-zinc-200">
          <div
            className="bg-red-600 h-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* 管理リンク */}
        <div className="pt-1 border-t border-zinc-100 mt-1 flex justify-between items-center text-xs">
          <a
            href={eventId ? `https://connpass.com/event/${eventId}/` : "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 font-medium transition"
          >
            <span>イベントページの管理</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-zinc-400">連続受付アクティブ</span>
        </div>
      </footer>

      {settingsLoaded && (showSettings || !isConfigured) && (
        <SettingsModal
          closable={isConfigured}
          groupId={groupId}
          eventId={eventId}
          events={events}
          eventsStatus={eventsStatus}
          onReloadEvents={() => setEventsReloadKey((k) => k + 1)}
          onSave={(values) => {
            setGroupId(values.groupId);
            setEventId(values.eventId);
            saveSettings(values);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
