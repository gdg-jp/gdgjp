import { signOut } from "@/auth";
import { ShieldAlert } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-800 p-4 flex items-center justify-center font-sans">
      <div className="bg-white border border-zinc-300 rounded-md shadow-sm max-w-sm w-full p-6 flex flex-col items-center gap-4 text-center">
        <ShieldAlert className="w-8 h-8 text-red-600" />
        <h1 className="text-lg font-bold text-zinc-900">利用できません</h1>
        <p className="text-xs text-zinc-600">
          この受付システムは GDG Greater Kwansai 所属メンバー専用です。
          所属チャプターをご確認のうえ、別のアカウントでログインしてください。
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium px-4 py-2 rounded-md"
          >
            ログアウト
          </button>
        </form>
      </div>
    </div>
  );
}
