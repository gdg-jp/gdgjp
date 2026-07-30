export type GdgAppLink = {
  iconUrl: string;
  label: string;
  url: string;
};

/** The public apps shown in the shared GDG Japan app launcher. */
export const GDG_APP_LINKS: readonly GdgAppLink[] = [
  {
    iconUrl: "https://raw.githubusercontent.com/gdg-jp/gdgjp/main/cli/icon.png",
    label: "CLI",
    url: "https://github.com/gdg-jp/gdgjp#gdg-cli",
  },
  {
    iconUrl: "https://learn.gdgs.jp/assets/learn-gdgs-icon.png",
    label: "Learn",
    url: "https://learn.gdgs.jp",
  },
  {
    iconUrl: "https://url.gdgs.jp/app-icon.png",
    label: "TinyURL",
    url: "https://url.gdgs.jp",
  },
  {
    iconUrl: "https://wiki.gdgs.jp/app-icon.png",
    label: "Wiki",
    url: "https://wiki.gdgs.jp",
  },
  {
    iconUrl: "https://scheduler.gdgs.jp/app-icon.png",
    label: "Scheduler",
    url: "https://scheduler.gdgs.jp",
  },
  {
    iconUrl: "https://img.gdgs.jp/app-icon.png",
    label: "Images",
    url: "https://img.gdgs.jp",
  },
  {
    iconUrl: "https://sns.gdgs.jp/app-icon.png",
    label: "SNS Manager",
    url: "https://sns.gdgs.jp",
  },
];
