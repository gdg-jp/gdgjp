import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@gdgjp/design-system";
import { type FormEvent, type ReactNode, useState } from "react";
import { Help } from "~/components/Help";
import {
  FastForward,
  MessageSquare,
  SendHorizontal,
  StickyNote,
  Timer,
  VolumeX,
} from "~/components/icons";
import type { ClientMessage, Message, Peer } from "../../protocol";
import { ChatLog } from "../ChatLog";

/** Bilingual so any speaker can read them without a language setting. */
export const CUE_PRESETS: Array<{ icon: ReactNode; label: string; text: string }> = [
  { icon: <Timer size={16} />, label: "残り 5 分", text: "残り 5 分です / 5 minutes left" },
  { icon: <FastForward size={16} />, label: "巻いて", text: "巻いてください / Please wrap up" },
  {
    icon: <VolumeX size={16} />,
    label: "音が出ていません",
    text: "音声が聞こえていません / We can't hear you",
  },
];

/** Chat and cue cards (カンペ) toward one speaker or everyone. */
export function MessagePanel({
  speakers,
  messages,
  selfId,
  send,
}: {
  speakers: Peer[];
  messages: Message[];
  selfId: string;
  send: (msg: ClientMessage) => boolean;
}) {
  const [to, setTo] = useState("");
  const [cueText, setCueText] = useState("");
  const recipient = to && speakers.some((s) => s.id === to) ? to : null;
  const nameOf = (id: string) => speakers.find((s) => s.id === id)?.name;
  const sendCue = (text: string) => send({ type: "message", kind: "cue", to: recipient, text });
  const submitCue = (e: FormEvent) => {
    e.preventDefault();
    if (cueText.trim() && sendCue(cueText)) setCueText("");
  };
  const cues = messages.filter((m) => m.kind === "cue");

  return (
    <Tabs defaultValue="cue" className="sc-messages">
      <div className="sc-messages-head">
        <TabsList>
          <TabsTrigger value="chat" aria-label="チャット">
            <MessageSquare size={16} aria-hidden="true" />
          </TabsTrigger>
          <TabsTrigger value="cue" aria-label="カンペ">
            <StickyNote size={16} aria-hidden="true" />
          </TabsTrigger>
        </TabsList>
        <NativeSelect aria-label="宛先" value={to} onChange={(e) => setTo(e.target.value)}>
          <NativeSelectOption value="">全員</NativeSelectOption>
          {speakers.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Help>
          <p>カンペは登壇者の画面上部とミニ表示に大きく出ます。登壇者が ✓ を押すまで残ります。</p>
          <p>チャットは登壇者のチャット欄に届きます。</p>
        </Help>
      </div>
      <TabsContent value="chat" className="sc-messages-body">
        <ChatLog
          messages={messages.filter((m) => m.kind === "chat")}
          selfId={selfId}
          nameOf={nameOf}
          sendLabel="送信"
          onSend={(text) => send({ type: "message", kind: "chat", to: recipient, text })}
        />
      </TabsContent>
      <TabsContent value="cue" className="sc-messages-body">
        <div className="sc-cue-presets">
          {CUE_PRESETS.map((p) => (
            <Button key={p.text} variant="secondary" size="sm" onClick={() => sendCue(p.text)}>
              {p.icon}
              {p.label}
            </Button>
          ))}
        </div>
        <form className="sc-chat-form" onSubmit={submitCue}>
          <Input
            value={cueText}
            onChange={(e) => setCueText(e.target.value)}
            maxLength={200}
            aria-label="カンペ"
          />
          <Button type="submit" aria-label="カンペを送る" disabled={!cueText.trim()}>
            <SendHorizontal size={16} aria-hidden="true" />
          </Button>
        </form>
        <ol className="sc-cue-log">
          {cues
            .slice(-8)
            .reverse()
            .map((m) => (
              <li key={m.id}>
                <span className="sc-muted">{m.to ? `→ ${nameOf(m.to) ?? "?"}` : "→ 全員"}</span>
                {m.text}
              </li>
            ))}
        </ol>
      </TabsContent>
    </Tabs>
  );
}
