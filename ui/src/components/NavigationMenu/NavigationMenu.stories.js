import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./NavigationMenu";
const meta = {
  title: "Components/NavigationMenu",
  component: NavigationMenu,
  parameters: { layout: "centered" },
};
export default meta;
export const MainNavigation = {
  render: () =>
    _jsx(NavigationMenu, {
      children: _jsxs(NavigationMenuList, {
        children: [
          _jsxs(NavigationMenuItem, {
            children: [
              _jsx(NavigationMenuTrigger, { children: "\u30A4\u30D9\u30F3\u30C8" }),
              _jsx(NavigationMenuContent, {
                children: _jsx("p", {
                  style: { margin: 0 },
                  children:
                    "\u958B\u50AC\u4E88\u5B9A\u306E\u30A4\u30D9\u30F3\u30C8\u3092\u63A2\u3059",
                }),
              }),
            ],
          }),
          _jsx(NavigationMenuItem, {
            children: _jsx(NavigationMenuLink, {
              href: "#about",
              children: "GDG\u306B\u3064\u3044\u3066",
            }),
          }),
        ],
      }),
    }),
};
