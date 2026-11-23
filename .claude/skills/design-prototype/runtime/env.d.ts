declare module "*.css";

declare module "prototype:entry" {
  const prototype: import("./kit").Prototype;
  export default prototype;
}
