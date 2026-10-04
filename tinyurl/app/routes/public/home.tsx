import { redirect } from "react-router";

export function loader() {
  throw redirect("/links");
}

export default function Home() {
  return null;
}
