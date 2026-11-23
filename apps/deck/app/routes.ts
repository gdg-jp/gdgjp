import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("d/:deckId", "routes/d.$deckId.tsx"),
  route("decks/:deckId/edit", "routes/decks.$deckId.edit.tsx"),
  route("dock/:deckId", "routes/dock.$deckId.tsx"),
  route("api/decks", "routes/api.decks.ts"),
  route("api/decks/:deckId/layout", "routes/api.decks.$deckId.layout.ts"),
  route("api/decks/:deckId/images", "routes/api.decks.$deckId.images.ts"),
  route("images/:deckId/:imageId", "routes/images.$deckId.$imageId.ts"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"),
] satisfies RouteConfig;
