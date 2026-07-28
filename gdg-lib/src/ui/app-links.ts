export type GdgAppLink = {
  iconUrl: string;
  label: string;
  url: string;
};

/** The public apps shown in the shared GDG Japan app launcher. */
export const GDG_APP_LINKS: readonly GdgAppLink[] = [
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
