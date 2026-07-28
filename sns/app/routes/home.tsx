import { redirect } from "react-router";
export function loader() {
  throw redirect("/posts");
}
export default function Home() {
  return null;
}
