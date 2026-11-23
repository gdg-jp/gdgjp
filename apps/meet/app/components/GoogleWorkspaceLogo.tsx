export type GoogleWorkspaceBrand = "google" | "meet" | "calendar" | "docs" | "drive-video";

export const GOOGLE_WORKSPACE_LOGO_SRC: Record<GoogleWorkspaceBrand, string> = {
  google: "/icons/google-logo.svg",
  meet: "/icons/google-meet.svg",
  calendar: "/icons/google-calendar.svg",
  docs: "/icons/google-docs.svg",
  "drive-video": "/icons/google-drive-video.svg",
};

const SIZE_CLASS = {
  16: "size-4",
  18: "size-[18px]",
  20: "size-5",
  24: "size-6",
} as const;

export type GoogleWorkspaceLogoSize = keyof typeof SIZE_CLASS;

export type GoogleWorkspaceLogoProps = {
  brand: GoogleWorkspaceBrand;
  size?: GoogleWorkspaceLogoSize;
  className?: string;
};

export function GoogleWorkspaceLogo({ brand, size = 18, className }: GoogleWorkspaceLogoProps) {
  const classes = className
    ? `${SIZE_CLASS[size]} shrink-0 object-contain ${className}`
    : `${SIZE_CLASS[size]} shrink-0 object-contain`;
  return (
    <img
      src={GOOGLE_WORKSPACE_LOGO_SRC[brand]}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      decoding="async"
      className={classes}
    />
  );
}
