"use client";

import { LogIn, QrCode } from "lucide-react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const handleLogin = () => {
    // GDG Accounts の認証フローを開始し、ログイン後は /checkin へ遷移
    signIn("gdg-accounts", { callbackUrl: "/checkin" });
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-800 p-4 flex items-center justify-center font-sans">
      <div className="bg-white border border-zinc-300 rounded-md shadow-sm max-w-sm w-full">
        {/* カードヘッダー */}
        <div className="flex flex-col items-center gap-2 p-6 pb-4 border-b border-zinc-200 text-center">
          <div className="p-2.5 bg-zinc-100 border border-zinc-200 rounded-md">
            <QrCode className="w-6 h-6 text-zinc-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 tracking-tight">GDG 受付システム</h1>
            <p className="text-xs text-zinc-500">GDG Japan Connpass・Luma API Mode</p>
          </div>
        </div>

        {/* カードコンテンツ */}
        <div className="p-6 flex flex-col gap-4">
          <p className="text-xs text-zinc-600 text-center">
            連続受付を開始するには GDG Accounts でのログインが必要です。
          </p>
          <button
            type="button"
            onClick={handleLogin}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium px-4 py-2.5 rounded-md shadow-sm transition active:scale-95"
          >
            <LogIn className="w-4 h-4" />
            <span>GDG Accounts でログイン</span>
          </button>
        </div>
      </div>
    </div>
  );
}
