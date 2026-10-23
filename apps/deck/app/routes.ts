import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"), // "/" — deck list (auth + chapter)
  route("d/:deckId", "routes/d.$deckId.tsx"), // phone controller (auth + deck's chapter)
  route("decks/:deckId/edit", "routes/decks.$deckId.edit.tsx"), // editor (auth + deck's chapter)
  route("dock/:deckId", "routes/dock.$deckId.tsx"), // OBS custom dock — dock token
  route("api/decks", "routes/api.decks.ts"), // create / rename / duplicate / reissue / delete
  route("api/decks/:deckId/layout", "routes/api.decks.$deckId.layout.ts"), // save layout
  route("api/decks/:deckId/images", "routes/api.decks.$deckId.images.ts"), // upload key image
  route("images/:deckId/:imageId", "routes/images.$deckId.$imageId.ts"), // key image
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"), // 404 unless APP_URL is loopback
] satisfies RouteConfig;
