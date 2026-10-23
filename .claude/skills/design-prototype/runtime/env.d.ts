// Ambient declarations for type-checking a prototype outside any workspace.
declare module "*.css";

declare module "prototype:entry" {
  const prototype: import("./kit").Prototype;
  export default prototype;
}
